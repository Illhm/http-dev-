// MV3 background — anti-refresh log
const state = { attached:false, tabId:null, requests:new Map(), nextSeq:0, throttle:'none', cacheDisabled:false };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.__RRDBG) return;
  const { cmd, payload } = msg;
  if (cmd === 'getAll'){ const arr = Array.from(state.requests.values()); sendResponse({ attached: state.attached, tabId: state.tabId, entries: arr }); }
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
    if (state.attached && state.tabId === tabId) return true;
    if (state.attached) await stopCapture();
    await chrome.debugger.attach({ tabId }, "1.3");
    state.attached = true; state.tabId = tabId;
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", { includeExtraInfo:true, maxPostDataSize:-1 });
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await applyCacheDisabled(); await applyThrottle();
    subscribeDebugger();
    broadcast('started', { tabId });
    return true;
  } catch(e){ console.error('attach fail', e); return false; }
}

async function stopCapture(){
  try { if (state.attached) await chrome.debugger.detach({ tabId: state.tabId }); } catch(e){}
  state.attached = false; state.tabId = null;
  broadcast('stopped', {});
}

async function applyCacheDisabled(){ if (!state.attached) return; try{ await chrome.debugger.sendCommand({ tabId: state.tabId }, "Network.setCacheDisabled", { cacheDisabled: state.cacheDisabled }); }catch(e){} }
async function applyThrottle(){
  if (!state.attached) return;
  const p = { none:{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'none'},
              fast3g:{offline:false,latency:150,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8,connectionType:'cellular3g'},
              slow3g:{offline:false,latency:400,downloadThroughput:780*1024/8,uploadThroughput:330*1024/8,connectionType:'cellular3g'} }[state.throttle] || {};
  try{ await chrome.debugger.sendCommand({ tabId: state.tabId }, "Network.emulateNetworkConditions", p); }catch(e){}
}

function subscribeDebugger(){
  chrome.debugger.onEvent.removeListener(onEvent);
  chrome.debugger.onEvent.addListener(onEvent);
}

function ensure(id){ if(!state.requests.has(id)) state.requests.set(id, { id, seq: ++state.nextSeq }); return state.requests.get(id); }

async function onEvent(source, method, params){
  if (!state.attached || source.tabId !== state.tabId) return;
  try {
    switch(method){
      case 'Network.requestWillBeSent': {
        if (params.redirectResponse) {
          const r = ensure(params.requestId);
          r.status = params.redirectResponse.status;
          r.statusText = params.redirectResponse.statusText;
          r.responseHeaders = headersFrom(params.redirectResponse.headers);
          r.timing = params.redirectResponse.timing || null;
          r.mimeType = params.redirectResponse.mimeType;
          r.protocol = params.redirectResponse.protocol;
          r.redirectedTo = params.request.url;
          r.time = (params.timestamp - (r._t0 || params.timestamp));
          r.bodySize = params.redirectResponse.encodedDataLength || 0;
          r.encodedDataLength = params.redirectResponse.encodedDataLength || 0;
          r.responseBodyRaw = ''; r.responseBodyEncoding = 'utf-8';
          broadcast('entry', { id: r.id, record: r });
          state.requests.delete(params.requestId);
        }
        const r = ensure(params.requestId);
        r.url = params.request.url; r.method = params.request.method;
        r.requestHeaders = headersFrom(params.request.headers); r.requestBodyText = params.request.postData || '';
        r._t0 = params.timestamp; r.startedDateTime = new Date(Math.round(params.wallTime*1000)).toISOString();
        r.resourceType = params.type || null;
      } break;
      case 'Network.requestWillBeSentExtraInfo': {
        const r = ensure(params.requestId); r.requestHeaders = mergeHeaders(r.requestHeaders, params.headers);
      } break;
      case 'Network.responseReceived': {
        const r = ensure(params.requestId);
        r.mimeType = params.response.mimeType; r.status = params.response.status; r.statusText = params.response.statusText;
        r.responseHeaders = headersFrom(params.response.headers); r.timing = params.response.timing || null; r.resourceType = r.resourceType || params.type || null;
        r.protocol = params.response.protocol;
      } break;
      case 'Network.responseReceivedExtraInfo': {
        const r = ensure(params.requestId); r.responseHeaders = mergeHeaders(r.responseHeaders, params.headers);
      } break;
      case 'Network.loadingFinished': {
        const r = ensure(params.requestId);
        r.time = (params.timestamp - (r._t0 || params.timestamp)); r.encodedDataLength = params.encodedDataLength;
        try{ const body = await chrome.debugger.sendCommand({ tabId: state.tabId }, 'Network.getResponseBody', { requestId: params.requestId });
             r.responseBodyRaw = body.body || ''; r.responseBodyEncoding = body.base64Encoded ? 'base64' : 'utf-8'; r.bodySize = r.encodedDataLength;
        }catch(e){ r.responseBodyRaw=''; r.responseBodyEncoding='utf-8'; }
        broadcast('entry', { id: r.id, record: r });
      } break;
      case 'Network.loadingFailed': {
        const r = ensure(params.requestId); r.errorText = params.errorText; r.canceled = params.canceled || false;
        r.time = (params.timestamp - (r._t0 || params.timestamp)); broadcast('entry', { id: r.id, record: r });
      } break;
    }
  } catch(e){}
}

function headersFrom(obj){ if(!obj) return []; return Object.entries(obj).map(([name,value])=>({name,value:String(value)})); }
function mergeHeaders(cur, add){ const map=new Map(); for(const h of (cur||[])) map.set(h.name.toLowerCase(), h.value); for(const [name,value] of Object.entries(add||{})) map.set(String(name).toLowerCase(), String(value)); return Array.from(map, ([name,value])=>({name,value})); }
