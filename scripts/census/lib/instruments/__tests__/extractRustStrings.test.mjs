#!/usr/bin/env node
// Regression tests for scripts/census/lib/instruments/extractRustStrings.mjs
//
// Two recorded drafts, two different silent undercounts, one hand-verified
// truth of 141:
//   draft 1 — newline excluded from the string class → multi-line SQL invisible
//             (33 and 22 reported)
//   draft 2 — `\\.` escape class, where `.` does not match a newline → a line
//             continuation split ORDER BY from its LIMIT (104 and 63 reported)
//
// Case 1 and Case 2 are those two bugs, verbatim in shape.
//
// Run:  node scripts/census/lib/instruments/__tests__/extractRustStrings.test.mjs

import { extractRustStrings, maskRustLiteralsAndComments } from '../extractRustStrings.mjs';

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: DRAFT-1 BUG — a multi-line SQL literal must be one literal, whole');
{
  const src = [
    'let sql = "',
    '    SELECT id, name',
    '    FROM personas',
    '    WHERE enabled = 1',
    '";',
    'let other = "short";',
  ].join('\n');
  const lits = extractRustStrings(src);
  expect('two literals found', lits.length === 2, `got ${lits.length}: ${JSON.stringify(lits.map(l => l.content.slice(0, 20)))}`);
  expect('the SQL literal spans newlines', lits[0].content.includes('\n'), JSON.stringify(lits[0].content));
  expect('SELECT and WHERE are in the SAME literal',
    lits[0].content.includes('SELECT') && lits[0].content.includes('WHERE enabled = 1'));
  expect('the SQL literal starts on line 1', lits[0].startLine === 1, `got ${lits[0].startLine}`);
  expect('the short literal starts on line 6', lits[1].startLine === 6, `got ${lits[1].startLine}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: DRAFT-2 BUG — a line continuation must not terminate the literal');
{
  // A trailing backslash before the newline is a Rust line continuation. The
  // recorded failure split this exact construct between ORDER BY and LIMIT.
  const src = 'let q = "SELECT * FROM runs ORDER BY started_at DESC \\\n    LIMIT 50";\nlet z = 1;\n';
  const lits = extractRustStrings(src);
  expect('exactly one literal', lits.length === 1, `got ${lits.length}`);
  expect('ORDER BY and LIMIT are in the same literal',
    lits[0].content.includes('ORDER BY') && lits[0].content.includes('LIMIT 50'),
    JSON.stringify(lits[0].content));
  expect('the literal did not swallow the rest of the file', !lits[0].content.includes('let z'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: escaped quotes do not end the literal');
{
  const src = 'let s = "he said \\"hi\\" then left";\nlet t = "after";\n';
  const lits = extractRustStrings(src);
  expect('two literals', lits.length === 2, `got ${lits.length}`);
  expect('escaped quotes kept inside', lits[0].content === 'he said \\"hi\\" then left', JSON.stringify(lits[0].content));
  expect('second literal is "after"', lits[1].content === 'after');
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: raw and raw-hash strings');
{
  const src = [
    'let a = r"C:\\path\\no\\escapes";',
    'let b = r#"contains a " quote"#;',
    'let c = r##"contains "# inside"##;',
    'let d = br#"bytes"#;',
  ].join('\n');
  const lits = extractRustStrings(src);
  expect('four literals', lits.length === 4, `got ${lits.length}: ${JSON.stringify(lits.map(l => l.content))}`);
  expect('raw keeps backslashes literal', lits[0].content === 'C:\\path\\no\\escapes', JSON.stringify(lits[0].content));
  expect('raw-hash tolerates an inner quote', lits[1].content === 'contains a " quote', JSON.stringify(lits[1].content));
  expect('double-hash tolerates an inner "#', lits[2].content === 'contains "# inside', JSON.stringify(lits[2].content));
  expect('byte-raw recognised', lits[3].kind === 'byte-raw' && lits[3].content === 'bytes');
  expect('kinds are labelled', lits.map(l => l.kind).join(',') === 'raw,raw-hash,raw-hash,byte-raw', lits.map(l => l.kind).join(','));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: lifetimes are not strings (a lifetime opens a quote that never closes)');
{
  const src = [
    "pub fn f<'a>(x: &'a str) -> &'a str { x }",
    'let c = \'x\';',
    'let n = \'\\n\';',
    'let s = "the only string";',
  ].join('\n');
  const lits = extractRustStrings(src);
  expect('exactly one string literal', lits.length === 1, `got ${lits.length}: ${JSON.stringify(lits.map(l => l.content))}`);
  expect('it is the right one', lits[0].content === 'the only string', JSON.stringify(lits[0].content));
  expect('it is on line 4', lits[0].startLine === 4, `got ${lits[0].startLine}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: comments are not strings, and strings in comments are not strings');
{
  const src = [
    '// let fake = "not a literal";',
    '/* block "also not" */',
    'let real = "yes";',
    '/* nested /* inner "no" */ still comment */',
    'let real2 = "yes2";',
  ].join('\n');
  const lits = extractRustStrings(src);
  expect('two literals', lits.length === 2, `got ${lits.length}: ${JSON.stringify(lits.map(l => l.content))}`);
  expect('nested block comment handled', lits[1].content === 'yes2', JSON.stringify(lits[1].content));
  expect('line numbers survive comments', lits[0].startLine === 3 && lits[1].startLine === 5,
    `${lits[0].startLine},${lits[1].startLine}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: startCol is the first character of the literal, 1-based');
{
  const src = 'let x = "abc";\n    let y = r#"d"#;\n';
  const lits = extractRustStrings(src);
  expect('normal string col 9', lits[0].startCol === 9, `got ${lits[0].startCol}`);
  expect('raw-hash col points at the `r`', lits[1].startCol === 13, `got ${lits[1].startCol}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 8: the mask preserves every byte offset and line');
{
  const src = 'let a = "hide me";\n// comment here\nlet b = 1;\n';
  const masked = maskRustLiteralsAndComments(src);
  expect('same length', masked.length === src.length, `${masked.length} vs ${src.length}`);
  expect('same line count', masked.split('\n').length === src.split('\n').length);
  expect('string interior blanked', !masked.includes('hide me'));
  expect('quotes retained (structure survives)', masked.includes('"') );
  expect('comment blanked', !masked.includes('comment here'));
  expect('code untouched', masked.includes('let b = 1;'));
  expect('offset of `let b` unchanged', masked.indexOf('let b') === src.indexOf('let b'));
}

console.log(`\nextractRustStrings: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
