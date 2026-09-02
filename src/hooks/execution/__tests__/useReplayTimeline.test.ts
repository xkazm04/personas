/**
 * THE REPLAY SHOWS WHAT THE RECORD CONTAINS.
 *
 * `useReplayTimeline` is the whole read model behind the Replay tab — the
 * scrubber, the visible log window, the step states and the cost bar all come
 * out of it — and it had ZERO tests. The two defects pinned here are the ones
 * that produced visibly wrong replays:
 *
 *  1. An unclosed tool step (`ended_at_ms == null`) satisfied `activeStep` for
 *     every later scrub position, so one such step mid-list masked every step
 *     after it and never entered `completedSteps` — leaving the cost bar short
 *     of 100% at the End marker. Measured on two DB snapshots: 240 of 2,998
 *     persisted steps unclosed, 239 of them mid-list, across 80 of 252 runs.
 *  2. Log lines were apportioned EVENLY across the run, so a four-minute stall
 *     and two lines 3ms apart rendered identically — a tempo the record never
 *     contained. The engine logger writes an RFC3339 prefix on every line; the
 *     timeline now reads it.
 *
 * Plus the plumbing nothing was holding: the visible-line binary search, the
 * boundary stepping, and the reset-on-new-input effect.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';
import {
  useReplayTimeline,
  parseToolSteps,
  buildToolStepSpans,
  countVisibleLines,
  type TimelineLogLine,
} from '../useReplayTimeline';

function step(
  step_index: number,
  tool_name: string,
  started_at_ms: number,
  ended_at_ms: number | null,
): ToolCallStep {
  return {
    step_index,
    tool_name,
    input_preview: '',
    output_preview: '',
    started_at_ms,
    ended_at_ms,
    duration_ms: ended_at_ms == null ? null : ended_at_ms - started_at_ms,
  } as ToolCallStep;
}

const lines = (...ts: number[]): TimelineLogLine[] =>
  ts.map((timestamp_ms, index) => ({ index, text: `l${index}`, timestamp_ms }));

describe('parseToolSteps', () => {
  it('returns an empty array for null and for a non-array blob', () => {
    expect(parseToolSteps(null)).toEqual([]);
    // A legacy/hand-edited row can hold anything; everything downstream indexes it.
    expect(parseToolSteps({ nope: true } as unknown as ToolCallStep[])).toEqual([]);
  });

  it('passes a real array through untouched', () => {
    const steps = [step(0, 'Bash', 0, 10)];
    expect(parseToolSteps(steps)).toBe(steps);
  });
});

describe('countVisibleLines', () => {
  it('counts lines at or before the cutoff', () => {
    const ls = lines(0, 100, 100, 250, 900);
    expect(countVisibleLines(ls, -1)).toBe(0);
    expect(countVisibleLines(ls, 0)).toBe(1);
    // Inclusive, and stable across a tie.
    expect(countVisibleLines(ls, 100)).toBe(3);
    expect(countVisibleLines(ls, 249)).toBe(3);
    expect(countVisibleLines(ls, 10_000)).toBe(5);
    expect(countVisibleLines([], 5)).toBe(0);
  });
});

describe('buildToolStepSpans', () => {
  it('bounds an unclosed mid-list step at the next step start', () => {
    const spans = buildToolStepSpans(
      [step(0, 'Bash', 0, null), step(1, 'Read', 400, 500)],
      1_000,
    );
    expect(spans[0]).toMatchObject({ start_ms: 0, end_ms: 400, inferred_end: true });
    expect(spans[1]).toMatchObject({ start_ms: 400, end_ms: 500, inferred_end: false });
  });

  it('bounds an unclosed FINAL step at the end of the run', () => {
    const spans = buildToolStepSpans([step(0, 'Bash', 200, null)], 1_000);
    expect(spans[0]).toMatchObject({ end_ms: 1_000, inferred_end: true });
  });

  it('never inverts a window when the next step starts before this one', () => {
    // Malformed ordering must not produce end < start.
    const spans = buildToolStepSpans([step(0, 'Bash', 800, null), step(1, 'Read', 100, 200)], 1_000);
    expect(spans[0]!.end_ms).toBe(800);
  });
});

describe('useReplayTimeline — a historical row with an unclosed mid-list step', () => {
  // The exact shape the snapshots are full of: step 0 was left open by the old
  // LIFO writer, steps 1 and 2 closed normally.
  const steps = [
    step(0, 'Bash', 0, null),
    step(1, 'Read', 400, 600),
    step(2, 'Edit', 700, 900),
  ];

  it('stops treating the unclosed step as active once the next one starts', () => {
    const { result } = renderHook(() => useReplayTimeline(steps, null, 1_000, 1));
    act(() => result.current[1].scrubTo(200));
    expect(result.current[0].activeStep?.step_index).toBe(0);

    act(() => result.current[1].scrubTo(500));
    // Before: step 0 still matched, masking step 1 for the rest of the run.
    expect(result.current[0].activeStep?.step_index).toBe(1);
    expect(result.current[0].completedSteps.map((s) => s.step_index)).toEqual([0]);
  });

  it('reaches every step in completedSteps, and totalCost, at the End marker', () => {
    const { result } = renderHook(() => useReplayTimeline(steps, null, 1_000, 4));
    act(() => result.current[1].jumpToEnd());
    expect(result.current[0].completedSteps).toHaveLength(3);
    expect(result.current[0].activeStep).toBeNull();
    // Before: 2/3 of the cost, so the bar stopped short of 100% on ~32% of runs.
    expect(result.current[0].accumulatedCost).toBeCloseTo(4, 10);
  });

  it('offers the inferred boundary to the scrubber steppers', () => {
    const { result } = renderHook(() => useReplayTimeline(steps, null, 1_000, 1));
    act(() => result.current[1].stepForward());
    expect(result.current[0].currentMs).toBe(400);
    act(() => result.current[1].stepForward());
    expect(result.current[0].currentMs).toBe(600);
    act(() => result.current[1].stepBackward());
    expect(result.current[0].currentMs).toBe(400);
    act(() => result.current[1].jumpToStart());
    expect(result.current[0].currentMs).toBe(0);
  });
});

describe('useReplayTimeline — recorded tempo', () => {
  const log = [
    '[2026-06-01T10:00:00.000Z] start',
    '[2026-06-01T10:00:00.250Z] quick',
    '[2026-06-01T10:04:00.250Z] after a four-minute stall',
  ].join('\n');

  it('places prefixed lines at the time they were written, not evenly', () => {
    const { result } = renderHook(() => useReplayTimeline(null, log, 300_000, 0));
    const ts = result.current[0].allLines.map((l) => l.timestamp_ms);
    expect(ts).toEqual([0, 250, 240_250]);
    // The even apportionment this replaces would have put line 1 at 150_000.
  });

  it('surfaces the silence between two lines as a real gap', () => {
    const { result } = renderHook(() => useReplayTimeline(null, log, 300_000, 0));
    expect(result.current[0].silences).toEqual([{ start_ms: 250, end_ms: 240_250 }]);
  });

  it('interpolates unprefixed continuation lines between their neighbours', () => {
    const mixed = [
      '[2026-06-01T10:00:00.000Z] start',
      '  stack frame one',
      '  stack frame two',
      '[2026-06-01T10:00:00.300Z] done',
    ].join('\n');
    const { result } = renderHook(() => useReplayTimeline(null, mixed, 1_000, 0));
    const ts = result.current[0].allLines.map((l) => l.timestamp_ms);
    expect(ts[0]).toBe(0);
    expect(ts[3]).toBe(300);
    expect(ts[1]).toBeGreaterThan(0);
    expect(ts[2]).toBeGreaterThan(ts[1]!);
    expect(ts[2]).toBeLessThan(300);
  });

  it('falls back to even apportionment when no line carries a prefix', () => {
    const { result } = renderHook(() => useReplayTimeline(null, 'a\nb\nc', 1_000, 0));
    expect(result.current[0].allLines.map((l) => l.timestamp_ms)).toEqual([0, 500, 1_000]);
    expect(result.current[0].silences).toEqual([]);
  });

  it('still has a timeline when duration_ms is null but the log is timestamped', () => {
    // A cancelled run has no duration; the record still knows how long it ran.
    const { result } = renderHook(() => useReplayTimeline(null, log, null, 0));
    expect(result.current[0].totalMs).toBe(240_250);
    expect(result.current[0].allLines).toHaveLength(3);
    act(() => result.current[1].jumpToEnd());
    expect(result.current[0].visibleLines).toHaveLength(3);
  });

  it('has nothing to replay when there is neither a duration nor a timestamp', () => {
    const { result } = renderHook(() => useReplayTimeline(null, 'a\nb', null, 0));
    expect(result.current[0].totalMs).toBe(0);
    expect(result.current[0].hasTimeline).toBe(false);
  });
});

describe('useReplayTimeline — visible window and reset', () => {
  it('reveals lines as the scrub advances', () => {
    const log = '[2026-06-01T10:00:00.000Z] a\n[2026-06-01T10:00:01.000Z] b\n[2026-06-01T10:00:02.000Z] c';
    const { result } = renderHook(() => useReplayTimeline(null, log, 2_000, 0));
    expect(result.current[0].visibleLines).toHaveLength(1);
    act(() => result.current[1].scrubTo(1_000));
    expect(result.current[0].visibleLines).toHaveLength(2);
    act(() => result.current[1].jumpToEnd());
    expect(result.current[0].visibleLines).toHaveLength(3);
  });

  it('clamps a scrub outside the run to the run', () => {
    const { result } = renderHook(() => useReplayTimeline(null, null, 1_000, 0));
    act(() => result.current[1].scrubTo(-500));
    expect(result.current[0].currentMs).toBe(0);
    act(() => result.current[1].scrubTo(99_999));
    expect(result.current[0].currentMs).toBe(1_000);
  });

  it('rewinds to the start when a different execution is loaded', () => {
    const { result, rerender } = renderHook(
      ({ log, dur }: { log: string; dur: number }) => useReplayTimeline(null, log, dur, 0),
      { initialProps: { log: 'a\nb', dur: 1_000 } },
    );
    act(() => {
      result.current[1].scrubTo(900);
      result.current[1].setSpeed(4);
      result.current[1].setForkPoint(1);
      result.current[1].play();
    });
    expect(result.current[0].currentMs).toBe(900);

    rerender({ log: 'x\ny', dur: 2_000 });

    // Otherwise the new run opens mid-way through, at the previous run's clock.
    expect(result.current[0].currentMs).toBe(0);
    expect(result.current[0].speed).toBe(1);
    expect(result.current[0].forkPoint).toBeNull();
    expect(result.current[0].isPlaying).toBe(false);
  });
});
