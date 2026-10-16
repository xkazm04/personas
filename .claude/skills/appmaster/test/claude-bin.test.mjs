// Which `claude` a builder runs (spark one-control WP5): an explicit APPMASTER_CLAUDE_BIN always wins;
// else the Personas fleet shim when the app's local-http handshake is readable; else plain `claude` with
// ONE warning naming why. Every handshake here lives in a temp dir (PERSONAS_DATA_DIR + a temp home), so
// the operator's real ~/.personas/local-http.json is never read, and nothing is spawned.
// Run: node --test .claude/skills/appmaster/test/claude-bin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-claude-bin-')));
process.env.APPMASTER_STATE_ROOT = path.join(tmp, 'state');
process.env.APPMASTER_WORKTREE_ROOT = path.join(tmp, 'worktrees');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const C = await import('../lib/contract.mjs');
const W = await import('../lib/worker.mjs');

/** A data dir (with or without a handshake) and an empty home, both temp. */
function place(name, handshake) {
  const dataDir = path.join(tmp, name, 'data');
  const home = path.join(tmp, name, 'home');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (handshake) fs.writeFileSync(path.join(dataDir, 'local-http.json'), JSON.stringify(handshake));
  return { env: { PERSONAS_DATA_DIR: dataDir }, home };
}

test('the shim path is the one in the repo this skill lives in', () => {
  assert.equal(C.SHIM_PATH, path.join(C.REPO_ROOT, 'scripts', 'fleet', 'personas-run.mjs'));
  assert.ok(fs.existsSync(C.SHIM_PATH), 'the shim is committed beside the skill');
  assert.ok(C.isFleetShim(C.SHIM_PATH));
  assert.ok(!C.isFleetShim('claude'));
});

test('an explicit APPMASTER_CLAUDE_BIN wins, even while the app is up', () => {
  const warns = [];
  const { env, home } = place('explicit', { port: 4242, token: 'tok' });
  const got = C.resolveClaudeBin({ env: { ...env, APPMASTER_CLAUDE_BIN: 'C:/fake/claude.mjs' }, home, warn: (m) => warns.push(m) });
  assert.deepEqual(got, { bin: 'C:/fake/claude.mjs', via: 'env' });
  assert.equal(warns.length, 0);
});

test('a readable handshake makes the default the fleet shim', () => {
  const warns = [];
  const { env, home } = place('up', { port: 4242, token: 'tok', pid: 1 });
  const got = C.resolveClaudeBin({ env, home, warn: (m) => warns.push(m) });
  assert.deepEqual(got, { bin: C.SHIM_PATH, via: 'shim' });
  assert.equal(C.claudeBin({ env, home, warn: (m) => warns.push(m) }), C.SHIM_PATH);
  assert.equal(warns.length, 0);
  // A half-written handshake (no token) is not "the app is up".
  const half = place('half', { port: 4242 });
  assert.equal(C.resolveClaudeBin({ ...half, warn: () => {} }).via, 'claude');
});

test('no handshake falls back to claude with ONE warning naming why', () => {
  C.resetClaudeBinWarning();
  const warns = [];
  const { env, home } = place('down', null);
  const first = C.resolveClaudeBin({ env, home, warn: (m) => warns.push(m) });
  assert.equal(first.bin, 'claude');
  assert.equal(first.via, 'claude');
  assert.match(first.reason, /not running/);
  assert.ok(first.reason.includes(path.join(env.PERSONAS_DATA_DIR, 'local-http.json')), 'names where it looked');
  const second = C.resolveClaudeBin({ env, home, warn: (m) => warns.push(m) });
  assert.equal(second.bin, 'claude');
  assert.equal(warns.length, 1, 'one warning per process, not one per builder');
  assert.match(warns[0], /outside the fleet's queue and cap/);
  assert.match(warns[0], /local-http handshake/);
  C.resetClaudeBinWarning();
});

test('through the shim the builder env names its origin; otherwise it does not', () => {
  const viaShim = W.builderEnv(C.SHIM_PATH, 'demo');
  assert.equal(viaShim.PERSONAS_RUN_ORIGIN, 'app_master');
  assert.equal(viaShim.PERSONAS_RUN_LABEL, 'cli-master:demo', 'the label rides along (the door forwards it)');
  for (const [k, v] of Object.entries(C.ENV_SET)) assert.equal(viaShim[k], v);
  const plain = W.builderEnv('claude', 'demo');
  assert.equal(plain.PERSONAS_RUN_ORIGIN, process.env.PERSONAS_RUN_ORIGIN);
});
