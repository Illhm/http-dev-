const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bgJsContent = fs.readFileSync(path.join(__dirname, '../bg.js'), 'utf8');

const listeners = {
    onMessage: [],
    onEvent: [],
    onDetach: [],
    onBeforeNavigate: []
};

const sentMessages = [];
const attachedTabs = new Set();
const sentCommands = []; // { target, method, params }

const chromeMock = {
    runtime: {
        onMessage: { addListener: (cb) => listeners.onMessage.push(cb) },
        sendMessage: (msg) => sentMessages.push(msg),
        getURL: (path) => `chrome-extension://id/${path}`
    },
    tabs: {
        query: async () => [],
        create: async () => {},
        update: async () => {},
        onCreated: { addListener: () => {} }
    },
    windows: { update: async () => {} },
    debugger: {
        attach: async (target, version) => {
            if (attachedTabs.has(target.tabId)) throw new Error("Already attached");
            attachedTabs.add(target.tabId);
        },
        detach: async (target) => {
            attachedTabs.delete(target.tabId);
            listeners.onDetach.forEach(cb => cb({ tabId: target.tabId }));
        },
        sendCommand: async (target, method, params) => {
            sentCommands.push({ target, method, params });
            if (method === 'Target.sendMessageToTarget') {
                return {};
            }
            if (method === 'Target.setAutoAttach') {
                return {};
            }
            if (method === 'Network.getResponseBody') {
                return { body: 'mock-body', base64Encoded: false };
            }
            if (method === 'Network.enable' || method === 'Page.enable' || method === 'Runtime.enable') {
                return {};
            }
            // For getTargets simulation
            return {};
        },
        getTargets: async () => {
            return [
                { id: 'T100', tabId: 100, type: 'page' },
                { id: 'T200', tabId: 200, type: 'page' },
                { id: 'T300', tabId: 300, type: 'page' }
            ];
        },
        onEvent: {
            addListener: (cb) => listeners.onEvent.push(cb),
            removeListener: () => {}
        },
        onDetach: {
            addListener: (cb) => listeners.onDetach.push(cb),
            removeListener: () => {}
        }
    },
    webNavigation: {
        onBeforeNavigate: { addListener: (cb) => listeners.onBeforeNavigate.push(cb) },
        onCreatedNavigationTarget: { addListener: () => {} }
    }
};

const sandbox = {
    chrome: chromeMock,
    console: console,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Set: Set,
    Map: Map,
    Array: Array,
    Object: Object,
    String: String,
    Date: Date,
    Math: Math
};

vm.createContext(sandbox);

try {
    vm.runInContext(bgJsContent, sandbox);
} catch (e) {
    console.error("Error running bg.js:", e);
}

async function runTest() {
    console.log("Starting Auto-Attach Test (CDP based)...");

    // 1. Start Capture on Tab 100
    console.log("Step 1: Start capture on tab 100");
    const startHandler = listeners.onMessage[0];
    await new Promise(resolve => startHandler({ __RRDBG: true, cmd: 'start', payload: { tabId: 100 } }, {}, resolve));

    if (!attachedTabs.has(100)) throw new Error("Tab 100 not attached");
    console.log("PASS: Tab 100 attached.");

    // Verify Target.setAutoAttach was sent
    const autoAttachCmd = sentCommands.find(c => c.method === 'Target.setAutoAttach' && c.target.tabId === 100);
    if (!autoAttachCmd) throw new Error("Target.setAutoAttach NOT sent to tab 100");
    if (!autoAttachCmd.params.autoAttach || !autoAttachCmd.params.waitForDebuggerOnStart || !autoAttachCmd.params.flatten) {
        throw new Error("Target.setAutoAttach params incorrect: " + JSON.stringify(autoAttachCmd.params));
    }
    console.log("PASS: Target.setAutoAttach sent.");

    // 2. Simulate Target.attachedToTarget for Tab 200 (targetId: T200, sessionId: S200)
    console.log("Step 2: Simulate Target.attachedToTarget (Tab 200)");
    const onEvent = listeners.onEvent[0];

    const attachedEventParams = {
        sessionId: "S200",
        targetInfo: { targetId: "T200", type: "page", url: "http://example.com" },
        waitingForDebugger: true
    };

    await onEvent({ tabId: 100 }, "Target.attachedToTarget", attachedEventParams);

    // Verify commands sent to session S200
    const msgCmds = sentCommands.filter(c => c.method === 'Target.sendMessageToTarget' && c.params.sessionId === 'S200');

    if (msgCmds.length === 0) throw new Error("No commands sent to session S200");

    const resumeCmd = msgCmds.find(c => {
        const inner = JSON.parse(c.params.message);
        return inner.method === 'Runtime.runIfWaitingForDebugger';
    });

    if (!resumeCmd) throw new Error("Runtime.runIfWaitingForDebugger NOT sent to session S200");
    console.log("PASS: Runtime.runIfWaitingForDebugger sent to session S200.");

    // 3. Simulate Network Request on Session S200
    console.log("Step 3: Simulate Network.requestWillBeSent on Session S200");

    const reqParams = {
        requestId: "req1",
        request: { url: "http://example.com/api", method: "GET", headers: {} },
        timestamp: 1000,
        wallTime: 1000,
        sessionId: "S200" // Flattened event contains sessionId
    };

    await onEvent({ tabId: 100 }, "Network.requestWillBeSent", reqParams);

    const entryMsg = sentMessages.find(m => m.event === 'entry' && m.data.record.requestId === 'req1');
    if (!entryMsg) throw new Error("Request entry NOT broadcasted");

    if (entryMsg.data.record.tabId !== 200) {
        throw new Error("Request attributed to wrong tab. Expected 200, got " + entryMsg.data.record.tabId);
    }
    console.log("PASS: Request attributed to Tab 200 correctly.");
}

runTest().catch(e => {
    console.error("FAIL:", e);
    process.exit(1);
});
