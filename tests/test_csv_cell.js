const assert = require('assert');
const fs = require('fs');

const code = fs.readFileSync('dashboard.js', 'utf8');

function extractFunction(name, source) {
    const regex = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\)\\s*\\{[\\s\\S]*?\\n\\}`);
    const match = source.match(regex);
    return match ? match[0] : null;
}

const csvSafeCode = extractFunction('csvSafe', code);
const csvCellCode = extractFunction('csvCell', code);

console.log("Extracted csvSafe:\n", csvSafeCode);
console.log("Extracted csvCell:\n", csvCellCode);

const csvSafe = eval(`(${csvSafeCode})`);
const csvCell = eval(`(function(){ ${csvSafeCode}; return ${csvCellCode}; })()`);

function test_csv_cell_logic() {
    console.log("Testing csvCell logic...");

    // Normal case
    assert.strictEqual(csvCell("hello"), '"hello"');

    // Quotes case (RFC 4180)
    assert.strictEqual(csvCell('he"llo'), '"he""llo"');

    // Formula case
    assert.strictEqual(csvCell("=1+1"), '"\'=1+1"');

    // Quotes + Formula case
    assert.strictEqual(csvCell('="1+1"'), '"\'=""1+1"""');

    // Null/Undefined case
    assert.strictEqual(csvCell(null), '""');
    assert.strictEqual(csvCell(undefined), '""');

    console.log("[PASS] csvCell logic verified.");
}

try {
    test_csv_cell_logic();
} catch (e) {
    console.error("[FAIL]", e);
    process.exit(1);
}
