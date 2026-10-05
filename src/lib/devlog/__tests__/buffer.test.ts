import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DevlogRecord } from '@/lib/bindings/DevlogRecord';
import {
  DEVLOG_FLUSH_AT,
  DEVLOG_FLUSH_INTERVAL_MS,
  DEVLOG_RING_SIZE,
  __resetDevlogForTests,
  devlog,
  flushDevlog,
  getDevlogPending,
  installDevlogBuffer,
  passesProdFilter,
  setDevlogRouteReader,
  type DevlogInput,
} from '../buffer';

const rec = (i: number, over: Partial<DevlogInput> = {}): DevlogInput => ({
  kind: 'error',
  lvl: 'error',
  scope: 'test',
  msg: 'logged error',
  fields: { i },
  ...over,
});

let sent: DevlogRecord[][];
const send = vi.fn(async (records: DevlogRecord[]) => {
  sent.push(records);
});

beforeEach(() => {
  __resetDevlogForTests();
  sent = [];
  send.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  __resetDevlogForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('devlog buffer - before install', () => {
  it('queues without timers or IPC', () => {
    devlog(rec(1));
    expect(getDevlogPending()).toEqual({ queued: 1, dropped: 0 });
    vi.advanceTimersByTime(DEVLOG_FLUSH_INTERVAL_MS * 5);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('devlog buffer - flush triggers', () => {
  it('flushes on the 2 s timer', () => {
    installDevlogBuffer({ send });
    devlog(rec(1));
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEVLOG_FLUSH_INTERVAL_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ kind: 'error', msg: 'logged error', fields: { i: 1 } });
    expect(typeof sent[0]![0]!.cts).toBe('number');
  });

  it('flushes at 50 queued records without waiting for the timer', () => {
    installDevlogBuffer({ send });
    for (let i = 0; i < DEVLOG_FLUSH_AT - 1; i++) devlog(rec(i));
    expect(send).not.toHaveBeenCalled();
    devlog(rec(DEVLOG_FLUSH_AT - 1));
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent[0]).toHaveLength(DEVLOG_FLUSH_AT);
    // The pending timer was cleared by the flush; nothing else goes out.
    vi.advanceTimersByTime(DEVLOG_FLUSH_INTERVAL_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flushes on pagehide and on visibilitychange:hidden', () => {
    installDevlogBuffer({ send });
    devlog(rec(1));
    window.dispatchEvent(new Event('pagehide'));
    expect(send).toHaveBeenCalledTimes(1);

    devlog(rec(2));
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(send).toHaveBeenCalledTimes(2);
    vis.mockRestore();
  });

  it('sends records queued before install on the normal cadence', () => {
    devlog(rec(1));
    installDevlogBuffer({ send });
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEVLOG_FLUSH_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('teardown removes the listeners, and a re-install replaces the old one (HMR)', () => {
    installDevlogBuffer({ send });
    const second = vi.fn(async () => undefined);
    installDevlogBuffer({ send: second }); // tears the first down
    devlog(rec(1));
    window.dispatchEvent(new Event('pagehide'));
    expect(send).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('devlog buffer - ring cap', () => {
  it('drops the oldest past 500 and reports the drop count as its own record', async () => {
    for (let i = 0; i < DEVLOG_RING_SIZE + 10; i++) devlog(rec(i));
    expect(getDevlogPending()).toEqual({ queued: DEVLOG_RING_SIZE, dropped: 10 });

    installDevlogBuffer({ send }); // >= 50 pending: flushes at once
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    const batch = sent[0]!;
    expect(batch).toHaveLength(DEVLOG_RING_SIZE + 1);
    expect(batch[0]).toMatchObject({
      kind: 'swallow_rollup',
      lvl: 'warn',
      scope: 'devlog',
      msg: 'devlog records dropped',
      fields: { tag: 'devlog:ring_overflow', count: 10 },
    });
    expect(batch[1]!.fields).toEqual({ i: 10 }); // 0..9 were the oldest
    expect(getDevlogPending()).toEqual({ queued: 0, dropped: 0 });
  });
});

describe('devlog buffer - record shape', () => {
  it('stamps route lazily and omits undefined fields', () => {
    let section = 'home';
    setDevlogRouteReader(() => section);
    installDevlogBuffer({ send });
    devlog(rec(1, { fields: { a: 1, b: undefined } }));
    section = 'overview';
    devlog(rec(2));
    void flushDevlog();
    expect(sent[0]![0]).toMatchObject({ route: 'home', fields: { a: 1 } });
    expect('b' in sent[0]![0]!.fields).toBe(false);
    expect(sent[0]![1]!.route).toBe('overview');
  });

  it('a throwing route reader costs the route, not the record', () => {
    setDevlogRouteReader(() => {
      throw new Error('store gone');
    });
    installDevlogBuffer({ send });
    devlog(rec(1));
    void flushDevlog();
    expect(sent[0]![0]!.route).toBeUndefined();
  });
});

describe('devlog buffer - failed flush', () => {
  it('drops the batch silently and warns at most once per minute in DEV', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('backend down');
    });
    installDevlogBuffer({ send: failing });
    devlog(rec(1));
    await flushDevlog();
    devlog(rec(2));
    await flushDevlog();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getDevlogPending().queued).toBe(0);

    vi.advanceTimersByTime(60_000);
    devlog(rec(3));
    await flushDevlog();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('devlog buffer - PROD filter', () => {
  it('passesProdFilter keeps only error, freeze and ipc_slow >= 1000 ms', () => {
    expect(passesProdFilter(rec(0))).toBe(true);
    expect(passesProdFilter(rec(0, { kind: 'freeze', lvl: 'warn' }))).toBe(true);
    expect(passesProdFilter(rec(0, { kind: 'ipc_slow', lvl: 'warn', fields: { duration_ms: 999 } }))).toBe(false);
    expect(passesProdFilter(rec(0, { kind: 'ipc_slow', lvl: 'warn', fields: { duration_ms: 1000 } }))).toBe(true);
    for (const kind of ['ipc_window', 'long_task', 'commit', 'store_alert', 'swallow_rollup'] as const) {
      expect(passesProdFilter(rec(0, { kind, lvl: 'info' }))).toBe(false);
    }
  });

  it('in a PROD build devlog() refuses what the filter refuses; DEV keeps all', () => {
    devlog(rec(0, { kind: 'long_task', lvl: 'info' }));
    expect(getDevlogPending().queued).toBe(1);

    __resetDevlogForTests();
    vi.stubEnv('PROD', true);
    devlog(rec(0, { kind: 'long_task', lvl: 'info' }));
    devlog(rec(0, { kind: 'ipc_slow', lvl: 'warn', fields: { duration_ms: 400 } }));
    expect(getDevlogPending().queued).toBe(0);
    devlog(rec(0, { kind: 'ipc_slow', lvl: 'warn', fields: { duration_ms: 1500 } }));
    devlog(rec(0, { kind: 'freeze', lvl: 'warn' }));
    devlog(rec(0));
    expect(getDevlogPending().queued).toBe(3);
  });
});
