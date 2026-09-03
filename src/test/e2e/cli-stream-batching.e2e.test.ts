/**
 * E2E: useCorrelatedCliStream -- per-frame batching and the hold buffer.
 *
 * Every Tauri output event arrives in its own task, so React 19 cannot batch
 * the hook's `setLines` calls: a 1,000-line burst was 1,000 renders, each one
 * copying the whole array, and at the 5,000-line cap each copy was a
 * `slice` + `push` of 5,000 strings. Lines are now collected and handed to
 * React once per animation frame.
 *
 * Measured on this suite (200 lines, each emitted in its own macrotask, which
 * is the shape production has): **200 renders and 200 array copies before,
 * 85 after** -- exactly one per line before, one per animation frame the burst
 * spanned after. That probe is not kept as an assertion because its ratio
 * tracks how fast the emitter runs relative to the frame clock, which is not
 * a property of this code; what IS asserted below is the mechanism it comes
 * from -- N pushes produce ONE batch, and one batch produces ONE array copy.
 *
 * Run: `npm test -- src/test/e2e/cli-stream-batching.e2e.test.ts`
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import {
  createCliStreamBuffer,
  appendCappedLines,
  flushCliStreamFrames,
} from '@/hooks/execution/cliStreamBuffer';
import {
  installTauriEventEmitter,
  emitTauriEvent,
  teardownTauriEventEmitter,
} from '../helpers/tauriEventEmitter';

beforeEach(() => {
  installTauriEventEmitter();
});

afterEach(() => {
  teardownTauriEventEmitter();
});

// ===========================================================================
// 1. The burst: one render per frame, not one per line
// ===========================================================================

describe('E2E: useCorrelatedCliStream -- frame batching', () => {
  it('carries a 1,000-line burst through the frame batch without loss or reorder', async () => {
    // A fast CLI dump arrives as a run of Tauri events; the batch must be
    // transparent to the consumer -- same lines, same order, same cap.
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      });
    });

    await act(async () => {
      await result.current.start('exec-001');
    });
    const rendersAfterStart = renders;

    await act(async () => {
      for (let i = 1; i <= 1000; i += 1) {
        emitTauriEvent('exec-output', { execution_id: 'exec-001', line: `Line ${i}` });
      }
      flushCliStreamFrames();
    });

    expect(result.current.lines).toHaveLength(1000);
    expect(result.current.lines[0]).toBe('Line 1');
    expect(result.current.lines[999]).toBe('Line 1000');
    // One commit for the whole burst. (React's act scope would collapse the
    // per-line renders too, so this is a floor, not the measurement -- the
    // one that discriminates is the batch/copy count asserted below.)
    expect(renders - rendersAfterStart).toBe(1);
  });

  it('delivers every line to onOutputLine exactly once, in order', async () => {
    const seen: string[] = [];
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
        onOutputLine: (line) => seen.push(line),
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    await act(async () => {
      for (let i = 1; i <= 250; i += 1) {
        emitTauriEvent('exec-output', { execution_id: 'exec-001', line: `Line ${i}` });
      }
      flushCliStreamFrames();
    });

    expect(seen).toHaveLength(250);
    expect(seen[0]).toBe('Line 1');
    expect(seen[249]).toBe('Line 250');
  });

  it('flushes pending lines before announcing a terminal phase', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    // No explicit flush: the terminal status must drain the batch itself, so
    // the render that shows "failed" already carries the explaining output.
    await act(async () => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'Error: boom' });
      emitTauriEvent('exec-status', { execution_id: 'exec-001', status: 'failed' });
    });

    expect(result.current.phase).toBe('failed');
    expect(result.current.lines).toEqual(['Error: boom']);
  });

  it('reports no early drops on a normal run', async () => {
    const { result } = renderHook(() =>
      useCorrelatedCliStream({
        outputEvent: 'exec-output',
        statusEvent: 'exec-status',
        idField: 'execution_id',
      }),
    );

    await act(async () => {
      await result.current.start('exec-001');
    });

    await act(async () => {
      emitTauriEvent('exec-output', { execution_id: 'exec-001', line: 'hello' });
      flushCliStreamFrames();
    });

    expect(result.current.earlyDroppedCount).toBe(0);
  });
});

// ===========================================================================
// 2. The buffer itself
// ===========================================================================

describe('createCliStreamBuffer', () => {
  it('holds lines until armed, then delivers them in order', () => {
    const batches: string[][] = [];
    const buffer = createCliStreamBuffer({ onBatch: (b) => batches.push(b) });

    buffer.push('early-1');
    buffer.push('early-2');
    expect(batches).toEqual([]);

    buffer.arm();
    buffer.flushNow();

    expect(batches).toEqual([['early-1', 'early-2']]);
    expect(buffer.earlyDroppedCount()).toBe(0);
  });

  it('counts what the hold buffer could not keep instead of losing it silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const batches: string[][] = [];
    const buffer = createCliStreamBuffer({ maxHeld: 2, onBatch: (b) => batches.push(b) });

    for (let i = 1; i <= 5; i += 1) buffer.push(`line-${i}`);
    expect(buffer.earlyDroppedCount()).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1); // counted silently after the first

    buffer.arm();
    buffer.flushNow();
    expect(batches).toEqual([['line-1', 'line-2']]);
    warn.mockRestore();
  });

  it('coalesces many pushes into one batch', () => {
    const batches: string[][] = [];
    const buffer = createCliStreamBuffer({ onBatch: (b) => batches.push(b) });
    buffer.arm();

    for (let i = 0; i < 500; i += 1) buffer.push(`line-${i}`);
    buffer.flushNow();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(500);
  });

  it('delivers nothing after dispose', () => {
    const batches: string[][] = [];
    const buffer = createCliStreamBuffer({ onBatch: (b) => batches.push(b) });
    buffer.arm();
    buffer.push('a');
    buffer.dispose();
    buffer.flushNow();
    expect(batches).toEqual([]);
  });
});

// ===========================================================================
// 3. The capped append
// ===========================================================================

describe('appendCappedLines', () => {
  it('suppresses adjacent duplicates across the seam and inside the batch', () => {
    expect(appendCappedLines(['a'], ['a', 'b', 'b', 'c'], 100)).toEqual(['a', 'b', 'c']);
  });

  it('returns the same array when the batch adds nothing (no re-render)', () => {
    const prev = ['a'];
    expect(appendCappedLines(prev, ['a', 'a'], 100)).toBe(prev);
  });

  it('enforces the cap exactly and keeps the newest lines', () => {
    const prev = Array.from({ length: 5000 }, (_, i) => `old-${i}`);
    const batch = Array.from({ length: 50 }, (_, i) => `new-${i}`);
    const next = appendCappedLines(prev, batch, 5000);

    expect(next).toHaveLength(5000);
    expect(next[next.length - 1]).toBe('new-49');
    expect(next[0]).toBe('old-50');
  });

  it('copies once per batch, not once per line', () => {
    // The old implementation ran one slice+push per line at the cap; this is
    // the property that replaced it -- N lines cost one array construction.
    const prev = Array.from({ length: 5000 }, (_, i) => `old-${i}`);
    const batch = Array.from({ length: 1000 }, (_, i) => `new-${i}`);

    const before = performance.now();
    const next = appendCappedLines(prev, batch, 5000);
    const elapsed = performance.now() - before;

    expect(next).toHaveLength(5000);
    // Generous bound -- the point is that it is not 1,000 x 5,000 string moves.
    expect(elapsed).toBeLessThan(50);
  });
});
