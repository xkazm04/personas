// Memory admission (lib/memory.mjs): free-GB decisions, the median sampler, and the machine-wide gate
// slot (serial gates + bounded wait for headroom). Temp state root only; free memory is faked.
// Run: node --test .claude/skills/appmaster/test/memory.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appmaster-mem-'));
process.env.APPMASTER_STATE_ROOT = tmp;
process.env.APPMASTER_GATE_POLL_MS = '5';
const C = await import('../lib/contract.mjs');
const M = await import('../lib/memory.mjs');

const setFree = (gb) => { process.env.APPMASTER_FAKE_FREE_GB = String(gb); };
const noSleep = () => {};

test('dispatch need grows with the builders already running (our own growth counts)', () => {
  assert.equal(M.dispatchNeedGb(0), C.MEM.dispatchMinFreeGb);
  assert.equal(M.dispatchNeedGb(3), C.MEM.dispatchMinFreeGb + 3 * C.MEM.perBuilderReserveGb);
  setFree(6);
  assert.equal(M.memoryState({ runningBuilders: 0 }).dispatchOk, true);
  assert.equal(M.memoryState({ runningBuilders: 2 }).dispatchOk, false, '6 GB is enough for the first builder, not for a third');
  assert.equal(M.memoryState({ runningBuilders: 2 }).stop, true);
});

test('a high used-% alone no longer trips anything: only free GB decides', () => {
  setFree(30);
  const m = M.memoryState({ runningBuilders: 1 });
  assert.equal(m.dispatchOk, true);
  assert.equal(m.gateOk, true);
});

test('sampleFreeGb takes the MEDIAN of its readings (one spike does not flip a decision)', () => {
  delete process.env.APPMASTER_FAKE_FREE_GB;
  const real = os.freemem;
  const readings = [20 * 2 ** 30, 1 * 2 ** 30, 20 * 2 ** 30, 20 * 2 ** 30, 2 * 2 ** 30];
  let i = 0;
  os.freemem = () => readings[i++ % readings.length];
  try { assert.equal(Math.round(M.sampleFreeGb({ sleep: noSleep })), 20); } finally { os.freemem = real; }
});

test('gate slot: granted immediately when memory allows; the lock is exclusive and released', () => {
  setFree(40);
  const release = M.acquireGateSlot({ label: 'one', sleep: noSleep });
  assert.equal(fs.existsSync(M.gateLockPath()), true);
  process.env.APPMASTER_GATE_WAIT_MS = '30';
  assert.throws(() => M.acquireGateSlot({ label: 'two', sleep: noSleep }), (e) => e.reason === 'gate busy' && e.extra.holder?.label === 'one');
  release();
  assert.equal(fs.existsSync(M.gateLockPath()), false);
  const again = M.acquireGateSlot({ label: 'three', sleep: noSleep });
  again();
  delete process.env.APPMASTER_GATE_WAIT_MS;
});

test('gate slot: WAITS for headroom and proceeds when it recovers; refuses (and frees the lock) only after the wait', () => {
  setFree(2);
  let polls = 0;
  const release = M.acquireGateSlot({ label: 'waiter', sleep: () => { if (++polls === 3) setFree(40); }, onWait: () => {} });
  assert.ok(polls >= 3, 'it polled while memory was short');
  release();

  setFree(2);
  process.env.APPMASTER_GATE_WAIT_MS = '30';
  assert.throws(() => M.acquireGateSlot({ label: 'starved', sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(ms, 15)) }),
    (e) => e.reason === 'memory' && e.extra.needGb === C.MEM.gateMinFreeGb && e.extra.freeGb === 2);
  assert.equal(fs.existsSync(M.gateLockPath()), false, 'a refused wait must not leave the lock behind');
  delete process.env.APPMASTER_GATE_WAIT_MS;
});

test('gate slot: a lock whose process is dead, or that is long stale, is taken over', () => {
  setFree(40);
  fs.writeFileSync(M.gateLockPath(), JSON.stringify({ pid: 2 ** 22 - 3, label: 'dead owner', at: new Date().toISOString() }));
  M.acquireGateSlot({ label: 'heir', sleep: noSleep })();
  fs.writeFileSync(M.gateLockPath(), JSON.stringify({ pid: process.pid, label: 'ancient', at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }));
  M.acquireGateSlot({ label: 'heir2', sleep: noSleep })();
  assert.equal(fs.existsSync(M.gateLockPath()), false);
});

test('cleanup', () => { delete process.env.APPMASTER_FAKE_FREE_GB; fs.rmSync(tmp, { recursive: true, force: true }); });
