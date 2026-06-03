import { describe, it, expect } from 'vitest';

import { createDevToolsTaskSlice } from './devToolsTaskSlice';
import type { SystemStore } from '../../storeTypes';

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
    buffer: (taskId: string) => state.taskOutputBuffers[taskId],
  };
}

const CAP = 1000; // mirrors MAX_TASK_OUTPUT_LINES in devToolsTaskSlice.ts

describe('devToolsTaskSlice — bounded output ring', () => {
  it('appends lines in order while under the cap', () => {
    const h = makeHarness();
    h.get().appendTaskOutput('t1', 'a');
    h.get().appendTaskOutput('t1', 'b');
    h.get().appendTaskOutput('t1', 'c');
    expect(h.buffer('t1')).toEqual(['a', 'b', 'c']);
  });

  it('caps the buffer at MAX lines, dropping the oldest (ring semantics)', () => {
    const h = makeHarness();
    const total = CAP + 500; // 1500 streamed lines
    for (let i = 0; i < total; i++) {
      h.get().appendTaskOutput('verbose', `line-${i}`);
    }
    const buf = h.buffer('verbose');
    expect(buf.length).toBe(CAP);
    // The most recent CAP lines are retained; the oldest 500 are dropped.
    expect(buf[0]).toBe(`line-${total - CAP}`); // line-500
    expect(buf[buf.length - 1]).toBe(`line-${total - 1}`); // line-1499
  });

  it('never exceeds the cap exactly at the boundary', () => {
    const h = makeHarness();
    for (let i = 0; i < CAP; i++) h.get().appendTaskOutput('edge', `l${i}`);
    expect(h.buffer('edge').length).toBe(CAP);
    h.get().appendTaskOutput('edge', 'overflow');
    const buf = h.buffer('edge');
    expect(buf.length).toBe(CAP); // still capped
    expect(buf[buf.length - 1]).toBe('overflow');
    expect(buf[0]).toBe('l1'); // l0 evicted
  });

  it('keeps separate task buffers isolated', () => {
    const h = makeHarness();
    h.get().appendTaskOutput('t1', 'one');
    h.get().appendTaskOutput('t2', 'two');
    expect(h.buffer('t1')).toEqual(['one']);
    expect(h.buffer('t2')).toEqual(['two']);
  });

  it('clearTaskOutput frees the buffer entirely (terminal-state cleanup)', () => {
    const h = makeHarness();
    h.get().appendTaskOutput('done', 'x');
    h.get().appendTaskOutput('done', 'y');
    expect(h.buffer('done')).toEqual(['x', 'y']);
    h.get().clearTaskOutput('done');
    expect(h.buffer('done')).toBeUndefined();
    expect('done' in h.get().taskOutputBuffers).toBe(false);
  });
});
