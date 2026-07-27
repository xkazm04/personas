import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createDevToolsTaskSlice } from './devToolsTaskSlice';
import type { SystemStore } from '../../storeTypes';
import type { DevTask } from '@/lib/bindings/DevTask';

// Minimal Zustand-style harness (mirrors uiSlice.test.ts / tourSlice.test.ts).
// appendTaskOutput / clearTaskOutput only touch `set` state — no devApi calls —
// so the slice runs standalone without the full store or a Tauri bridge.
function makeHarness(seed: Partial<SystemStore> = {}) {
  let state = {} as SystemStore;
  const set = (
    partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>),
  ) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: SystemStore) => Partial<SystemStore>)(state)
      : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createDevToolsTaskSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice, ...seed };
  return {
    get: () => state,
    buffer: (taskId: string) => state.taskOutputBuffers[taskId] ?? [],
    task: (id: string) => state.tasks.find((t) => t.id === id),
  };
}

function makeTask(overrides: Partial<DevTask> & { id: string }): DevTask {
  return {
    project_id: null,
    title: `task ${overrides.id}`,
    description: null,
    source_idea_id: null,
    goal_id: null,
    status: 'queued',
    session_id: null,
    progress_pct: 0,
    output_lines: 0,
    error: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-07-27T00:00:00Z',
    depth: 'quick',
    parent_task_id: null,
    attempt: 1,
    ...overrides,
  };
}

const CAP = 1000; // mirrors MAX_TASK_OUTPUT_LINES in devToolsTaskSlice.ts

describe('devToolsTaskSlice — bounded output ring', () => {
  // appendTaskOutput batches streamed lines and flushes to the store on a
  // short timer (one set() per window instead of one per line), so tests
  // advance fake timers to observe the flushed state.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const flush = () => vi.runAllTimers();

  it('appends lines in order while under the cap', () => {
    const h = makeHarness();
    h.get().appendTaskOutput('t1', 'a');
    h.get().appendTaskOutput('t1', 'b');
    h.get().appendTaskOutput('t1', 'c');
    flush();
    expect(h.buffer('t1')).toEqual(['a', 'b', 'c']);
  });

  it('caps the buffer at MAX lines, dropping the oldest (ring semantics)', () => {
    const h = makeHarness();
    const total = CAP + 500; // 1500 streamed lines
    for (let i = 0; i < total; i++) {
      h.get().appendTaskOutput('verbose', `line-${i}`);
    }
    flush();
    const buf = h.buffer('verbose');
    expect(buf.length).toBe(CAP);
    // The most recent CAP lines are retained; the oldest 500 are dropped.
    expect(buf[0]).toBe(`line-${total - CAP}`); // line-500
    expect(buf[buf.length - 1]).toBe(`line-${total - 1}`); // line-1499
  });

  it('never exceeds the cap exactly at the boundary', () => {
    const h = makeHarness();
    for (let i = 0; i < CAP; i++) h.get().appendTaskOutput('edge', `l${i}`);
    flush();
    expect(h.buffer('edge').length).toBe(CAP);
    h.get().appendTaskOutput('edge', 'overflow');
    flush();
    const buf = h.buffer('edge');
    expect(buf.length).toBe(CAP); // still capped
    expect(buf[buf.length - 1]).toBe('overflow');
    expect(buf[0]).toBe('l1'); // l0 evicted
  });

  it('keeps separate task buffers isolated', () => {
    const h = makeHarness();
    h.get().appendTaskOutput('t1', 'one');
    h.get().appendTaskOutput('t2', 'two');
    flush();
    expect(h.buffer('t1')).toEqual(['one']);
    expect(h.buffer('t2')).toEqual(['two']);
  });

  it('clearTaskOutput frees the buffer entirely (terminal-state cleanup)', () => {
    const h = makeHarness();
    h.get().appendTaskOutput('done', 'x');
    h.get().appendTaskOutput('done', 'y');
    flush();
    expect(h.buffer('done')).toEqual(['x', 'y']);
    h.get().clearTaskOutput('done');
    // Read the raw map (not the buffer() helper, which coalesces undefined -> []):
    // clearTaskOutput must delete the key outright, not leave an empty array.
    expect(h.get().taskOutputBuffers['done']).toBeUndefined();
    expect('done' in h.get().taskOutputBuffers).toBe(false);
  });
});

describe('devToolsTaskSlice — setTasks / patchTask (Run Desk event path)', () => {
  it('setTasks replaces the window wholesale', () => {
    const h = makeHarness();
    h.get().setTasks([makeTask({ id: 'a' }), makeTask({ id: 'b' })]);
    expect(h.get().tasks.map((t) => t.id)).toEqual(['a', 'b']);
    h.get().setTasks([makeTask({ id: 'c' })]);
    expect(h.get().tasks.map((t) => t.id)).toEqual(['c']);
  });

  it('patchTask merges a partial into the matching row only', () => {
    const h = makeHarness();
    h.get().setTasks([
      makeTask({ id: 'a', status: 'running', progress_pct: 20 }),
      makeTask({ id: 'b', status: 'queued' }),
    ]);
    h.get().patchTask('a', { status: 'completed', progress_pct: 100 });
    expect(h.task('a')).toMatchObject({ status: 'completed', progress_pct: 100 });
    // Untouched fields survive the merge...
    expect(h.task('a')?.title).toBe('task a');
    // ...and the sibling row is untouched.
    expect(h.task('b')).toMatchObject({ status: 'queued', progress_pct: 0 });
  });

  it('patchTask keeps the identity of rows it did not touch (memo bail-out)', () => {
    const h = makeHarness();
    const rows = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    h.get().setTasks(rows);
    const beforeB = h.task('b');
    h.get().patchTask('a', { status: 'running' });
    expect(h.task('b')).toBe(beforeB);
    expect(h.task('a')).not.toBe(rows[0]);
  });

  it('patchTask is a no-op for an id outside the loaded window', () => {
    const h = makeHarness();
    h.get().setTasks([makeTask({ id: 'a' })]);
    const before = h.get().tasks;
    h.get().patchTask('not-loaded', { status: 'failed' });
    // Same array identity — an off-window event must not re-render the queue.
    expect(h.get().tasks).toBe(before);
  });

  it('patchTask carries the error string from a failed status event', () => {
    const h = makeHarness();
    h.get().setTasks([makeTask({ id: 'a', status: 'running' })]);
    h.get().patchTask('a', { status: 'failed', error: 'boom', completed_at: '2026-07-27T01:00:00Z' });
    expect(h.task('a')).toMatchObject({ status: 'failed', error: 'boom' });
  });
});
