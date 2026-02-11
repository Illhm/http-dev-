const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bgJsContent = fs.readFileSync(path.join(__dirname, '../bg.js'), 'utf8');

const listeners = {
    onMessage: [],
    onEvent: [],
    onCreatedNavigationTarget: [],
    onCreated: [],
    onBeforeNavigate: []
};

const sentMessages = [];
let attachedTabs = new Set();
let attachingTabs = new Set();
let capturedTabs = [];

const chromeMock = {
    runtime: {
        onMessage: {
            addListener: (cb) => listeners.onMessage.push(cb)
        },
        sendMessage: (msg) => {
            sentMessages.push(msg);
        },
        getURL: (path) => `chrome-extension://id/${path}`
    },
    tabs: {
        query: async () => [],
        create: async () => {},
        update: async () => {},
        onCreated: {
            addListener: (cb) => listeners.onCreated.push(cb)
        }
    },
    windows: {
        update: async () => {}
    },
    debugger: {
        attach: async (target, version) => {
            const tabId = target.tabId;
            if (attachedTabs.has(tabId)) {
                throw new Error("Already attached to " + tabId);
            }
            // Simulate async delay
            await new Promise(resolve => setTimeout(resolve, 10));
            attachedTabs.add(tabId);
            capturedTabs.push(tabId);
        },
        detach: async (target) => {
            attachedTabs.delete(target.tabId);
        },
        sendCommand: async (target, method, params) => {
            return {};
        },
        onEvent: {
            addListener: (cb) => listeners.onEvent.push(cb),
            removeListener: (cb) => {}
        },
        onDetach: {
            addListener: (cb) => {},
            removeListener: (cb) => {}
        }
    },
    webNavigation: {
        onBeforeNavigate: {
            addListener: (cb) => listeners.onBeforeNavigate.push(cb)
        },
        onCreatedNavigationTarget: {
            addListener: (cb) => listeners.onCreatedNavigationTarget.push(cb)
        }
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

// We need to inject the "state" object access or check side effects.
// Since bg.js defines `const state`, we can't easily access it from outside unless we export it or inspect side effects.
// We will rely on `capturedTabs` in our mock which tracks successful `attach` calls.

// Run bg.js
try {
    vm.runInContext(bgJsContent, sandbox);
} catch (e) {
    console.error("Error running bg.js:", e);
}

async function runTest() {
    console.log("Starting Auto-Attach Test...");

    // 1. Start Capture on Tab 100 (Parent)
    console.log("Step 1: Start capture on parent tab 100");
    const startMsg = { __RRDBG: true, cmd: 'start', payload: { tabId: 100 } };
    const handler = listeners.onMessage[0];
    if (!handler) throw new Error("No message listener");

    await new Promise(resolve => handler(startMsg, {}, resolve));

    // Verify tab 100 is attached
    if (!attachedTabs.has(100)) {
        console.error("FAIL: Parent tab 100 not attached.");
        process.exit(1);
    }
    console.log("PASS: Parent tab 100 attached.");

    // 2. Simulate opening a new tab (Tab 200) from Tab 100 via webNavigation
    console.log("Step 2: Simulate onCreatedNavigationTarget (Tab 200 from 100)");

    const navListener = listeners.onCreatedNavigationTarget[0];
    if (navListener) {
        // Trigger it
        // Note: startCapture is async, but the listener usually doesn't await it.
        // We need to wait for the async operations to complete.
        navListener({ sourceTabId: 100, tabId: 200, url: 'http://example.com' });

        // Wait for async attach
        await new Promise(resolve => setTimeout(resolve, 50));

        if (attachedTabs.has(200)) {
            console.log("PASS: Tab 200 auto-attached via onCreatedNavigationTarget.");
        } else {
            console.error("FAIL: Tab 200 NOT attached via onCreatedNavigationTarget.");
        }
    } else {
        console.log("WARN: onCreatedNavigationTarget listener not found (feature not implemented yet).");
    }

    // 3. Simulate opening a new tab (Tab 300) from Tab 100 via tabs.onCreated
    console.log("Step 3: Simulate tabs.onCreated (Tab 300 from 100)");

    const createdListener = listeners.onCreated[0];
    if (createdListener) {
        createdListener({ id: 300, openerTabId: 100 });

        await new Promise(resolve => setTimeout(resolve, 50));

        if (attachedTabs.has(300)) {
            console.log("PASS: Tab 300 auto-attached via tabs.onCreated.");
        } else {
            console.error("FAIL: Tab 300 NOT attached via tabs.onCreated.");
        }
    } else {
        console.log("WARN: tabs.onCreated listener not found (feature not implemented yet).");
    }

    // 4. Test Race Condition / Double Attach
    // Trigger both for Tab 400
    console.log("Step 4: Simulate race condition for Tab 400");

    const tab400 = 400;
    let attachCountBefore = capturedTabs.filter(id => id === tab400).length;

    if (navListener && createdListener) {
        navListener({ sourceTabId: 100, tabId: 400, url: 'http://example.com' });
        createdListener({ id: 400, openerTabId: 100 });

        await new Promise(resolve => setTimeout(resolve, 50));

        let attachCountAfter = capturedTabs.filter(id => id === tab400).length;
        // capturedTabs only increments on successful attach

        if (attachedTabs.has(400)) {
             console.log("PASS: Tab 400 attached.");
             if (attachCountAfter === 1) {
                 console.log("PASS: Tab 400 attached exactly once.");
             } else {
                 console.log("WARN: Tab 400 attached " + attachCountAfter + " times (should be 1). check logic.");
             }
        } else {
             console.error("FAIL: Tab 400 NOT attached.");
        }
    } else {
        console.log("WARN: Skipping race test as listeners are missing.");
    }
}

runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
