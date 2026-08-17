#!/usr/bin/env node
// Regression tests for scripts/census/lib/instruments/stripCfgTest.mjs
//
// The bug on record: two implementations agreed on WHAT the defect was and
// disagreed on WHERE it was, because one stripper ate newlines and placed a
// site 16 lines early. So the assertions here are about LINE NUMBERS, not about
// what survived the strip.
//
// Run:  node scripts/census/lib/instruments/__tests__/stripCfgTest.test.mjs

import { stripCfgTest, stripCfgTestDetailed, isRustTestFile } from '../stripCfgTest.mjs';

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}
const lineOf = (src, needle) => src.slice(0, src.indexOf(needle)).split('\n').length;

// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: THE RECORDED BUG — a stripped module must not move later lines');
{
  const src = [
    'pub fn alpha() {}',                    // 1
    '',                                     // 2
    '#[cfg(test)]',                         // 3
    'mod tests {',                          // 4
    '    use super::*;',                    // 5
    '    #[test]',                          // 6
    '    fn t1() { assert!(true); }',        // 7
    '    #[test]',                          // 8
    '    fn t2() { assert!(true); }',        // 9
    '}',                                    // 10
    '',                                     // 11
    'pub fn THE_SITE() {}',                 // 12
  ].join('\n');

  const before = lineOf(src, 'THE_SITE');
  const out = stripCfgTest(src);
  const after = lineOf(out, 'THE_SITE');

  expect('site is on line 12 before stripping', before === 12, `got ${before}`);
  expect('site is STILL on line 12 after stripping', after === 12, `got ${after} (drift ${before - after})`);
  expect('byte length is unchanged', out.length === src.length, `${out.length} vs ${src.length}`);
  expect('line count is unchanged', out.split('\n').length === src.split('\n').length);
  expect('test body is gone', !out.includes('assert!'), out.slice(0, 120));
  expect('production code survives', out.includes('pub fn alpha') && out.includes('pub fn THE_SITE'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: a brace inside a string must not close the module early');
{
  const src = [
    '#[cfg(test)]',
    'mod tests {',
    '    fn t() { let s = "a } brace in a string"; }',
    '    fn still_test() { assert!(true); }',
    '}',
    'pub fn real() -> i32 { 1 }',
  ].join('\n');
  const out = stripCfgTest(src);
  expect('still_test stripped (module did not close at the string brace)', !out.includes('still_test'), out);
  expect('real() survives', out.includes('pub fn real'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: a brace inside a comment must not close the module early');
{
  const src = [
    '#[cfg(test)]',
    'mod tests {',
    '    // closing } in a comment',
    '    fn still_test() {}',
    '}',
    'pub fn real() {}',
  ].join('\n');
  const out = stripCfgTest(src);
  expect('still_test stripped', !out.includes('still_test'));
  expect('real() survives', out.includes('pub fn real'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: cfg spellings — test-bearing stripped, others untouched');
{
  const src = [
    '#[cfg(all(test, feature = "desktop"))]',
    'mod a { fn x() {} }',
    '#[cfg(any(test, doctest))]',
    'mod b { fn y() {} }',
    '#[cfg(feature = "ml")]',
    'mod c { fn KEEP_ME() {} }',
    '#[cfg(not(target_os = "windows"))]',
    'mod d { fn KEEP_TOO() {} }',
  ].join('\n');
  const { code, stripped } = stripCfgTestDetailed(src);
  expect('all(test,…) stripped', !code.includes('fn x'));
  expect('any(test,…) stripped', !code.includes('fn y'));
  expect('feature-gated module KEPT', code.includes('KEEP_ME'));
  expect('target_os module KEPT', code.includes('KEEP_TOO'));
  expect('exactly 2 ranges stripped', stripped.length === 2, `got ${stripped.length}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: a test module in the MIDDLE of the file (never a line threshold)');
{
  const src = [
    'pub fn first() {}',
    '#[cfg(test)]',
    'mod mid { fn hidden() {} }',
    'pub fn last() {}',
  ].join('\n');
  const out = stripCfgTest(src);
  expect('mid module stripped', !out.includes('fn hidden'));
  expect('code AFTER the test module survives', out.includes('pub fn last'));
  expect('last() line number unchanged', lineOf(out, 'pub fn last') === lineOf(src, 'pub fn last'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: nested braces and a nested test module');
{
  const src = [
    '#[cfg(test)]',
    'mod outer {',
    '    mod inner { fn deep() { if true { let _ = 1; } } }',
    '}',
    'pub fn survivor() {}',
  ].join('\n');
  const out = stripCfgTest(src);
  expect('deep() stripped', !out.includes('fn deep'));
  expect('survivor survives', out.includes('pub fn survivor'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: the filename rule — a brace-matched range cannot see these');
{
  expect('dev_tools_backlog_tests.rs is a test file',
    isRustTestFile('src-tauri/db/src/dev_tools_backlog_tests.rs'));
  expect('tests/ directory is a test file',
    isRustTestFile('src-tauri/tests/integration.rs'));
  expect('a normal module is not',
    !isRustTestFile('src-tauri/src/engine/runner.rs'));
  expect('a module merely containing the word test is not',
    !isRustTestFile('src-tauri/src/engine/latest_run.rs'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 8: CRLF source keeps CRLF line accounting');
{
  const src = ['pub fn a() {}', '#[cfg(test)]', 'mod t { fn x() {} }', 'pub fn b() {}'].join('\r\n');
  const out = stripCfgTest(src);
  expect('length preserved on CRLF', out.length === src.length, `${out.length} vs ${src.length}`);
  expect('b() line unchanged on CRLF',
    out.slice(0, out.indexOf('pub fn b')).split('\n').length === src.slice(0, src.indexOf('pub fn b')).split('\n').length);
  expect('test module stripped on CRLF', !out.includes('fn x'));
}

console.log(`\nstripCfgTest: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
