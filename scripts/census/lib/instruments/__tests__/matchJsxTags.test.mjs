#!/usr/bin/env node
// Regression tests for scripts/census/lib/instruments/matchJsxTags.mjs
//
// The recorded bug (doctrine §4): a TSX generic `<UnifiedTable<PersonaEvent>`
// closed a scanner's opening tag at the GENERIC's `>`, so the scanner reported
// 2 of 17 virtualized when the truth was 6. Three independent composers hit the
// same wall. The error under-reports exactly the carefully-typed call sites.
//
// Second half of the same bug: a census pattern missed a real site because
// `errPct >= 10` puts a `>` outside `(?:=>|[^<>])`.
//
// Case 1 reproduces both against a fixture whose truth is known by construction,
// and Case 2 shows the naive matcher failing on the same fixture — a test that
// only asserts the fix is a test that would still pass if the fix were reverted
// to a different wrong answer.
//
// Run:  node scripts/census/lib/instruments/__tests__/matchJsxTags.test.mjs

import { matchJsxTags } from '../matchJsxTags.mjs';

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

// A fixture built to the recorded shape: 17 UnifiedTable call sites, 6 of which
// pass `virtualized`. Ten are generic-typed; the naive matcher stops at the
// generic's `>` and cannot see any attribute after it.
function buildFixture() {
  const rows = [];
  const virtualizedAt = new Set([0, 3, 5, 9, 12, 16]); // 6 of 17
  for (let i = 0; i < 17; i++) {
    const generic = i % 2 === 0 ? `<Row${i}>` : '';
    const v = virtualizedAt.has(i) ? ' virtualized' : '';
    rows.push(`      <UnifiedTable${generic} columns={cols${i}} data={rows${i}}${v} />`);
  }
  return `export function Page() {\n  return (\n    <div>\n${rows.join('\n')}\n    </div>\n  );\n}\n`;
}

// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: THE RECORDED BUG — generics must not close the tag');
{
  const src = buildFixture();
  const tags = matchJsxTags(src, { names: ['UnifiedTable'] });
  expect('17 UnifiedTable sites found', tags.length === 17, `got ${tags.length}`);
  const virt = tags.filter((t) => /\bvirtualized\b/.test(t.attrs));
  expect('6 of them carry `virtualized` (the truth, not the 2 the bug reported)',
    virt.length === 6, `got ${virt.length}`);
  expect('every generic tag captured its type argument',
    tags.filter((t) => t.generic).length === 9, `got ${tags.filter((t) => t.generic).length}`);
  expect('all are self-closing', tags.every((t) => t.selfClosing));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: the naive matcher fails the SAME fixture (the test has teeth)');
{
  const src = buildFixture();
  const naive = [...src.matchAll(/<UnifiedTable[^>]*>/g)].map((m) => m[0]);
  const naiveVirt = naive.filter((s) => /\bvirtualized\b/.test(s));
  expect('naive matcher under-reports virtualized (<6)', naiveVirt.length < 6,
    `naive found ${naiveVirt.length}; if this ever equals 6 the fixture stopped exercising the bug`);
  console.log(`     (naive: ${naiveVirt.length}/6 virtualized — the shape of the recorded 2/6)`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: `>=`, `<=`, `=>` inside attribute expressions are not delimiters');
{
  const src = [
    '<StatTile',
    '  tone={errPct >= 10 ? "bad" : "ok"}',
    '  width={a <= b ? 1 : 2}',
    '  onSelect={(row) => setSelected(row.id)}',
    '  label="done"',
    '/>',
  ].join('\n');
  const tags = matchJsxTags(src);
  expect('one tag found', tags.length === 1, `got ${tags.length}`);
  expect('the tag ends at the real `/>`', tags[0].end === src.length, `end=${tags[0].end} len=${src.length}`);
  expect('attrs carry the last attribute', /label="done"/.test(tags[0].attrs), tags[0].attrs);
  expect('self-closing detected', tags[0].selfClosing);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: nested generics');
{
  const src = '<DataGrid<Map<string, Array<Row>>> data={d} dense />';
  const tags = matchJsxTags(src);
  expect('one tag', tags.length === 1, `got ${tags.length}`);
  expect('generic captured whole', tags[0].generic === '<Map<string, Array<Row>>>', tags[0].generic);
  expect('`dense` is in attrs (tag did not close early)', /\bdense\b/.test(tags[0].attrs), tags[0].attrs);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: what is NOT a component open tag');
{
  const src = [
    '</UnifiedTable>',            // closing
    '<>fragment</>',              // fragment
    '<div className="x" />',      // intrinsic
    'const ok = a < b && c > d;', // arithmetic
    '<Real prop={1} />',          // the only one
  ].join('\n');
  const tags = matchJsxTags(src);
  expect('only the component open tag matches', tags.length === 1 && tags[0].name === 'Real',
    JSON.stringify(tags.map((t) => t.name)));
  const withIntrinsics = matchJsxTags(src, { intrinsics: true });
  expect('intrinsics:true also finds <div>', withIntrinsics.some((t) => t.name === 'div'),
    JSON.stringify(withIntrinsics.map((t) => t.name)));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: dotted components, strings containing `>` and children');
{
  const src = [
    '<Menu.Item label="a > b" onClick={fn}>',
    '  <Icon name="x" />',
    '</Menu.Item>',
  ].join('\n');
  const tags = matchJsxTags(src);
  expect('two open tags', tags.length === 2, JSON.stringify(tags.map((t) => t.name)));
  expect('dotted name captured', tags[0].name === 'Menu.Item', tags[0].name);
  expect('a `>` inside a string attribute did not close the tag',
    tags[0].raw.endsWith('onClick={fn}>'), tags[0].raw);
  expect('open tag is not self-closing', tags[0].selfClosing === false);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: line numbers are 1-based and correct');
{
  const src = 'const a = 1;\n\n<Foo />\n\n<Bar />\n';
  const tags = matchJsxTags(src);
  expect('Foo on line 3', tags[0].line === 3, `got ${tags[0].line}`);
  expect('Bar on line 5', tags[1].line === 5, `got ${tags[1].line}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 8: a JSX comment inside the tag');
{
  const src = '<Panel /* keep */ title="t" />';
  const tags = matchJsxTags(src);
  expect('one tag', tags.length === 1, `got ${tags.length}`);
  expect('title survives', /title="t"/.test(tags[0].attrs), tags[0].attrs);
}

console.log(`\nmatchJsxTags: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
