const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync('bg.js', 'utf8');

// Extraction logic based on project memory: brace-counting or regex
function extractFunction(name, source) {
  const regex = new RegExp(`function ${name}\\s*\\(([^)]*)\\)\\s*{`);
  const match = regex.exec(source);
  if (!match) return null;

  let pos = match.index + match[0].length;
  let depth = 1;
  while (depth > 0 && pos < source.length) {
    if (source[pos] === '{') depth++;
    else if (source[pos] === '}') depth--;
    pos++;
  }
  return source.substring(match.index, pos);
}

function getContext(source, functionNames) {
  const context = vm.createContext({});
  for (const name of functionNames) {
    const fnCode = extractFunction(name, source);
    if (!fnCode) throw new Error(`Could not extract ${name}`);
    vm.runInNewContext(fnCode, context);
  }
  return context;
}

const context = getContext(code, ['headersFrom', 'mergeHeaders']);
const { headersFrom, mergeHeaders } = context;

const sampleHeadersObj = {};
for (let i = 0; i < 50; i++) {
  sampleHeadersObj[`Header-${i}`] = `Value-${i}`;
}
const sampleHeadersArr = headersFrom(sampleHeadersObj);

const iterations = 100000;

function benchmark(name, fn, ...args) {
  console.log(`Benchmarking ${name} with ${iterations} iterations...`);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn(...args);
  }
  const end = performance.now();
  const duration = end - start;
  console.log(`${name} Baseline Duration: ${duration.toFixed(2)}ms`);
  console.log(`${name} Average: ${(duration / iterations).toFixed(5)}ms per call`);
  return duration;
}

benchmark('headersFrom', headersFrom, sampleHeadersObj);
benchmark('mergeHeaders', mergeHeaders, sampleHeadersArr, sampleHeadersObj);

// Verification
const hfResult = headersFrom({ "Content-Type": "application/json", "X-Test": 123 });
const hfExpected = [
  { name: "Content-Type", value: "application/json" },
  { name: "X-Test", value: "123" }
];
assert.strictEqual(JSON.stringify(hfResult), JSON.stringify(hfExpected));

const mhResult = mergeHeaders([{name: 'h1', value: 'v1'}], {h1: 'v2', h2: 'v3'});
// current mergeHeaders implementation:
// - lowercases names in the map
// - result push name, value from map
// wait, let's check mergeHeaders implementation again
/*
function mergeHeaders(cur, add) {
  const map = new Map();
  const currentHeaders = cur || [];
  for (const h of currentHeaders) {
    map.set(h.name.toLowerCase(), h.value);
  }

  const additionalHeaders = Object.entries(add || {});
  for (const [name, value] of additionalHeaders) {
    map.set(String(name).toLowerCase(), String(value));
  }

  const result = [];
  for (const [name, value] of map) {
    result.push({ name, value });
  }
  return result;
}
*/
const mhExpected = [
  { name: 'h1', value: 'v2' },
  { name: 'h2', value: 'v3' }
];
assert.strictEqual(JSON.stringify(mhResult), JSON.stringify(mhExpected));

console.log("Verification passed!");
