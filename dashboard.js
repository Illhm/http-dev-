const $ = (s)=>document.querySelector(s);
const attachInfo = $("#attachInfo");
const gridBody = $("#gridBody");
const masterSel = $("#masterSel");
const filterText = $("#filterText");
const hideDataUrl = $("#hideDataUrl");
const btnClear = $("#btnClear");
const btnSelectMode = $("#btnSelectMode");
const btnSelectAll = $("#btnSelectAll");
const btnClearSelection = $("#btnClearSelection");
const btnExportSelectedZIP = $("#btnExportSelectedZIP");
const selCount = $("#selCount");
const modeCbs = Array.from(document.querySelectorAll("input.mode"));

const tabs = document.querySelectorAll(".detail-tabs button");
const tabViews = {headers: document.getElementById("tab-headers"),payload: document.getElementById("tab-payload"),preview: document.getElementById("tab-preview"),response: document.getElementById("tab-response")};
const headersPre = $("#headersPre");const payloadPre = $("#payloadPre");const previewContainer = $("#previewContainer");const responsePre = $("#responsePre");const resBodyInfo = $("#resBodyInfo");const btnCopyResBody = $("#btnCopyResBody");const btnSaveResBody = $("#btnSaveResBody");
const btnReplay = $("#btnReplay"); const btnEditResend = $("#btnEditResend");
const mobileBackBtn = $("#mobileBackBtn");
const splitPane = $("#split");

// Mobile Back
mobileBackBtn && mobileBackBtn.addEventListener("click", () => {
  splitPane.classList.remove("mobile-detail-view");
});

// Resizer
const divider = document.getElementById("divider");let startX = 0, startLeft = 0;divider.addEventListener("dblclick", () => setLeftPercent(42));divider.addEventListener("mousedown", (e) => {startX = e.clientX;startLeft = getLeftPercent();const move = (ev)=>{const dx = ev.clientX - startX;const pct = Math.min(80, Math.max(20, startLeft + (dx/window.innerWidth)*100));setLeftPercent(pct);};const up = ()=>{ window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };window.addEventListener("mousemove", move);window.addEventListener("mouseup", up);});function getLeftPercent(){ const s = getComputedStyle(document.documentElement).getPropertyValue('--left').trim(); return parseFloat(s.replace('%','')) || 42; }function setLeftPercent(p){ document.documentElement.style.setProperty('--left', p+'%'); }

let rows = [];let current = null;let selectMode = false;let selectedIds = new Set();let currentTabId = null;

function humanSize(bytes){ if(bytes==null||isNaN(bytes))return "-"; const u=["B","KB","MB","GB"]; let i=0,n=Math.max(0,bytes);while(n>=1024&&i<u.length-1){n/=1024;i++;}return `${n.toFixed(1)} ${u[i]}`;}
function pretty(obj){ try{ if(typeof obj==="string") return JSON.stringify(JSON.parse(obj),null,2); return JSON.stringify(obj,null,2);}catch{return String(obj);}}
function nameFromUrl(u){ try{ const x=new URL(u); const p=x.pathname.split('/').filter(Boolean); return (p.pop()||x.hostname)||u; }catch{return u;} }
function sanitize(s){ return (s||'').replace(/[^a-z0-9._-]+/gi,'_'); }
function guessKind(r){
  const t = (r.resourceType||'').toLowerCase();
  if (t) {
    if (t.includes('xhr') || t.includes('fetch')) return 'xhr';
    if (t.includes('script')) return 'js';
    if (t.includes('stylesheet')) return 'css';
    if (t.includes('image')) return 'img';
    if (t.includes('media')) return 'media';
    if (t.includes('font')) return 'font';
    if (t.includes('document')) return 'doc';
    if (t.includes('websocket')) return 'ws';
    if (t.includes('wasm')) return 'wasm';
    if (t.includes('manifest')) return 'manifest';
  }
  const m = (r.mimeType||'').toLowerCase();
  if (m.startsWith('image/')) return 'img';
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'media';
  if (m==='text/css') return 'css';
  if (m.includes('javascript')) return 'js';
  if (m.includes('json')) return 'xhr';
  if (m==='text/html') return 'doc';
  if (m==='application/wasm') return 'wasm';
  if (m.includes('font')) return 'font';
  if (m.includes('manifest')) return 'manifest';
  return 'other';
}

