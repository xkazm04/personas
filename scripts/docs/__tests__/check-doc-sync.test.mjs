#!/usr/bin/env node
// Smoke tests for scripts/docs/check-doc-sync.mjs.
//
// Each case writes a synthetic JSONL transcript fixture containing one user
// message followed by an assistant tool_use block, pipes a Stop-hook payload
// to the hook script, and asserts on exit code + stderr.
//
// Run:  node scripts/docs/__tests__/check-doc-sync.test.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK = path.join(REPO_ROOT, 'scripts/docs/check-doc-sync.mjs');

function buildTranscript(toolCalls) {
  // Synthetic JSONL: one user msg, then one assistant msg with tool_use blocks.
  const userEvt = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'go' }] },
  };
  const assistantEvt = {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: toolCalls.map((c) => ({
        type: 'tool_use',
        name: c.tool || 'Edit',
        input: { file_path: c.path },
      })),
    },
  };
  return [JSON.stringify(userEvt), JSON.stringify(assistantEvt)].join('\n') + '\n';
}

function runHook(toolCalls) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-sync-'));
  const transcript = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, buildTranscript(toolCalls));
  const payload = JSON.stringify({ transcript_path: transcript, stop_hook_active: false });
  const result = spawnSync('node', [HOOK], {
    input: payload,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
    encoding: 'utf8',
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { code: result.status, stderr: result.stderr, stdout: result.stdout };
}

let passed = 0;
let failed = 0;
const failures = [];

function expect(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}`);
    if (detail) console.log(`      ${detail}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Case 1: source edit alone (no docs, no onboarding) → feature-doc nag
//         AND marketing breadcrumb folded in.
// ────────────────────────────────────────────────────────────────────────
console.log('Case 1: vault source edit only');
{
  const r = runHook([
    { tool: 'Edit', path: 'src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx' },
  ]);
  expect('exit code is 2', r.code === 2, `got ${r.code}`);
  expect('mentions docs/features/connections', r.stderr.includes('docs/features/connections/README.md'));
  expect('mentions onboarding tour (credentials-intro)', r.stderr.includes('credentials-intro'));
  expect('mentions marketing breadcrumb', r.stderr.includes('Marketing-guide breadcrumb'));
  expect('mentions module "connections"', r.stderr.includes('module "connections"'));
}

// ────────────────────────────────────────────────────────────────────────
// Case 2: source + feature doc both touched → only onboarding nag fires
// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 2: vault source + connections doc edited together');
{
  const r = runHook([
    { tool: 'Edit', path: 'src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx' },
    { tool: 'Edit', path: 'docs/features/connections/README.md' },
  ]);
  expect('exit code is 2 (onboarding still pending)', r.code === 2, `got ${r.code}`);
  expect('NO feature-doc nag', !r.stderr.includes('Doc-sync reminder'));
  expect('onboarding nag fires', r.stderr.includes('Onboarding-tour reminder'));
  expect('marketing breadcrumb still folded in', r.stderr.includes('Marketing-guide breadcrumb'));
}

// ────────────────────────────────────────────────────────────────────────
// Case 3: source + doc + onboarding step touched → exit 0 (everything done)
// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 3: vault source + doc + onboarding step all edited');
{
  const r = runHook([
    { tool: 'Edit', path: 'src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx' },
    { tool: 'Edit', path: 'docs/features/connections/README.md' },
    { tool: 'Edit', path: 'src/features/onboarding/components/steps/CredentialsTourContent.tsx' },
  ]);
  expect('exit code is 0', r.code === 0, `got ${r.code}; stderr=${r.stderr.slice(0, 200)}`);
  expect('no stderr message', r.stderr === '');
}

// ────────────────────────────────────────────────────────────────────────
// Case 4: source with marketing target but NO onboarding coupling
//         + doc touched → exit 0 (no exit-2 nags; breadcrumb suppressed)
// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 4: schedules source + schedules doc (no onboarding coupling)');
{
  const r = runHook([
    { tool: 'Edit', path: 'src/features/schedules/components/ScheduleRow.tsx' },
    { tool: 'Edit', path: 'docs/features/schedules.md' },
  ]);
  expect('exit code is 0', r.code === 0, `got ${r.code}; stderr=${r.stderr.slice(0, 200)}`);
}

// ────────────────────────────────────────────────────────────────────────
// Case 5: skip-pattern file only (test file) → exit 0
// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 5: test file only');
{
  const r = runHook([
    { tool: 'Edit', path: 'src/features/vault/sub_catalog/components/picker/ConnectorCard.test.tsx' },
  ]);
  expect('exit code is 0 (skip pattern)', r.code === 0, `got ${r.code}`);
}

// ────────────────────────────────────────────────────────────────────────
// Case 6: triggers source → events doc + multiple tour flows in nag
// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 6: triggers source — multi-flow onboarding nag');
{
  const r = runHook([
    { tool: 'Edit', path: 'src/features/triggers/TriggersPage.tsx' },
  ]);
  expect('exit code is 2', r.code === 2, `got ${r.code}`);
  expect('mentions docs/features/events', r.stderr.includes('docs/features/events/README.md'));
  expect('mentions events-intro flow', r.stderr.includes('events-intro'));
  expect('mentions trigger-types flow', r.stderr.includes('trigger-types'));
  expect('mentions event-chaining flow', r.stderr.includes('event-chaining'));
  expect('mentions live-stream flow', r.stderr.includes('live-stream'));
}

// ────────────────────────────────────────────────────────────────────────
// Case 7: stop_hook_active payload → always exit 0 (loop guard)
// ────────────────────────────────────────────────────────────────────────
console.log('\nCase 7: stop_hook_active=true loop guard');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-sync-'));
  const transcript = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, buildTranscript([{ path: 'src/features/vault/foo.tsx' }]));
  const payload = JSON.stringify({ transcript_path: transcript, stop_hook_active: true });
  const result = spawnSync('node', [HOOK], {
    input: payload,
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
    encoding: 'utf8',
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  expect('exit code is 0', result.status === 0, `got ${result.status}`);
}

// ────────────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
