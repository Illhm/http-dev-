// MV3 background — anti-refresh log
const state = { attached:false, attachedTabs:new Set(), requests:new Map(), nextSeq:0, throttle:'none', cacheDisabled:false, attaching:new Set() };
const sessionToTab = new Map(); // sessionId -> tabId
const autoAttachedTabs = new Set(); // tabId

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.__RRDBG) return;
  const { cmd, payload } = msg;
  if (cmd === 'getAll'){ const arr = Array.from(state.requests.values()); sendResponse({ attached: state.attached, tabId: Array.from(state.attachedTabs)[0]||null, entries: arr }); }
  else if (cmd === 'start'){ startCapture(payload?.tabId).then(ok=>sendResponse(ok)); return true; }
  else if (cmd === 'stop'){ stopCapture().then(()=>sendResponse(true)); return true; }
  else if (cmd === 'clear'){ state.requests.clear(); broadcast('cleared', {}); sendResponse(true); }
  else if (cmd === 'openDash'){ openOrFocusDashboard().then(()=>sendResponse(true)); return true; }
  else if (cmd === 'setThrottle'){ state.throttle = payload?.value || 'none'; applyThrottle().then(()=>sendResponse(true)); return true; }
  else if (cmd === 'setCacheDisabled'){ state.cacheDisabled = !!payload?.value; applyCacheDisabled().then(()=>sendResponse(true)); return true; }
  else { sendResponse(null); }
});

function broadcast(event, data){ chrome.runtime.sendMessage({ __RRSTREAM:true, event, data }); }

async function openOrFocusDashboard(){
  const url = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({});
  const found = tabs.find(t => t.url === url);
  if (found) {
    try { await chrome.tabs.update(found.id, { active:true }); } catch(e){}
    try { if (found.windowId) await chrome.windows.update(found.windowId, { focused:true }); } catch(e){}
  } else {
    await chrome.tabs.create({ url });
  }
}

async function startCapture(tabId){
  try {
    if (!tabId) return false;
    if (state.attachedTabs.has(tabId)) return true;
    if (state.attaching.has(tabId)) return true; // Already attaching
    state.attaching.add(tabId);
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
      state.attachedTabs.add(tabId);
      state.attached = true;
      // Immediately enable Network to catch early requests
      const p1 = chrome.debugger.sendCommand({ tabId }, "Network.enable", { includeExtraInfo:true, maxPostDataSize:-1 });
      const p2 = chrome.debugger.sendCommand({ tabId }, "Page.enable");
      const p3 = chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
      await Promise.all([p1, p2, p3]);

      // Enable auto-attach to capture new tabs
      await chrome.debugger.sendCommand({ tabId }, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

      await applyCacheDisabled(tabId); await applyThrottle(tabId);
      subscribeDebugger();
      broadcast('started', { tabId });
      return true;
    } finally {
      state.attaching.delete(tabId);
    }
  } catch(e){ console.error('attach fail', e); return false; }
}

async function stopCapture(){
  for (const tabId of state.attachedTabs) {
    try { await chrome.debugger.detach({ tabId }); } catch(e){}
  }
  state.attachedTabs.clear();
  sessionToTab.clear();
  autoAttachedTabs.clear();
  state.attached = false;
  broadcast('stopped', {});
}

async function applyCacheDisabled(tId){
  const targets = tId ? [tId] : Array.from(state.attachedTabs);
  for(const tabId of targets){
    try{ await chrome.debugger.sendCommand({ tabId }, "Network.setCacheDisabled", { cacheDisabled: state.cacheDisabled }); }catch(e){}
  }
}
async function applyThrottle(tId){
  const targets = tId ? [tId] : Array.from(state.attachedTabs);
  const p = { none:{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'none'},
              fast3g:{offline:false,latency:150,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8,connectionType:'cellular3g'},
              slow3g:{offline:false,latency:400,downloadThroughput:780*1024/8,uploadThroughput:330*1024/8,connectionType:'cellular3g'} }[state.throttle] || {};
  for(const tabId of targets){
    try{ await chrome.debugger.sendCommand({ tabId }, "Network.emulateNetworkConditions", p); }catch(e){}
  }
}

function subscribeDebugger(){
  chrome.debugger.onEvent.removeListener(onEvent);
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.removeListener(onDetach);
  chrome.debugger.onDetach.addListener(onDetach);
}

function onDetach(source){
  if (state.attachedTabs.has(source.tabId)) {
    state.attachedTabs.delete(source.tabId);
    if (state.attachedTabs.size === 0) {
       sessionToTab.clear();
       autoAttachedTabs.clear();
    }
  }
}

function ensure(requestId, tabId){
  const key = `${tabId}:${requestId}`;
  if(!state.requests.has(key)) state.requests.set(key, { id: key, requestId, tabId, seq: ++state.nextSeq });
  return state.requests.get(key);
}

async function sendCommandToSession(parentTabId, sessionId, method, params = {}) {
    const msg = { id: ++state.nextSeq, method, params };
    await chrome.debugger.sendCommand({ tabId: parentTabId }, "Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify(msg)
    });
}

