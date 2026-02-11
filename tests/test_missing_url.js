const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bgJsContent = fs.readFileSync(path.join(__dirname, '../bg.js'), 'utf8');

const listeners = {
    onMessage: [],
    onEvent: []
};

const sentMessages = [];
let onStartedCallback = null;

const chromeMock = {
    runtime: {
        onMessage: {
            addListener: (cb) => listeners.onMessage.push(cb)
        },
        sendMessage: (msg) => {
            sentMessages.push(msg);
            if (msg.event === 'started' && onStartedCallback) {
                onStartedCallback();
            }
        },
        getURL: (path) => `chrome-extension://id/${path}`
    },
    tabs: {
        query: async () => [],
        create: async () => {},
        update: async () => {}
    },
    windows: {
        update: async () => {}
    },
    debugger: {
        attach: async () => {},
        detach: async () => {},
        sendCommand: async (target, method, params) => {
            if (method === 'Network.getResponseBody') {
                return { body: 'mock-body', base64Encoded: false };
            }
            return {};
        },
        onEvent: {
            addListener: (cb) => listeners.onEvent.push(cb),
            removeListener: (cb) => {
                const idx = listeners.onEvent.indexOf(cb);
                if (idx !== -1) listeners.onEvent.splice(idx, 1);
            }
        },
        onDetach: {
            addListener: (cb) => {},
            removeListener: (cb) => {}
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
    Map: Map,
    Set: Set,
    Array: Array,
    Object: Object,
    String: String,
    Date: Date,
    Math: Math
};

vm.createContext(sandbox);
vm.runInContext(bgJsContent, sandbox);

function waitForStart() {
    return new Promise(resolve => {
        onStartedCallback = resolve;
        // Check if already started
        if (sentMessages.find(m => m.event === 'started')) resolve();
    });
}

async function runTest() {
    console.log("Starting Missing URL Test...");

    // 1. Start Capture
    const startMsg = { __RRDBG: true, cmd: 'start', payload: { tabId: 101 } };
    const handler = listeners.onMessage[0];
    handler(startMsg, {}, () => {});
    await waitForStart();
    console.log("Capture started.");

    // 2. Simulate Network.responseReceived WITHOUT prior requestWillBeSent
    // This happens if we attach late or there's a race condition.
    console.log("Simulating responseReceived without requestWillBeSent...");
    const onEvent = listeners.onEvent[0];

    const responseReceivedParams = {
        requestId: 'req-missing-url',
        loaderId: 'loader-1',
        timestamp: 1000.5,
        type: 'XHR',
        response: {
            url: 'http://example.com/missing-request',
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' },
            mimeType: 'application/json',
            connectionReused: true,
            connectionId: 1,
            remoteIPAddress: '1.2.3.4',
            remotePort: 80,
            fromDiskCache: false,
            encodedDataLength: 100,
            protocol: 'h2'
        }
    };

    sentMessages.length = 0;
    await onEvent({ tabId: 101 }, 'Network.responseReceived', responseReceivedParams);

    const updateMsg = sentMessages.find(m => m.event === 'entry');
    if (!updateMsg) {
        throw new Error("No broadcast for responseReceived.");
    }

    const record = updateMsg.data.record;
    console.log("Record URL:", record.url);

    if (record.url === 'http://example.com/missing-request') {
        console.log("PASS: URL captured from responseReceived.");
    } else {
        throw new Error(`FAIL: URL is missing or incorrect. Got: ${record.url}`);
    }
}

runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
