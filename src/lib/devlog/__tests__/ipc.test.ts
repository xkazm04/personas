import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Test-only: the global mock in src/test/setup.ts stands in for the Tauri
// bridge; the test drives it to measure what invokeWithTimeout records.
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import type { DevlogRecord } from '@/lib/bindings/DevlogRecord';
import { invokeWithTimeout, _clearAutoDedupForTests } from '@/lib/tauriInvoke';
import { getIpcRecords } from '@/lib/ipcMetrics';
import { __resetDevlogForTests, flushDevlog, getDevlogPending } from '../buffer';
import { DEV_IPC_SLOW_MS, accumulateIpcWindow, drainIpcWindow, ipcSlowRecord } from '../ipc';
import { installDevlog } from '../index';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const settle = (durationMs: number, over: Partial<Parameters<typeof ipcSlowRecord>[0]> = {}) => ({
  command: 'list_personas',
  durationMs,
  ok: true,
  timedOut: false,
  ...over,
});

beforeEach(() => {
  __resetDevlogForTests();
  drainIpcWindow();
  _clearAutoDedupForTests();
});

afterEach(() => {
  __resetDevlogForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ipc_slow threshold', () => {
  it('DEV: 300 ms and over', () => {
    expect(ipcSlowRecord(settle(DEV_IPC_SLOW_MS - 1))).toBeNull();
    expect(ipcSlowRecord(settle(DEV_IPC_SLOW_MS + 0.4))).toEqual({
      kind: 'ipc_slow',
      lvl: 'warn',
      scope: 'ipc',
      msg: 'slow ipc call',
      fields: { command: 'list_personas', duration_ms: 300, ok: true, timed_out: false, error_kind: undefined },
    });
  });

  it('PROD: 1000 ms and over', () => {
    vi.stubEnv('PROD', true);
    expect(ipcSlowRecord(settle(999))).toBeNull();
    expect(ipcSlowRecord(settle(1000))?.fields.duration_ms).toBe(1000);
  });

  it('carries the AppError kind of a rejection, and the timeout flag', () => {
    const r = ipcSlowRecord(settle(400, { ok: false, error: { error: 'x', kind: 'not_found' } }));
    expect(r?.fields).toMatchObject({ ok: false, error_kind: 'not_found' });
    const t = ipcSlowRecord(settle(400, { ok: false, timedOut: true, error: new Error('timeout') }));
    expect(t?.fields).toMatchObject({ timed_out: true, error_kind: undefined });
  });
});

describe('ipc_window aggregation', () => {
  it('folds a window per command into count / p50 / p95 / max / errors / timeouts', () => {
    for (let i = 1; i <= 20; i++) accumulateIpcWindow(settle(i * 10));
    accumulateIpcWindow(settle(5, { command: 'get_x', ok: false }));
    accumulateIpcWindow(settle(7, { command: 'get_x', ok: false, timedOut: true }));

    const out = drainIpcWindow();
    const a = out.find((r) => r.fields.command === 'list_personas')!;
    // Nearest rank over 10..200: p50 = 10th sample (100), p95 = 19th (190).
    expect(a).toMatchObject({ kind: 'ipc_window', lvl: 'debug', msg: 'ipc window' });
    expect(a.fields).toEqual({
      command: 'list_personas', count: 20, p50_ms: 100, p95_ms: 190, max_ms: 200, errors: 0, timeouts: 0,
    });
    const b = out.find((r) => r.fields.command === 'get_x')!;
    expect(b.fields).toMatchObject({ count: 2, p50_ms: 5, p95_ms: 7, max_ms: 7, errors: 2, timeouts: 1 });

    expect(drainIpcWindow()).toEqual([]); // the window resets
  });
});

describe('invokeWithTimeout -> devlog (no recursion)', () => {
  it('one slow call gives exactly one ipc_slow, and the flush never records itself', async () => {
    const coreInvoke = vi.mocked(invoke);
    coreInvoke.mockClear();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    installDevlog();
    const before = getIpcRecords().length;

    clock = 1_000;
    const call = invokeWithTimeout('list_personas');
    clock = 1_000 + 450;
    await call;

    // The flush: make devlog_ingest itself "slow" too - it must stay invisible.
    clock = 5_000;
    const flushing = flushDevlog();
    clock = 9_000;
    await flushing;

    const ingest = coreInvoke.mock.calls.filter(([cmd]) => cmd === 'devlog_ingest');
    expect(ingest).toHaveLength(1);
    const records = (ingest[0]![1] as { records: DevlogRecord[] }).records;
    const slow = records.filter((r) => r.kind === 'ipc_slow');
    expect(slow).toHaveLength(1);
    expect(slow[0]!.fields).toMatchObject({ command: 'list_personas', duration_ms: 450, ok: true });
    const windows = records.filter((r) => r.kind === 'ipc_window');
    expect(windows.map((r) => r.fields.command)).toEqual(['list_personas']);

    // The ingest call is not in the IPC metrics ring and queued nothing new.
    const added = getIpcRecords().slice(before).map((r) => r.command);
    expect(added).toEqual(['list_personas']);
    expect(getDevlogPending().queued).toBe(0);
    await flushDevlog();
    expect(coreInvoke.mock.calls.filter(([cmd]) => cmd === 'devlog_ingest')).toHaveLength(1);
  });

  it('a fast call yields no ipc_slow record', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const call = invokeWithTimeout('list_personas');
    clock = 20;
    await call;
    expect(getDevlogPending().queued).toBe(0);
  });
});
