import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Fragment, Profiler, type ReactElement } from 'react';
import type { DevlogRecord } from '@/lib/bindings/DevlogRecord';
import { __resetDevlogForTests, flushDevlog, installDevlogBuffer } from '../buffer';
import {
  LONG_TASK_MIN_MS,
  SLOW_COMMIT_MIN_MS,
  commitRecord,
  longTaskRecord,
  onDevlogCommit,
  perfLevel,
  startLongTaskObserver,
} from '../perf';
import { ERROR_MSG_MAX_CHARS, STACK_MAX_CHARS, contextFields, errorMessage, errorRecord } from '../errors';
// The sink's own normalizer (WP3), the same rules the Rust side fingerprints with.
import { normalizeMessage } from '../../../../scripts/devlog/fingerprint.mjs';
import { SectionProfiler } from '../SectionProfiler';
import { installDevlog } from '../index';
import { createLogger, log } from '@/lib/log';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  __resetSwallowTrackerForTests,
  flushSwallowRollupNow,
  recordSwallow,
} from '@/lib/silentFailureTelemetry';

let sent: DevlogRecord[];
async function drain(): Promise<DevlogRecord[]> {
  sent = [];
  installDevlogBuffer({ send: async (r) => { sent.push(...r); } });
  await flushDevlog();
  return sent;
}

