const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../dashboard.js'), 'utf8');

// More robust regex to capture both CRC_TABLE and crc32 function
const tableMatch = /const CRC_TABLE = \(\(\) => \{[\s\S]*?\}\)\(\);/.exec(code);
const functionMatch = /function crc32\(u8\) \{[\s\S]*?return \(c \^ \(-1\)\) >>> 0;[\s\S]*?\}/.exec(code);

if (!tableMatch || !functionMatch) {
  console.error("Could not find CRC32 code blocks in dashboard.js");
  console.log("tableMatch:", !!tableMatch);
  console.log("functionMatch:", !!functionMatch);
  process.exit(1);
}

const crcCode = tableMatch[0] + "\n" + functionMatch[0];

const sandbox = {
  console: console,
  Uint8Array: Uint8Array
};

try {
  vm.runInNewContext(crcCode, sandbox);
} catch (e) {
  console.error("Error running CRC32 code in sandbox:", e);
  process.exit(1);
}

const crc32 = sandbox.crc32;

if (typeof crc32 !== 'function') {
  console.error("crc32 is not a function in sandbox");
  process.exit(1);
}

const assert = (val, expected, msg) => {
  if (val !== expected) {
    console.error(`FAIL: ${msg} | Expected 0x${expected.toString(16).toUpperCase()}, got 0x${val.toString(16).toUpperCase()}`);
    process.exit(1);
  } else {
    console.log(`PASS: ${msg} (0x${val.toString(16).toUpperCase()})`);
  }
};

const encoder = new TextEncoder();

console.log("Running CRC32 tests...");

// Test Cases
// Note: crc32(empty) should be 0 because of the XOR with -1 at start and end.
// 0 ^ (-1) = -1. If loop doesn't run: (-1 ^ -1) >>> 0 = 0.
assert(crc32(new Uint8Array([])), 0, "Empty input");
assert(crc32(encoder.encode("123456789")), 0xCBF43926, "String '123456789'");
assert(crc32(encoder.encode("The quick brown fox jumps over the lazy dog")), 0x414FA339, "Fox string");

console.log("\nAll CRC32 tests passed successfully!");