function matchesFilters(r){
  const ft = filterText.value.trim().toLowerCase();
  if (hideDataUrl.checked && r.url.startsWith('data:')) return false;
  const enabledKinds = new Set(modeCbs.filter(cb=>cb.checked).map(cb=>cb.value));
  if (!enabledKinds.has(guessKind(r))) return false;
  if (!ft) return true;
  const blob = [r.url, r.mimeType||"", r.method, String(r.status), (r.requestBodyText||""), (r.responseBodyRaw||"")].join(" ").toLowerCase();
  return blob.includes(ft);
}

function setActiveTab(name){
  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  Object.entries(tabViews).forEach(([k, el]) => el.classList.toggle("active", k === name));
}
tabs.forEach(btn => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

function updateSelUi(){
  const count = selectedIds.size;
  selCount.textContent = `${count} dipilih`;
  btnClearSelection.disabled = count === 0;
  btnExportSelectedZIP.disabled = count === 0;
  btnSelectAll.disabled = !selectMode;
  masterSel && (masterSel.checked = false);
}
function toggleSelectMode(){
  selectMode = !selectMode;
  btnSelectMode.textContent = `Select Mode: ${selectMode ? "ON" : "OFF"}`;
  document.querySelectorAll(".selcol").forEach(el => el.classList.toggle("hidden", !selectMode));
  if (!selectMode) { selectedIds.clear(); updateSelUi(); }
  render();
}
btnSelectMode.addEventListener("click", toggleSelectMode);
btnClearSelection.addEventListener("click", () => { selectedIds.clear(); updateSelUi(); render(); });
btnSelectAll.addEventListener("click", () => { for (const r of rows) if (matchesFilters(r)) selectedIds.add(r.id); updateSelUi(); render(); });
filterText.addEventListener("input", render);
hideDataUrl.addEventListener("change", render);
modeCbs.forEach(cb => cb.addEventListener("change", render));

function createRow(r){
  const tr = document.createElement("tr"); tr.dataset.id = r.id;
  updateRowContent(tr, r);
  tr.addEventListener("click", ()=> {
    if (selectMode){
      if (selectedIds.has(r.id)) selectedIds.delete(r.id); else selectedIds.add(r.id);
      updateSelUi(); render();
    } else {
      showDetail(r.id);
      splitPane.classList.add("mobile-detail-view");
    }
  });
  return tr;
}
function updateRowContent(tr, r){
  const selTd = document.createElement("td"); selTd.className = "selcol" + (selectMode ? "" : " hidden");
  if(selectMode) {
      const cb = document.createElement("input"); cb.type="checkbox"; cb.checked = selectedIds.has(r.id);
      cb.addEventListener("click", (ev)=>{ ev.stopPropagation(); if (cb.checked) selectedIds.add(r.id); else selectedIds.delete(r.id); updateSelUi(); });
      selTd.appendChild(cb);
  }

  tr.innerHTML = `
      <td title="${r.url}">${nameFromUrl(r.url)}</td>
      <td>${r.method||"-"}</td>
      <td>${r.status||"-"}</td>
      <td>${r.protocol||"-"}</td>
      <td>${r.remoteIPAddress||"-"}</td>
      <td>${r.mimeType||"-"}</td>
      <td>${guessKind(r)}</td>
      <td>${humanSize(r.bodySize)}</td>
      <td>${Math.round((r.time||0)*1000)}</td>`;
  tr.prepend(selTd);
}

function render(){
  gridBody.innerHTML = "";
  for (const r of rows) {
    if (!matchesFilters(r)) continue;
    gridBody.appendChild(createRow(r));
  }
  updateSelUi();
}

function upsertRow(r){
  const idx = rows.findIndex(x=>x.id===r.id);
  if (idx !== -1) {
    rows[idx] = r;
    const tr = gridBody.querySelector(`tr[data-id="${r.id}"]`);
    if (tr) {
      if (!matchesFilters(r)) { tr.remove(); return; }
      updateRowContent(tr, r);
      if (current && current.id === r.id) { current=r; showDetail(r.id); }
    } else {
      if (matchesFilters(r)) gridBody.appendChild(createRow(r));
    }
  } else {
    rows.push(r);
    if (matchesFilters(r)) gridBody.appendChild(createRow(r));
  }
}

function formatHeaders(arr){ return (arr||[]).map(h=>`${h.name}: ${h.value}`).join('\n'); }
function showDetail(id){
  const r = rows.find(x=>x.id===id); if (!r) return;
  current = r; setActiveTab("headers");
  headersPre.textContent = [
    `URL: ${r.url}`,
    `Method: ${r.method}  |  Status: ${r.status} ${r.statusText||""}  |  Type: ${r.mimeType||"-"}  |  Cat: ${guessKind(r)}`,
    "",
    "[Request Headers]",
    formatHeaders(r.requestHeaders),
    "",
    "[Response Headers]",
    formatHeaders(r.responseHeaders),
  ].join('\n');

  payloadPre.textContent = r.requestBodyText || "(no payload)";
  // Preview Logic
  previewContainer.innerHTML = "";
  const mime = (r.mimeType||"").toLowerCase();
  if (mime.startsWith("image/") && r.responseBodyRaw) {
    const img = document.createElement("img");
    img.src = `data:${r.mimeType};base64,${r.responseBodyRaw}`;
    previewContainer.appendChild(img);
  } else {
    const pre = document.createElement("pre");
    if (mime.includes("json")) {
      pre.textContent = pretty(r.responseBodyRaw);
    } else {
      pre.textContent = (r.responseBodyEncoding==="base64" ? `(base64) ${ (r.responseBodyRaw||"").length } chars` : (r.responseBodyRaw || "(no body)"));
    }
    previewContainer.appendChild(pre);
  }

  responsePre.textContent = (r.responseBodyEncoding==="base64" ? `(base64) ${ (r.responseBodyRaw||"").length } chars` : (r.responseBodyRaw || "(no body)"));
  resBodyInfo.textContent = r.responseBodyRaw ? `${r.mimeType||"unknown"} | ${r.responseBodyEncoding||"utf-8"} | ${(r.responseBodyRaw||"").length} chars` : "";
}

btnClear.addEventListener("click", async () => { rows = []; selectedIds.clear(); render(); await chrome.runtime.sendMessage({ __RRDBG: true, cmd: 'clear' }); });
btnCopyResBody.addEventListener("click", () => { if (!current) return; navigator.clipboard.writeText(typeof current.responseBodyRaw === 'string' ? current.responseBodyRaw : String(current.responseBodyRaw)).catch(()=>{}); });
btnSaveResBody.addEventListener("click", () => {
  if (!current || !current.responseBodyRaw) return;
  const ext = guessExt(current.mimeType, current.responseBodyEncoding);
  const blob = current.responseBodyEncoding==='base64' ? new Blob([b64toBytes(current.responseBodyRaw)], {type: current.mimeType||'application/octet-stream'}) : new Blob([current.responseBodyRaw], {type:(current.mimeType||'text/plain')+';charset=utf-8'});
  const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`response${ext}`; a.click(); URL.revokeObjectURL(url);
});

async function executeReplay(method, url, headers, body){
  if (!currentTabId) { alert("Capture not active or tab ID unknown."); return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: (m, u, h, b) => {
        const opts = { method: m, headers: {} };
        (h||[]).forEach(x => opts.headers[x.name] = x.value);
        if (b && ['POST','PUT','PATCH'].includes(m.toUpperCase())) opts.body = b;
        console.log("Replaying", m, u);
        fetch(u, opts).then(r=>console.log("Replay status:", r.status)).catch(console.error);
      },
      args: [method, url, headers, body]
    });
  } catch(e){ console.error(e); alert("Replay failed: "+e.message); }
}