beforeEach(() => {
  __resetDevlogForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  __resetDevlogForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('perf thresholds (pure)', () => {
  it('perfLevel: null under the floor, info under 200 ms, warn at 200 ms', () => {
    expect(perfLevel(49.9, 50)).toBeNull();
    expect(perfLevel(50, 50)).toBe('info');
    expect(perfLevel(199, 50)).toBe('info');
    expect(perfLevel(200, 50)).toBe('warn');
    expect(perfLevel(Number.NaN, 50)).toBeNull();
  });

  it('longTaskRecord', () => {
    expect(longTaskRecord(LONG_TASK_MIN_MS - 1, 0)).toBeNull();
    expect(longTaskRecord(75.6, 1234.4)).toEqual({
      kind: 'long_task', lvl: 'info', scope: 'perf', msg: 'long task',
      fields: { duration_ms: 76, start_ms: 1234 },
    });
    expect(longTaskRecord(250, 0)?.lvl).toBe('warn');
  });

  it('commitRecord', () => {
    expect(commitRecord('home', 'update', SLOW_COMMIT_MIN_MS - 1, 10)).toBeNull();
    expect(commitRecord('overview', 'mount', 210.2, 180.7)).toEqual({
      kind: 'commit', lvl: 'warn', scope: 'react', msg: 'slow react commit',
      fields: { profiler_id: 'overview', phase: 'mount', duration_ms: 210, base_ms: 181 },
    });
  });

  it('onDevlogCommit queues only slow commits', async () => {
    onDevlogCommit('home', 'update', 10, 10, 0, 0);
    onDevlogCommit('home', 'update', 80, 60, 0, 0);
    const out = await drain();
    expect(out).toHaveLength(1);
    expect(out[0]!.fields).toMatchObject({ profiler_id: 'home', duration_ms: 80 });
  });

  it('the long-task observer is a no-op where longtask is unsupported (jsdom)', () => {
    expect(startLongTaskObserver()).toBeNull();
  });

  it('installDevlog constructs the long-task observer in DEV only', () => {
    const constructed: string[] = [];
    class FakeObserver {
      static supportedEntryTypes = ['longtask'];
      constructor() { constructed.push('observer'); }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    try {
      vi.stubEnv('DEV', false);
      installDevlog()();
      expect(constructed).toEqual([]);
      vi.stubEnv('DEV', true);
      installDevlog()();
      expect(constructed).toEqual(['observer']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('SectionProfiler', () => {
  it('DEV: wraps children in a Profiler wired to devlog', () => {
    const el = SectionProfiler({ id: 'overview', children: 'x' }) as ReactElement<{ id: string; onRender: unknown }>;
    expect(el.type).toBe(Profiler);
    expect(el.props.id).toBe('overview');
    expect(el.props.onRender).toBe(onDevlogCommit);
  });

  it('PROD: renders the children bare - no Profiler is constructed', () => {
    vi.stubEnv('DEV', false);
    const el = SectionProfiler({ id: 'overview', children: 'x' }) as ReactElement;
    expect(el.type).toBe(Fragment);
  });
});

describe('error producers', () => {
  it('error msg is <source> [<scope>]: <first line>, capped at 200 chars', () => {
    expect(errorMessage('rejection', 'global-error', 'TypeError: x is undefined\n    at foo (a.ts:1)'))
      .toBe('unhandled rejection [global-error]: TypeError: x is undefined');
    expect(errorMessage('logged', 'agents/editor', '')).toBe('logged error [agents/editor]');
    expect(errorMessage('toast', 's', 'y'.repeat(500))).toHaveLength(ERROR_MSG_MAX_CHARS);
  });

  it('two different errors produce different messages', () => {
    const a = errorRecord({ source: 'logged', scope: 'agents/editor', error: 'Failed to load persona' }).msg;
    const b = errorRecord({ source: 'logged', scope: 'agents/editor', error: 'Failed to save persona' }).msg;
    expect(a).not.toBe(b);
    expect(a.startsWith('logged error [agents/editor]: ')).toBe(true);
  });

  it('a uuid-only difference normalizes to the same string (one fingerprint)', () => {
    const a = errorRecord({ source: 'logged', scope: 'agents/editor', error: 'Failed to load persona 3f2b1c4d-0000-4a1b-8c2d-0123456789ab' }).msg;
    const b = errorRecord({ source: 'logged', scope: 'agents/editor', error: 'Failed to load persona 9e8d7c6b-1111-4f2e-9a3b-abcdefabcdef' }).msg;
    expect(a).not.toBe(b);
    expect(normalizeMessage(a)).toBe(normalizeMessage(b));
    expect(normalizeMessage(a)).toBe('logged error [agents/editor]: Failed to load persona <uuid>');
  });

  it('errorRecord shape, stack capped at 2000 chars, context as snake_case primitives', () => {
    const r = errorRecord({
      source: 'uncaught',
      scope: 'global-error',
      error: 'boom',
      stack: 'x'.repeat(STACK_MAX_CHARS + 50),
      extra: { sourceFile: 'a.ts', lineNo: 3, nested: { no: 1 } },
    });
    expect(r).toMatchObject({ kind: 'error', lvl: 'error', scope: 'global-error', msg: 'uncaught error [global-error]: boom' });
    expect((r.fields.stack as string).length).toBe(STACK_MAX_CHARS);
    expect(r.fields).toMatchObject({ error: 'boom', source_file: 'a.ts', line_no: 3 });
    expect('nested' in r.fields).toBe(false);
    expect(contextFields({ personaId: 'p', ok: true })).toEqual({ persona_id: 'p', ok: true });
  });

  it('log.error forwards as "logged error [scope]"; warn and forward:false loggers do not', async () => {
    log.warn('scopeA', 'just a warning');
    createLogger('quiet', { forward: false }).error('console only');
    createLogger('engine').error('Run failed', { error: 'disk full', category: 'io', runId: 'r1' });
    const out = await drain();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'error', lvl: 'error', scope: 'engine', msg: 'logged error [engine]: Run failed',
      fields: { error: 'Run failed', detail: 'disk full', category: 'io', run_id: 'r1', scope: 'engine' },
    });
  });

  it('toastCatch forwards as "toast error [context]"; silentCatch per-site does not', async () => {
    silentCatch('feature:quiet')(new Error('swallowed'));
    toastCatch('Deploy:fetch')(new Error('network down'));
    const out = await drain();
    const errors = out.filter((r) => r.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      scope: 'toastCatch', msg: 'toast error [Deploy:fetch]: network down',
      fields: { scope: 'Deploy:fetch', error: 'network down' },
    });
    expect(typeof errors[0]!.fields.category).toBe('string');
    expect(typeof errors[0]!.fields.stack).toBe('string');
  });
});

describe('rollup and debug producers', () => {
  it('the swallow rollup emits one swallow_rollup record per tag', async () => {
    __resetSwallowTrackerForTests();
    recordSwallow('auth:refresh', 'm1');
    recordSwallow('auth:refresh', 'm2');
    recordSwallow('gallery:load', 'm3');
    flushSwallowRollupNow();
    const out = (await drain()).filter((r) => r.kind === 'swallow_rollup');
    expect(out.map((r) => [r.msg, r.fields.tag, r.fields.count])).toEqual([
      ['swallowed errors', 'auth:refresh', 2],
      ['swallowed errors', 'gallery:load', 1],
    ]);
  });

  it('storeMonitor alerts become store_alert records with constant msgs', async () => {
    vi.useFakeTimers();
    try {
      const { trackStoreUpdate, stopMonitor, startMonitor } = await import('@/lib/debug/storeMonitor');
      stopMonitor();
      startMonitor();
      for (let i = 0; i < 25; i++) trackStoreUpdate('agentStore');
      vi.advanceTimersByTime(2000);
      stopMonitor();
    } finally {
      vi.useRealTimers();
    }
    const out = (await drain()).filter((r) => r.kind === 'store_alert');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      lvl: 'warn', scope: 'storeMonitor', msg: 'store update loop',
      fields: { store: 'agentStore', updates: 25, window_ms: 2000 },
    });
  });
});
