#!/usr/bin/env node
// Fixture tests for scripts/docs/check-golden-path-touch.mjs.
//
// Same shape as check-doc-sync.test.mjs: each case writes a synthetic JSONL
// transcript containing one user message followed by an assistant tool_use
// block, pipes a Stop-hook payload to the hook, and asserts on exit code +
// stderr.
//
// The load-bearing case is Case 2. The live composition wave edits golden
// paths, rules.json and the census scripts all day long; if this hook fired on
// that session's edit set it would be pure noise and would be deleted within a
// day. So its whole edit set is asserted silent, explicitly.
//
// Run:  node scripts/docs/__tests__/check-golden-path-touch.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(REPO_ROOT, 'scripts/docs/check-golden-path-touch.mjs');
const ROUTER = path.join(REPO_ROOT, 'docs/concepts/golden-paths/router.json');

let passed = 0, failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; failures.push({ label, detail }); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

function buildTranscript(toolCalls) {
  const userEvt = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } };
  const assistantEvt = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: toolCalls.map((c) => ({ type: 'tool_use', name: c.tool || 'Edit', input: { file_path: c.path } })),
    },
  };
  return [JSON.stringify(userEvt), JSON.stringify(assistantEvt)].join('\n') + '\n';
}

function runHook(toolCalls, { stopHookActive = false, projectDir = REPO_ROOT } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-touch-'));
  const transcript = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, buildTranscript(toolCalls));
  const payload = JSON.stringify({ transcript_path: transcript, stop_hook_active: stopHookActive });
  const r = spawnSync('node', [HOOK], {
    input: payload,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { code: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

// Pick real fixtures OUT OF THE COMMITTED ROUTER rather than hardcoding paths.
// check-doc-sync.test.mjs shipped a fixture pointing at src/features/deployment/,
// a directory that does not exist; the case passed anyway because the paths are
// synthetic, so it asserted a hook fires for a file nobody can edit. Deriving
// the fixtures from the artifact makes that failure impossible here.
// The fixture must also survive the hook's OWN skip patterns. The first run of
// this suite picked src/__tests__/structural/personas-page-code-splitting.test.ts
// as the singly-governed fixture — a file the hook correctly refuses to fire on —
// and Case 9 failed for a reason that had nothing to do with Case 9.
const looksSkipped = (f) =>
  /(^|\/)__tests__\//.test(f) || /\.(test|spec)\.[a-z]+$/.test(f) ||
  /\.(gen|generated)\.[a-z]+$/.test(f) || f.startsWith('src/lib/bindings/') ||
  f.startsWith('src/i18n/locales/') || f.startsWith('src/i18n/section-locales/');

const router = JSON.parse(fs.readFileSync(ROUTER, 'utf8'));
const srcFiles = Object.keys(router.byFile)
  .filter((f) => f.startsWith('src/') && /\.(ts|tsx|rs)$/.test(f) && !looksSkipped(f));
const MULTI = srcFiles
  .map((f) => [f, router.byFile[f]])
  .filter(([, e]) => e.length >= 4)
  .sort((a, b) => b[1].length - a[1].length)[0];
const SINGLE = srcFiles.map((f) => [f, router.byFile[f]]).find(([, e]) => e.length === 1);

console.log(`Fixtures from the committed router: ${MULTI[0]} (${MULTI[1].length} paths), ${SINGLE[0]} (1 path)\n`);

// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: a governed source file fires, ranked, capped at 3');
{
  const r = runHook([{ tool: 'Edit', path: MULTI[0] }]);
  expect('exit code is 2', r.code === 2, `got ${r.code}`);
  expect('names the governed-paths headline',
    r.stderr.includes('This turn edited files governed by golden path(s):'), r.stderr.slice(0, 200));
  expect('names the touched file', r.stderr.includes(MULTI[0]));
  expect('quotes a §2 prescription', /§2:/.test(r.stderr));
  expect('links the document', /docs\/concepts\/golden-paths\/.+\.md/.test(r.stderr));
  expect('carries the dismissal contract',
    /Dismiss path: reply with one short sentence/.test(r.stderr));

  // Ranking + cap: the top-ranked leaf must be the one with the highest count
  // for this file, and no more than 3 leaves may appear as bullets.
  const expectedTop = [...MULTI[1]].sort((a, b) => b.count - a.count || a.leaf.localeCompare(b.leaf))[0].leaf;
  const firstBullet = (r.stderr.split('\n').find((l) => l.startsWith('  - ')) || '');
  expect(`top-ranked path is the most-citing one (${expectedTop})`,
    firstBullet.includes(expectedTop), firstBullet);
  const bullets = r.stderr.split('\n').filter((l) => /^ {2}- /.test(l));
  expect('at most 3 paths shown', bullets.length <= 3, `got ${bullets.length}`);
  expect('overflow is disclosed, never dropped silently',
    MULTI[1].length <= 3 || /further golden path\(s\) also cite these files/.test(r.stderr),
    r.stderr.slice(-300));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: THE LOAD-BEARING ONE — the composition wave never sees this hook');
{
  // This is the parallel session's actual edit set.
  const waveEdits = [
    { tool: 'Write', path: 'docs/concepts/golden-paths/entity-picker.md' },
    { tool: 'Edit', path: 'scripts/census/rules.json' },
    { tool: 'Edit', path: 'docs/concepts/golden-path-doctrine.md' },
    { tool: 'Edit', path: 'docs/concepts/golden-path-runbook.md' },
    { tool: 'Edit', path: 'docs/concepts/situation-spine.json' },
    { tool: 'Edit', path: 'docs/concepts/shared-facts.json' },
    { tool: 'Edit', path: 'scripts/census/merge-published-rules.mjs' },
    { tool: 'Edit', path: 'scripts/census/check-corpus-integrity.mjs' },
    { tool: 'Edit', path: '.claude/CLAUDE.md' },
    { tool: 'Edit', path: 'CLAUDE.md' },
  ];
  const r = runHook(waveEdits);
  expect('exit code is 0 for the WHOLE wave edit set', r.code === 0, `got ${r.code}: ${r.stderr.slice(0, 400)}`);
  expect('no message at all', r.stderr === '', r.stderr.slice(0, 300));

  // And each one individually, so a future skip-pattern edit cannot pass the
  // batch while breaking one member of it.
  for (const e of waveEdits) {
    const one = runHook([e]);
    expect(`  silent for ${e.path}`, one.code === 0, `got ${one.code}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: generated / test / locale files are skipped');
{
  for (const p of [
    'src/lib/bindings/SkillEntry.ts',
    'src/i18n/locales/en.json',
    'src/i18n/section-locales/es/vault.json',
    'src/features/vault/__tests__/foo.ts',
    'src/features/vault/foo.test.tsx',
    'src/features/plugins/dev-tools/constants/scanMatchRules.gen.ts',
    'src/features/x/thing.generated.ts',
    'scripts/docs/check-doc-sync.mjs',
  ]) {
    const r = runHook([{ tool: 'Edit', path: p }]);
    expect(`silent for ${p}`, r.code === 0, `got ${r.code}: ${r.stderr.slice(0, 200)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: an ungoverned source file is silent');
{
  // A real source file that no golden path cites. Chosen from the tree so the
  // fixture cannot rot into a path nobody can edit.
  const r = runHook([{ tool: 'Edit', path: 'src/this/file/is/not/in/the/corpus/zzz.tsx' }]);
  expect('exit code is 0', r.code === 0, `got ${r.code}: ${r.stderr.slice(0, 200)}`);
  expect('no message', r.stderr === '');
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: stop_hook_active short-circuits (no loop)');
{
  const r = runHook([{ tool: 'Edit', path: MULTI[0] }], { stopHookActive: true });
  expect('exit code is 0', r.code === 0, `got ${r.code}`);
  expect('no message', r.stderr === '');
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: a missing router warns and passes — never blocks on infra absence');
{
  // Point the hook at a project dir with no artifacts at all.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-touch-empty-'));
  const r = runHook([{ tool: 'Edit', path: MULTI[0] }], { projectDir: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  expect('exit code is 0', r.code === 0, `got ${r.code}`);
  expect('warns in one line', /router unavailable/.test(r.stderr), r.stderr.slice(0, 200));
  expect('names the regen command', /build-golden-path-index\.mjs/.test(r.stderr));
  expect('says it is not blocking', /Not blocking/.test(r.stderr));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: an unparseable router warns and passes');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-touch-bad-'));
  fs.mkdirSync(path.join(tmp, 'docs/concepts/golden-paths'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'docs/concepts/golden-paths/router.json'), '{ not json');
  const r = runHook([{ tool: 'Edit', path: MULTI[0] }], { projectDir: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  expect('exit code is 0', r.code === 0, `got ${r.code}`);
  expect('warns', /router unavailable/.test(r.stderr), r.stderr.slice(0, 200));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 8: a router with no byFile map warns and passes');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-touch-shape-'));
  fs.mkdirSync(path.join(tmp, 'docs/concepts/golden-paths'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'docs/concepts/golden-paths/router.json'), '{"schema":1}');
  const r = runHook([{ tool: 'Edit', path: MULTI[0] }], { projectDir: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  expect('exit code is 0', r.code === 0, `got ${r.code}`);
  expect('warns about the shape', /no byFile map/.test(r.stderr), r.stderr.slice(0, 200));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 9: a singly-governed file fires with exactly one path');
{
  const r = runHook([{ tool: 'Edit', path: SINGLE[0] }]);
  expect('exit code is 2', r.code === 2, `got ${r.code}`);
  const bullets = r.stderr.split('\n').filter((l) => /^ {2}- /.test(l));
  expect('exactly one path shown', bullets.length === 1, `got ${bullets.length}`);
  expect('no overflow note', !/further golden path/.test(r.stderr));
  expect(`names ${SINGLE[1][0].leaf}`, r.stderr.includes(SINGLE[1][0].leaf));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 10: a governed edit mixed with skipped edits still fires');
{
  const r = runHook([
    { tool: 'Edit', path: 'docs/concepts/golden-paths/entity-picker.md' },
    { tool: 'Edit', path: MULTI[0] },
    { tool: 'Edit', path: 'src/lib/bindings/Foo.ts' },
  ]);
  expect('exit code is 2', r.code === 2, `got ${r.code}`);
  expect('the governed file is named', r.stderr.includes(MULTI[0]));
  expect('the skipped .md is NOT named', !r.stderr.includes('entity-picker.md'), r.stderr.slice(0, 400));
}

// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 11: no edits at all in the turn');
{
  const r = runHook([{ tool: 'Read', path: MULTI[0] }]);
  expect('exit code is 0 (Read is not an edit)', r.code === 0, `got ${r.code}`);
}

console.log(`\ncheck-golden-path-touch: ${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`); process.exit(1); }
process.exit(0);
