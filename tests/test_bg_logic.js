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
        }
    }
};

const sandbox = {
    chrome: chromeMock,
    console: console,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
};

vm.createContext(sandbox);
vm.runInContext(bgJsContent, sandbox);

function waitForStart() {
    return new Promise(resolve => {
        onStartedCallback = resolve;
        if (sentMessages.find(m => m.event === 'started')) resolve();
    });
}

async function runTest() {
    console.log("Starting Test...");

    // 1. Start Capture
    console.log("Sending start command...");
    const startMsg = { __RRDBG: true, cmd: 'start', payload: { tabId: 101 } };

    // Trigger the listener
    const handler = listeners.onMessage[0];
    if (!handler) {
        console.error("FAIL: No message listener found");
        return;
    }
    handler(startMsg, {}, () => {});

    await waitForStart();
    console.log("Capture started.");

    // Check listeners
    if (listeners.onEvent.length === 0) {
        console.error("FAIL: No debugger event listener registered.");
        return;
    }

    // 2. Simulate Network.requestWillBeSent
    console.log("Simulating requestWillBeSent...");
    const onEvent = listeners.onEvent[0];

    const requestWillBeSentParams = {
        requestId: 'req-1',
        loaderId: 'loader-1',
        documentURL: 'http://example.com',
        request: {
            url: 'http://example.com/api/data',
            method: 'GET',
            headers: { 'User-Agent': 'Test' },
            initialPriority: 'High',
            referrerPolicy: 'no-referrer',
            postData: 'test-payload'
        },
        timestamp: 1000,
        wallTime: 1600000000.0,
        initiator: { type: 'script' },
        type: 'XHR'
    };

    sentMessages.length = 0; // Clear messages
    await onEvent({ tabId: 101 }, 'Network.requestWillBeSent', requestWillBeSentParams);

    // Verify
    const pendingMsg = sentMessages.find(m => m.event === 'entry');
    if (pendingMsg) {
        console.log("PASS: Broadcast received for requestWillBeSent.");
        if (pendingMsg.data.record.status === 'pending') {
            console.log("PASS: Status is 'pending'.");
        } else {
            console.error("FAIL: Status is not 'pending':", pendingMsg.data.record.status);
        }
    } else {
        console.error("FAIL: No broadcast for requestWillBeSent.");
    }

    // 3. Simulate Network.responseReceived
    console.log("Simulating responseReceived...");
    const responseReceivedParams = {
        requestId: 'req-1',
        loaderId: 'loader-1',
        timestamp: 1000.5,
        type: 'XHR',
        response: {
            url: 'http://example.com/api/data',
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
    if (updateMsg) {
        console.log("PASS: Broadcast received for responseReceived.");
        if (updateMsg.data.record.protocol === 'h2' && updateMsg.data.record.remoteIPAddress === '1.2.3.4') {
             console.log("PASS: Protocol and IP captured.");
        } else {
             console.error("FAIL: Protocol or IP missing.");
        }
    } else {
        console.error("FAIL: No broadcast for responseReceived.");
    }

    // 4. Simulate Network.loadingFinished
    console.log("Simulating loadingFinished...");
    const loadingFinishedParams = {
        requestId: 'req-1',
        timestamp: 1001.0,
        encodedDataLength: 100
    };

    sentMessages.length = 0;
    await onEvent({ tabId: 101 }, 'Network.loadingFinished', loadingFinishedParams);

    const entryMsg = sentMessages.find(m => m.event === 'entry');
    if (entryMsg) {
        console.log("PASS: Broadcast received for loadingFinished.");
        if (entryMsg.data.record.responseBodyRaw === 'mock-body') {
             console.log("PASS: Response body is present.");
        } else {
             console.error("FAIL: Response body missing or incorrect.");
        }
    } else {
        console.error("FAIL: No broadcast for loadingFinished.");
    }
}

runTest().catch(console.error);