btnReplay.addEventListener("click", () => {
  if (!current) return;
  executeReplay(current.method, current.url, current.requestHeaders, current.requestBodyText);
});
btnEditResend.addEventListener("click", () => {
  if (!current) return;
  const m = prompt("Method:", current.method); if(m===null) return;
  const u = prompt("URL:", current.url); if(u===null) return;
  let b = current.requestBodyText;
  if (['POST','PUT','PATCH'].includes(m.toUpperCase())) {
    b = prompt("Body:", b); if(b===null) return;
  }
  executeReplay(m, u, current.requestHeaders, b);
});
function b64toBytes(b64){ const bin = atob(b64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return u8; }
function guessExt(mime, enc){ const m=(mime||'').toLowerCase(); if(m.includes('json'))return'.json'; if(m==='text/html')return'.html'; if(m.includes('xml'))return'.xml'; if(m==='text/plain')return'.txt'; if(m.startsWith('image/'))return'.'+m.split('/')[1].split(';')[0]; if(m.startsWith('video/'))return'.'+m.split('/')[1].split(';')[0]; if(m.startsWith('audio/'))return'.'+m.split('/')[1].split(';')[0]; if(m==='application/wasm')return'.wasm'; return enc==='base64'?'.bin':'.txt'; }

// Export ZIP (Readable)
btnExportSelectedZIP.addEventListener('click', async () => {
  const selected = rows.filter(r => selectedIds.has(r.id)).sort((a,b)=>(a.seq||0)-(b.seq||0));
  const pad = (n)=>String(n).padStart(5,'0');
  const enc = new TextEncoder();
  const files = [];
  // README & index
  const readme = `# Export Req/Res (Readable)
Organized by Domain > Request.
- 00_summary.txt : Metadata
- 01_req_headers.txt
- 02_req_body.(json/txt)
- 03_res_headers.txt
- 04_res_body.(json/html/txt/bin)
`;
  files.push({ name: "README.md", data: enc.encode(readme) });
  const csvHeader = "seq,timestamp,method,status,domain,path,mime,size,url\n";
  let csv = csvHeader;
  let md = "| seq | method | status | domain | path | mime | size |\n|---:|:--|:--:|:--|:--|:--|--:|\n";
  for (const r of selected){
    const urlObj = new URL(r.url);
    const host = sanitize(urlObj.hostname);
    const path = sanitize(urlObj.pathname).slice(-50).replace(/^_+/, '');
    const folderName = `${pad(r.seq||0)}_${r.method}_${path}`;
    const base = `${host}/${folderName}`;

    // Meta
    const meta = [
      `URL: ${r.url}`,
      `Method: ${r.method}`,
      `Status: ${r.status} ${r.statusText||""}`,
      `MIME: ${r.mimeType||"-"}`,
      `Size: ${r.bodySize??0}`,
      `Started: ${r.startedDateTime||""}`,
      `Time(ms): ${Math.round((r.time||0)*1000)}`,
      `Category: ${guessKind(r)}`,
    ].join('\n');
    files.push({ name: `${base}/00_summary.txt`, data: enc.encode(meta) });

    // Headers
    files.push({ name: `${base}/01_req_headers.txt`, data: enc.encode(formatHeaders(r.requestHeaders)) });
    files.push({ name: `${base}/03_res_headers.txt`, data: enc.encode(formatHeaders(r.responseHeaders)) });

    // Request Body
    let reqExt = guessExt((r.requestHeaders||[]).find(h=>h.name.toLowerCase()==='content-type')?.value||'text/plain', 'text');
    let reqBody = r.requestBodyText || '';
    if (reqExt === '.json') { try { reqBody = JSON.stringify(JSON.parse(reqBody), null, 2); } catch {} }
    files.push({ name: `${base}/02_req_body${reqExt}`, data: enc.encode(reqBody) });

    // Response Body
    let resExt = guessExt(r.mimeType, r.responseBodyEncoding);
    let resBodyData;
    if (r.responseBodyEncoding === 'base64') {
       resBodyData = b64toBytes(r.responseBodyRaw||'');
       if (resExt === '.json') {
          try {
             const text = new TextDecoder().decode(resBodyData);
             const json = JSON.stringify(JSON.parse(text), null, 2);
             resBodyData = enc.encode(json);
          } catch {}
       }
    } else {
       let text = r.responseBodyRaw || '';
       if (resExt === '.json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {} }
       resBodyData = enc.encode(text);
    }
    files.push({ name: `${base}/04_res_body${resExt}`, data: resBodyData });

    csv += `${r.seq||0},${JSON.stringify(r.startedDateTime||'')},${JSON.stringify(r.method||'')},${r.status||0},${JSON.stringify(host)},${JSON.stringify(urlObj.pathname)},${JSON.stringify(r.mimeType||'')},${r.bodySize||0},${JSON.stringify(r.url)}\n`;
    md += `| ${r.seq||0} | ${r.method||''} | ${r.status||0} | ${host} | ${urlObj.pathname} | ${r.mimeType||''} | ${r.bodySize||0} |\n`;
  }
  files.push({ name: "index.csv", data: enc.encode(csv) });
  files.push({ name: "index.md", data: enc.encode(md) });

  const zipBlob = buildZip(files);
  const url = URL.createObjectURL(zipBlob); const a=document.createElement('a'); a.href=url; a.download='reqres_readable.zip'; a.click(); URL.revokeObjectURL(url);
});

// minimal ZIP (store) builder
function buildZip(files){
  const enc = new TextEncoder();
  let fileData = []; let central = []; let offset = 0; const now = new Date();
  const dosTime = ((now.getHours()<<11) | (now.getMinutes()<<5) | (Math.floor(now.getSeconds()/2))) & 0xFFFF;
  const dosDate = (((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate()) & 0xFFFF;
  for (const f of files){
    const nameBytes = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data||[]);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local header sig
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true);  // flags
    dv.setUint16(8, 0, true);  // method: store
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc>>>0, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    fileData.push(local);
    // central directory entry
    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralEntry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);  // flags
    cv.setUint16(10, 0, true); // method
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc>>>0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra len
    cv.setUint16(32, 0, true); // comment len
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);
    offset += local.length;
  }
  // end of central directory
  const sizeOfCentral = central.reduce((a,b)=>a+b.length, 0);
  const offsetOfCentral = offset;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk
  ev.setUint16(6, 0, true); // start disk
  const count = files.length;
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, sizeOfCentral, true);
  ev.setUint32(16, offsetOfCentral, true);
  ev.setUint16(20, 0, true); // comment len
  return new Blob([...fileData, ...central, end], { type: "application/zip" });
}
// CRC32
const CRC_TABLE = (()=>{ let c, table=[]; for (let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); } table[n]=c>>>0; } return table; })();
function crc32(u8){ let c=0^(-1); for(let i=0;i<u8.length;i++){ c=(c>>>8) ^ CRC_TABLE[(c ^ u8[i]) & 0xFF]; } return (c ^ (-1))>>>0; }
// end ZIP

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.__RRSTREAM) return;
  const { event, data } = msg;
  if (event === 'entry') { upsertRow(data.record); }
  else if (event === 'started') { currentTabId = data.tabId; attachInfo.textContent = `Capturing on tab ${data.tabId}`; }
  else if (event === 'stopped') { currentTabId = null; attachInfo.textContent = "Idle"; }
  else if (event === 'cleared') { rows = []; render(); }
});

// init snapshot
(async function init(){
  const st = await chrome.runtime.sendMessage({ __RRDBG: true, cmd: 'getAll' });
  attachInfo.textContent = st.attached ? `Capturing on tab ${st.tabId}` : "Idle (tap icon to start)";
  if (st.attached) currentTabId = st.tabId;
  rows = (st.entries || []);
  render();
})();
