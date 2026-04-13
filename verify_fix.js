const assert = require('assert');

function sanitize(s){
  let t = (s || '').replace(/[^a-z0-9._-]+/gi, '_');
  while (t.includes('..')) t = t.replace(/\.\./g, '__');
  return t || '_';
}

function csvSafe(s){
  if (typeof s !== 'string') return s;
  return (['=', '+', '-', '@'].some(c => s.startsWith(c))) ? "'" + s : s;
}

function test_zip_path_traversal() {
    console.log("Testing ZIP path traversal fix...");
    const r = {
        seq: 1,
        method: '../../evil',
        url: 'http://example.com/foo'
    };

    const urlObj = new URL(r.url);
    const host = sanitize(urlObj.hostname);
    const path = sanitize(urlObj.pathname).slice(-50).replace(/^_+/, '');
    const folderName = `${String(r.seq).padStart(5, '0')}_${sanitize(r.method)}_${path}`;
    const base = `${host}/${folderName}`;

    const fileName = `${base}/01_req_headers.txt`;
    console.log("Generated fileName:", fileName);

    assert(!fileName.includes('../'), "Path traversal pattern detected!");
    console.log("[PASS] ZIP path traversal fix verified.");
}

function test_zip_hostname_traversal() {
    console.log("Testing ZIP hostname traversal fix...");
    const r = {
        seq: 1,
        method: 'GET',
        url: 'http://../foo'
    };

    const urlObj = new URL(r.url);
    const host = sanitize(urlObj.hostname);
    const path = sanitize(urlObj.pathname).slice(-50).replace(/^_+/, '');
    const folderName = `${String(r.seq).padStart(5, '0')}_${sanitize(r.method)}_${path}`;
    const base = `${host}/${folderName}`;

    const fileName = `${base}/01_req_headers.txt`;
    console.log("Generated fileName:", fileName);

    assert(!fileName.includes('../'), "Path traversal pattern detected in hostname!");
    console.log("[PASS] ZIP hostname traversal fix verified.");
}

function test_csv_injection() {
    console.log("Testing CSV injection fix...");
    const maliciousInputs = ['=1+1', '+A1', '-1', '@A1'];
    for (const input of maliciousInputs) {
        const safe = csvSafe(input);
        console.log(`${input} -> ${safe}`);
        assert(safe.startsWith("'"), `CSV injection not neutralized for ${input}`);
    }
    console.log("[PASS] CSV injection fix verified.");
}

try {
    test_zip_path_traversal();
    test_zip_hostname_traversal();
    test_csv_injection();
    console.log("\nAll security verification tests passed!");
} catch (e) {
    console.error("\n[FAIL] Security verification failed:", e.message);
    process.exit(1);
}
