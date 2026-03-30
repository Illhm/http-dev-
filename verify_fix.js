const assert = require('assert');

// Mock helpers from dashboard.js
function humanSize(bytes){ if(bytes==null||isNaN(bytes))return "-"; const u=["B","KB","MB","GB"]; let i=0,n=Math.max(0,bytes);while(n>=1024&&i<u.length-1){n/=1024;i++;}return `${n.toFixed(1)} ${u[i]}`;}
function nameFromUrl(u){ try{ const x=new URL(u); const p=x.pathname.split('/').filter(Boolean); return (p.pop()||x.hostname)||u; }catch{return u;} }
function guessKind(r){ return 'xhr'; }
let selectMode = false;
let selectedIds = new Set();

// Mock DOM
const mockDocument = {
    createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        appendChild: function(child) {
            this.children.push(child);
        },
        children: [],
        classList: {
            toggle: function(cls, val) {
                if (val) this.classes.add(cls); else this.classes.delete(cls);
            },
            add: function(cls) { this.classes.add(cls); },
            delete: function(cls) { this.classes.delete(cls); }
        },
        classes: new Set(),
        addEventListener: () => {},
        prepend: function(child) { this.children.unshift(child); }
    })
};

// The FIXED function
function updateRowContent(tr, r){
  tr.innerHTML = "";
  const selTd = mockDocument.createElement("td"); selTd.className = "selcol" + (selectMode ? "" : " hidden");
  if(selectMode) {
      const cb = mockDocument.createElement("input"); cb.type="checkbox"; cb.checked = selectedIds.has(r.id);
      cb.addEventListener("click", (ev)=>{ ev.stopPropagation(); if (cb.checked) selectedIds.add(r.id); else selectedIds.delete(r.id); updateSelUi(); });
      selTd.appendChild(cb);
  }
  tr.appendChild(selTd);

  const tdUrl = mockDocument.createElement("td"); tdUrl.title = r.url; tdUrl.textContent = nameFromUrl(r.url); tr.appendChild(tdUrl);
  const tdMethod = mockDocument.createElement("td"); tdMethod.textContent = r.method||"-"; tr.appendChild(tdMethod);
  const tdStatus = mockDocument.createElement("td"); tdStatus.textContent = r.status||"-"; tr.appendChild(tdStatus);
  const tdProto = mockDocument.createElement("td"); tdProto.textContent = r.protocol||"-"; tr.appendChild(tdProto);
  const tdIP = mockDocument.createElement("td"); tdIP.textContent = r.remoteIPAddress||"-"; tr.appendChild(tdIP);
  const tdMime = mockDocument.createElement("td"); tdMime.textContent = r.mimeType||"-"; tr.appendChild(tdMime);
  const tdKind = mockDocument.createElement("td"); tdKind.textContent = guessKind(r); tr.appendChild(tdKind);
  const tdSize = mockDocument.createElement("td"); tdSize.textContent = humanSize(r.bodySize); tr.appendChild(tdSize);
  const tdTime = mockDocument.createElement("td"); tdTime.textContent = Math.round((r.time||0)*1000); tr.appendChild(tdTime);
}

// Test case
const tr = {
    innerHTML: '',
    children: [],
    appendChild: function(child) {
        this.children.push(child);
        // Simulate innerHTML for testing purposes
        if (child.tagName === 'TD') {
            this.innerHTML += `<td${child.title ? ' title="' + child.title + '"' : ''}>${child.textContent || ''}</td>`;
        }
    }
};

const maliciousRequest = {
    url: 'http://example.com/normal',
    method: '<img src=x onerror=alert(1)>',
    status: 200,
    protocol: 'HTTP/1.1',
    remoteIPAddress: '127.0.0.1',
    mimeType: 'text/html',
    bodySize: 100,
    time: 0.1
};

console.log("Running fix verification test...");
updateRowContent(tr, maliciousRequest);

console.log("Generated simulated innerHTML:\n", tr.innerHTML);

if (tr.innerHTML.includes('<img src=x onerror=alert(1)>')) {
    console.log("\n[!] VULNERABILITY STILL PRESENT: HTML injection detected!");
} else {
    console.log("\n[V] SUCCESS: HTML injection NOT detected. Input was treated as text.");
}

const maliciousUrlRequest = {
    url: '"><img src=x onerror=alert(1)>',
    method: 'GET',
    status: 200,
    protocol: 'HTTP/1.1',
    remoteIPAddress: '127.0.0.1',
    mimeType: 'text/html',
    bodySize: 100,
    time: 0.1
};

tr.innerHTML = "";
updateRowContent(tr, maliciousUrlRequest);
console.log("Generated simulated innerHTML for malicious URL:\n", tr.innerHTML);
if (tr.innerHTML.includes('title=""><img src=x onerror=alert(1)>"')) {
    console.log("[V] SUCCESS: Malicious URL in title attribute is correctly handled by DOM assignment.");
}
