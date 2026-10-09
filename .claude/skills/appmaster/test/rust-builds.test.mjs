// Rust build load on the shared machine (operator, 2026-10-07): a job cap and a narrow-compile rule
// for builders in a Rust repo, and reviews that cite the merge gate's record instead of recompiling.
// Every path is a temp dir: APPMASTER_STATE_ROOT is set before import.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-rust-builds-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');

const C = await import('../lib/contract.mjs');
const W = await import('../lib/worker.mjs');

const rustRepo = path.join(tmp, 'rust-repo');
const plainRepo = path.join(tmp, 'plain-repo');
fs.mkdirSync(rustRepo, { recursive: true });
fs.mkdirSync(plainRepo, { recursive: true });
fs.writeFileSync(path.join(rustRepo, 'Cargo.toml'), '[workspace]\nmembers = []\n');

const run = (root) => ({
  runId: '11111111-2222-3333-4444-555555555555', slug: 'demo', state: 'planned',
  project: { slug: 'demo', name: 'demo', root, baseBranch: 'main' },
  charterSlug: 'accepted-idea-delivery', reason: 'a reason', brief: 'Do the thing.', ideaIds: [],
  worktree: 'C:/wt/x', branch: 'autopilot/x-1', paths: ['src/'],
});

test('repoEnv caps cargo jobs in a Rust repo, and only there; only Personas shares a cargo target', () => {
  assert.equal(C.repoEnv(rustRepo).CARGO_BUILD_JOBS, String(C.RUST_BUILD_JOBS));
  assert.equal(C.repoEnv(rustRepo).CARGO_TARGET_DIR, undefined, 'another Rust repo keeps a target per worktree');
  assert.deepEqual(C.repoEnv(plainRepo), {});
  assert.deepEqual(C.repoEnv(null), {});
  assert.ok(C.RUST_BUILD_JOBS >= 1 && C.RUST_BUILD_JOBS <= 16);
});

test('renderBuilderPrompt: a Rust repo gets the narrow-compile rule and the job cap; a plain repo gets neither', () => {
  const rust = W.renderBuilderPrompt(run(rustRepo), {}, {});
  assert.match(rust, /cargo check -p <crate>/);
  assert.match(rust, /once, at the end, before your final commit/);
  assert.match(rust, new RegExp(`CARGO_BUILD_JOBS is ${C.RUST_BUILD_JOBS}; do not raise it`));
  const plain = W.renderBuilderPrompt(run(plainRepo), {}, {});
  assert.doesNotMatch(plain, /cargo check -p/);
  assert.doesNotMatch(plain, /CARGO_BUILD_JOBS/);
});

const ok = (command) => ({ command, ok: true, exit: 0, ms: 10 });
const runs = [
  { runId: 'aaaaaaaa-0000-0000-0000-000000000001', state: 'merged', mergedSha: 'a'.repeat(40), settledAt: '2026-10-07T01:00:00Z', repoRoot: rustRepo,
    verdict: { gates: { typecheck: { skipped: true }, test: ok('cargo test --workspace') } } },
  { runId: 'aaaaaaaa-0000-0000-0000-000000000002', state: 'merged', mergedSha: 'b'.repeat(40), settledAt: '2026-10-07T02:00:00Z', repoRoot: rustRepo,
    verdict: { gates: { test: { command: 'cargo test', ok: false, exit: 101 } } } },
  { runId: 'aaaaaaaa-0000-0000-0000-000000000003', state: 'merged', mergedSha: 'c'.repeat(40), settledAt: '2026-10-07T03:00:00Z', repoRoot: plainRepo,
    verdict: { gates: { test: ok('npm test') } } },
  { runId: 'aaaaaaaa-0000-0000-0000-000000000004', state: 'merged', mergedSha: 'd'.repeat(40), settledAt: '2026-10-07T04:00:00Z', repoRoot: rustRepo,
    verdict: { gates: { test: { command: 'cargo test', ok: false, exit: 101 } }, gatesAfterRebase: { test: ok('cargo test') } } },
  { runId: 'aaaaaaaa-0000-0000-0000-000000000005', state: 'held', mergedSha: 'e'.repeat(40), repoRoot: rustRepo,
    verdict: { gates: { test: ok('cargo test') } } },
];

test('gateRecordFor: the merged run that verified exactly this tree in this repo, never a failed or foreign one', () => {
  const rec = W.gateRecordFor(runs, rustRepo, 'a'.repeat(40));
  assert.equal(rec.runId, runs[0].runId);
  assert.deepEqual(rec.gates, { typecheck: 'skipped', test: 'ok' });
  assert.equal(W.gateRecordFor(runs, rustRepo, 'b'.repeat(40)), null, 'a failed gate is no record');
  assert.equal(W.gateRecordFor(runs, rustRepo, 'c'.repeat(40)), null, 'another repo is no record');
  assert.equal(W.gateRecordFor(runs, rustRepo, 'e'.repeat(40)), null, 'a held run never merged that tree');
  assert.equal(W.gateRecordFor(runs, rustRepo, 'f'.repeat(40)), null, 'an unknown sha');
  assert.equal(W.gateRecordFor(runs, rustRepo, null), null);
  assert.deepEqual(W.gateRecordFor(runs, rustRepo, 'd'.repeat(40)).gates, { test: 'ok' }, 'the gates that re-ran after a rebase stand');
});

test('gateRecordRule: tells the reviewer not to recompile, names the commands, and keeps the escape hatches', () => {
  const rule = W.gateRecordRule(W.gateRecordFor(runs, rustRepo, 'a'.repeat(40)));
  assert.match(rule, /Do NOT re-run/);
  assert.match(rule, /`cargo test --workspace`/);
  assert.match(rule, /typecheck skipped there/);
  assert.match(rule, /git rev-parse HEAD/);
  assert.match(rule, /aaaaaaaaaa/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