async function onEvent(source, method, params){
  // Handle Target events for auto-attach
  if (method === 'Target.attachedToTarget') {
      const sessionId = params.sessionId;
      const targetInfo = params.targetInfo;
      const parentTabId = source.tabId;

      try {
          const targets = await chrome.debugger.getTargets();
          const target = targets.find(t => t.id === targetInfo.targetId);
          if (target && target.tabId) {
              sessionToTab.set(sessionId, target.tabId);
              autoAttachedTabs.add(target.tabId);

              await sendCommandToSession(parentTabId, sessionId, "Network.enable", { includeExtraInfo:true, maxPostDataSize:-1 });
              await sendCommandToSession(parentTabId, sessionId, "Page.enable");
              await sendCommandToSession(parentTabId, sessionId, "Runtime.enable");
              await sendCommandToSession(parentTabId, sessionId, "Runtime.runIfWaitingForDebugger");
          }
      } catch (e) {
          console.error('Auto-attach setup failed', e);
      }
      return;
  }

  if (method === 'Target.detachedFromTarget') {
      const sessionId = params.sessionId;
      const tId = sessionToTab.get(sessionId);
      if (tId) autoAttachedTabs.delete(tId);
      sessionToTab.delete(sessionId);
      return;
  }

  // Determine actual tabId
  let tabId = source.tabId;
  if (params && params.sessionId && sessionToTab.has(params.sessionId)) {
      tabId = sessionToTab.get(params.sessionId);
  }

  // Check if we should process this event
  const isAttached = state.attachedTabs.has(tabId);
  const isAutoAttached = autoAttachedTabs.has(tabId);

  if (!state.attached || (!isAttached && !isAutoAttached)) return;

  try {
    switch(method){
      case 'Network.requestWillBeSent': {
        const r = ensure(params.requestId, tabId);
        r.url = params.request.url; r.method = params.request.method;
        r.requestHeaders = headersFrom(params.request.headers); r.requestBodyText = params.request.postData || '';
        r._t0 = params.timestamp; r.startedDateTime = new Date(Math.round(params.wallTime*1000)).toISOString();
        r.resourceType = params.type || null;
        r.status = 'pending';
        broadcast('entry', { id: r.id, record: r });
      } break;
      case 'Network.requestWillBeSentExtraInfo': {
        const r = ensure(params.requestId, tabId); r.requestHeaders = mergeHeaders(r.requestHeaders, params.headers);
      } break;
      case 'Network.responseReceived': {
        const r = ensure(params.requestId, tabId);
        if (!r.url && params.response.url) r.url = params.response.url;
        r.mimeType = params.response.mimeType; r.status = params.response.status; r.statusText = params.response.statusText;
        r.responseHeaders = headersFrom(params.response.headers); r.timing = params.response.timing || null; r.resourceType = r.resourceType || params.type || null;
        r.protocol = params.response.protocol || '';
        r.remoteIPAddress = params.response.remoteIPAddress || '';
        r.remotePort = params.response.remotePort || 0;
        broadcast('entry', { id: r.id, record: r });
      } break;
      case 'Network.responseReceivedExtraInfo': {
        const r = ensure(params.requestId, tabId); r.responseHeaders = mergeHeaders(r.responseHeaders, params.headers);
      } break;
      case 'Network.loadingFinished': {
        const r = ensure(params.requestId, tabId);
        r.time = (params.timestamp - (r._t0 || params.timestamp)); r.encodedDataLength = params.encodedDataLength;
        try{
             let body;
             if (isAutoAttached) {
                 // Getting body from auto-attached session is complex, skipping for now
                 r.responseBodyRaw=''; r.responseBodyEncoding='utf-8';
             } else {
                 body = await chrome.debugger.sendCommand({ tabId: source.tabId }, 'Network.getResponseBody', { requestId: params.requestId });
                 r.responseBodyRaw = body.body || ''; r.responseBodyEncoding = body.base64Encoded ? 'base64' : 'utf-8'; r.bodySize = r.encodedDataLength;
             }
        }catch(e){ r.responseBodyRaw=''; r.responseBodyEncoding='utf-8'; }
        broadcast('entry', { id: r.id, record: r });
      } break;
      case 'Network.loadingFailed': {
        const r = ensure(params.requestId, tabId); r.errorText = params.errorText; r.canceled = params.canceled || false;
        r.time = (params.timestamp - (r._t0 || params.timestamp)); broadcast('entry', { id: r.id, record: r });
      } break;
    }
  } catch(e){}
}

function headersFrom(obj){ if(!obj) return []; return Object.entries(obj).map(([name,value])=>({name,value:String(value)})); }
function mergeHeaders(cur, add){ const map=new Map(); for(const h of (cur||[])) map.set(h.name.toLowerCase(), h.value); for(const [name,value] of Object.entries(add||{})) map.set(String(name).toLowerCase(), String(value)); return Array.from(map, ([name,value])=>({name,value})); }

if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (!state.attached) return;
    if (details.frameId === 0 && details.url && (details.url.startsWith('http://') || details.url.startsWith('https://'))) {
      startCapture(details.tabId);
    }
  });
}
