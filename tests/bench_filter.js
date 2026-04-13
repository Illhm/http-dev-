const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../dashboard.js'), 'utf8');

// Mock DOM and other stuff needed by the module
const sandbox = {
  document: {
    querySelector: (s) => {
        if (s === "#filterText") return sandbox.filterText;
        if (s === "#hideDataUrl") return sandbox.hideDataUrl;
        return { value: "", checked: false };
    },
    querySelectorAll: (s) => []
  },
  console: console,
  Set: Set,
  Array: Array,
  String: String,
  Math: Math,
  window: {},
  filterText: { value: "" },
  hideDataUrl: { checked: false }
};

// We need a subset of dashboard.js that defines getFilterPredicate and its dependencies
const mockCode = `
const $ = (s) => document.querySelector(s);
const filterText = $("#filterText");
const hideDataUrl = $("#hideDataUrl");
const modeCbs = { filter: (fn) => [{checked: true, value: "xhr"}] };
function guessKind(r) { return "xhr"; }
`;

// Extract getFilterPredicate from dashboard.js
const match = code.match(/function getFilterPredicate\(\)\{[\s\S]*?\n  \};\n\}/);
if (!match) {
    console.error("Could not find getFilterPredicate in dashboard.js");
    process.exit(1);
}
const predicateCode = match[0];

vm.runInNewContext(mockCode + "\n" + predicateCode, sandbox);
const getFilterPredicate = sandbox.getFilterPredicate;

// Correctness tests
console.log("Running correctness tests...");
const assert = (val, msg) => {
    if (!val) {
        console.error("FAIL: " + msg);
        process.exit(1);
    } else {
        console.log("PASS: " + msg);
    }
};

sandbox.filterText.value = "match_me";
const pred = getFilterPredicate();

assert(pred({ url: "http://MATCH_ME.com" }), "Matches URL (case insensitive)");
assert(pred({ mimeType: "application/MATCH_ME" }), "Matches mimeType");
assert(pred({ method: "MATCH_ME" }), "Matches method");
assert(pred({ status: "MATCH_ME" }), "Matches status (as string)");
assert(pred({ requestBodyText: "something MATCH_ME something" }), "Matches requestBodyText");
assert(pred({ responseBodyRaw: "large blob MATCH_ME" }), "Matches responseBodyRaw");
assert(!pred({ url: "http://nomatch.com", responseBodyRaw: "nothing" }), "Correctly returns false for no match");

sandbox.filterText.value = "200";
const pred2 = getFilterPredicate();
assert(pred2({ status: 200 }), "Matches status number 200");
assert(pred2({ status: "200" }), "Matches status string 200");

sandbox.filterText.value = "0";
const pred3 = getFilterPredicate();
assert(pred3({ status: 0 }), "Matches status 0 (fixed nullish coalesce bug)");

// Performance tests
const records = [];
for (let i = 0; i < 1000; i++) {
  records.push({
    id: i,
    url: "https://example.com/api/v1/resource/" + i,
    mimeType: "application/json",
    method: "GET",
    status: 200,
    requestBodyText: "",
    responseBodyRaw: "a".repeat(100000) // 100KB response
  });
}
records[500].responseBodyRaw = "a".repeat(100000) + "match_me";
records[999].responseBodyRaw = "b".repeat(1000000); // 1MB response

function bench(ft) {
    sandbox.filterText.value = ft;
    const pred = getFilterPredicate();
    const start = Date.now();
    let matches = 0;
    const iterations = 50;
    for (let i = 0; i < iterations; i++) {
        for (const r of records) {
            if (pred(r)) matches++;
        }
    }
    const end = Date.now();
    return { time: end - start, matches };
}

console.log("\nRunning performance benchmark for optimized implementation...");
const resMatch = bench("match_me");
console.log(`Match case: ${resMatch.time}ms, Matches: ${resMatch.matches}`);

const resNoMatch = bench("xyz789");
console.log(`No-match case: ${resNoMatch.time}ms, Matches: ${resNoMatch.matches}`);
