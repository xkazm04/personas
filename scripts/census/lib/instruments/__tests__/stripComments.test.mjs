#!/usr/bin/env node
// Regression tests for scripts/census/lib/instruments/stripComments.mjs
//
// The recorded bug (doctrine §2, "Assert the instrument before you trust the
// result"): scripts/check-csp-hosts.mjs reported ZERO frontend fetch hosts
// twice, the second time because its comment stripper ate the URLs — `https://`
// contains `//`, so a naive line-comment regex blanks the rest of every line
// holding a URL. Without the exit-2 guard, both versions would have exited 0
// and looked like working gates indefinitely.
//
// Case 1 is that bug. Case 2 shows the naive stripper failing the same fixture.
//
// Run:  node scripts/census/lib/instruments/__tests__/stripComments.test.mjs

import { stripComments } from '../stripComments.mjs';

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

const HOSTS_FIXTURE = [
  "const BASE = 'https://api.anthropic.com/v1';           // the metered door",
  'const CDN = "https://cdn.example.com/assets";',
  'const SENTRY = `https://ingest.sentry.io/${projectId}`;',
  '// https://not-a-host.example.com  <- this one IS a comment and must go',
  'fetch(BASE + path);',
].join('\n');

// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: THE RECORDED BUG — URLs in strings must survive');
{
  const out = stripComments(HOSTS_FIXTURE, { lang: 'ts' });
  expect('api.anthropic.com survives', out.includes('https://api.anthropic.com/v1'), out.split('\n')[0]);
  expect('cdn.example.com survives', out.includes('https://cdn.example.com/assets'));
  expect('template-literal host survives', out.includes('https://ingest.sentry.io/'));
  expect('the trailing line comment is gone', !out.includes('the metered door'));
  expect('the comment-only URL is gone', !out.includes('not-a-host.example.com'));
  expect('code after the comment survives', out.includes('fetch(BASE + path);'));
  expect('length preserved', out.length === HOSTS_FIXTURE.length, `${out.length} vs ${HOSTS_FIXTURE.length}`);
  expect('line count preserved', out.split('\n').length === HOSTS_FIXTURE.split('\n').length);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: the naive stripper fails the SAME fixture (the test has teeth)');
{
  const naive = HOSTS_FIXTURE.replace(/\/\/[^\n]*/g, '');
  const hostsNaive = (naive.match(/https:\/\//g) || []).length;
  expect('naive stripper destroys every host (0 left)', hostsNaive === 0,
    `naive left ${hostsNaive}; if this ever equals 3 the fixture stopped exercising the bug`);
  console.log('     (naive: 0/3 hosts survive — the "reported ZERO fetch hosts" failure, reproduced)');
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: the (?<!:) guard, independently of the string scanner');
{
  // A bare scheme in code position — what you get when the string scanner has
  // lost sync on an unusual file. The guard is the second line of defence.
  const src = 'x = https://host/path; y = 1; // real comment';
  const out = stripComments(src);
  expect('the scheme-slash did not open a comment', out.includes('https://host/path'), out);
  expect('the real comment still went', !out.includes('real comment'), out);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: block comments, multi-line, line structure preserved');
{
  const src = [
    'const a = 1;',
    '/**',
    ' * doc comment about https://example.com',
    ' */',
    'const b = 2;',
  ].join('\n');
  const out = stripComments(src);
  expect('doc comment gone', !out.includes('doc comment'));
  expect('const b still on line 5',
    out.slice(0, out.indexOf('const b')).split('\n').length === 5,
    `line ${out.slice(0, out.indexOf('const b')).split('\n').length}`);
  expect('length preserved', out.length === src.length);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: a comment-looking sequence inside a string is not a comment');
{
  const src = 'const glob = "src/**/*.ts"; const re = "/* not a comment */"; const z = 3;';
  const out = stripComments(src);
  expect('glob survives', out.includes('src/**/*.ts'), out);
  expect('string containing /* */ survives', out.includes('/* not a comment */'), out);
  expect('trailing code survives', out.includes('const z = 3;'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: regex literals containing slashes');
{
  const src = 'const re = /https:\\/\\/[^/]+/g; // strip me\nconst q = 1;';
  const out = stripComments(src);
  expect('regex literal survives', out.includes('/https:\\/\\/[^/]+/g'), out);
  expect('comment after the regex is stripped', !out.includes('strip me'), out);
  expect('next line survives', out.includes('const q = 1;'));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: Rust — doc comments go, string URLs and raw strings stay');
{
  const src = [
    '/// Calls https://api.example.com — doc comment, must go',
    'const URL: &str = "https://api.example.com/v1";',
    'let p = r#"C:\\some\\path // not a comment"#;',
    '/* nested /* block */ still comment */ let after = 1;',
  ].join('\n');
  const out = stripComments(src, { lang: 'rust' });
  expect('doc comment gone', !out.includes('doc comment, must go'), out.split('\n')[0]);
  expect('URL string survives', out.includes('https://api.example.com/v1'));
  expect('raw string with // survives', out.includes('// not a comment'), out.split('\n')[2]);
  expect('nested block comment fully consumed', !out.includes('still comment'), out.split('\n')[3]);
  expect('code after the nested comment survives', out.includes('let after = 1;'));
  expect('length preserved', out.length === src.length, `${out.length} vs ${src.length}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 8: CRLF input keeps its length');
{
  const src = 'const a = 1; // x\r\nconst b = 2;\r\n';
  const out = stripComments(src);
  expect('length preserved on CRLF', out.length === src.length, `${out.length} vs ${src.length}`);
  expect('comment gone', !out.includes('// x'));
  expect('CR preserved', out.includes('\r\n'));
}

console.log(`\nstripComments: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
