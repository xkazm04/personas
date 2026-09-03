/**
 * THE LIVE TRACE PRICES THE RUN IT JUST WATCHED.
 *
 * `traceStage` hard-coded `cost_usd: null` on every frontend stage span, while
 * the hook that calls it had the real `cost_usd` from the terminal status event
 * in its hand and put it in `metadata` — a field no cost reader in the app
 * looks at. A live, frontend-built `UnifiedTrace` was therefore structurally
 * unpriceable: every stage drawn, no money anywhere.
 *
 * The distinction these tests defend, everywhere it appears: **`null` is "we
 * could not price this run", `0` is "this run was free"**. Collapsing them is
 * how an unpriced run gets reported as free, and it is the same defect the
 * trace inspector's own comments record having fixed twice already.
 *
 * `SyntheticTrace` is deliberately untouched and untested here: it is
 * RECONSTRUCTED from a finished record and refuses to estimate money on
 * purpose. This trace watched the run happen.
 */
import { describe, it, expect } from 'vitest';
import {
  completeTrace,
  createPipelineTrace,
  traceCost,
  traceStage,
} from '../pipeline';

describe('traceStage measurements', () => {
  it('leaves a stage unpriced when no measurement is supplied', () => {
    const t = traceStage(createPipelineTrace('e-1'), 'validate');
    expect(t.spans[0]?.cost_usd).toBeNull();
  });

  it('records the cost on the span field, not only in metadata', () => {
    const t = traceStage(
      createPipelineTrace('e-1'),
      'finalize_status',
      { costUsd: 0.0123 },
      undefined,
      { costUsd: 0.0123 },
    );
    expect(t.spans[0]?.cost_usd).toBe(0.0123);
  });

  it('keeps a genuinely free stage at 0 instead of folding it into null', () => {
    const t = traceStage(createPipelineTrace('e-1'), 'finalize_status', undefined, undefined, {
      costUsd: 0,
    });
    expect(t.spans[0]?.cost_usd).toBe(0);
    expect(t.spans[0]?.cost_usd).not.toBeNull();
  });

  it('treats an explicit null measurement as unpriced', () => {
    const t = traceStage(createPipelineTrace('e-1'), 'finalize_status', undefined, undefined, {
      costUsd: null,
    });
    expect(t.spans[0]?.cost_usd).toBeNull();
  });

  it('does NOT write the run duration into the span duration', () => {
    // The run's wall clock is not the finalize stage's wall clock. Writing it
    // here would draw a bar covering the whole run at the finalize offset.
    const t = traceStage(
      createPipelineTrace('e-1'),
      'finalize_status',
      { durationMs: 127_200 },
      undefined,
      { costUsd: 0.5 },
    );
    expect(t.spans[0]?.duration_ms).toBeNull();
  });
});

describe('traceCost', () => {
  it('returns null for a trace nothing priced', () => {
    let t = createPipelineTrace('e-1');
    t = traceStage(t, 'validate');
    t = traceStage(t, 'stream_output');
    expect(traceCost(t)).toBeNull();
  });

  it('returns 0 for a run priced at exactly zero', () => {
    const t = traceStage(createPipelineTrace('e-1'), 'finalize_status', undefined, undefined, {
      costUsd: 0,
    });
    expect(traceCost(t)).toBe(0);
  });

  it('sums only the spans that carry a cost', () => {
    let t = createPipelineTrace('e-1');
    t = traceStage(t, 'validate');
    t = traceStage(t, 'stream_output', undefined, undefined, { costUsd: 0.25 });
    t = traceStage(t, 'finalize_status', undefined, undefined, { costUsd: 0.75 });
    expect(traceCost(t)).toBeCloseTo(1, 10);
  });
});

describe('a live trace reports the cost the status event carried', () => {
  /** The exact sequence usePersonaExecution drives for a real run. */
  function liveTrace(costUsd: number | null, durationMs: number | null) {
    let t = createPipelineTrace('exec-live');
    t = traceStage(t, 'validate');
    t = traceStage(t, 'spawn_engine');
    t = traceStage(t, 'stream_output');
    t = traceStage(
      t,
      'finalize_status',
      { status: 'completed', durationMs, costUsd },
      undefined,
      { costUsd },
    );
    return completeTrace(t);
  }

  it('carries the price all the way to a reader, through completeTrace', () => {
    const t = liveTrace(0.0421, 12_000);
    expect(traceCost(t)).toBe(0.0421);
    // completeTrace closes every open span; it must not blank the cost while
    // it does so.
    const finalize = t.spans.find((s) => s.span_type === 'finalize_status');
    expect(finalize?.cost_usd).toBe(0.0421);
    expect(finalize?.duration_ms).not.toBeNull();
  });

  it('stays unpriced when the status event carried no cost', () => {
    const t = liveTrace(null, 12_000);
    expect(traceCost(t)).toBeNull();
    expect(t.spans.find((s) => s.span_type === 'finalize_status')?.cost_usd).toBeNull();
  });
});
