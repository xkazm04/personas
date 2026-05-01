import { describe, it, expect } from 'vitest';
import {
  compositeScore,
  compositeScoreFromRow,
  scoreColor,
  WEIGHT_TOOL_ACCURACY,
  WEIGHT_OUTPUT_QUALITY,
  WEIGHT_PROTOCOL_COMPLIANCE,
} from '../evalFramework';

describe('compositeScore', () => {
  it('returns 0 when all inputs are 0', () => {
    expect(compositeScore(0, 0, 0)).toBe(0);
  });

  it('returns 100 when all inputs are 100', () => {
    expect(compositeScore(100, 100, 100)).toBe(100);
  });

  it('weights tool_accuracy at 0.4', () => {
    expect(compositeScore(100, 0, 0)).toBe(40);
  });

  it('weights output_quality at 0.4', () => {
    expect(compositeScore(0, 100, 0)).toBe(40);
  });

  it('weights protocol_compliance at 0.2', () => {
    expect(compositeScore(0, 0, 100)).toBe(20);
  });

  it('rounds the weighted sum to nearest integer', () => {
    // 50*0.4 + 50*0.4 + 51*0.2 = 20 + 20 + 10.2 = 50.2 → 50
    expect(compositeScore(50, 50, 51)).toBe(50);
    // 50*0.4 + 50*0.4 + 53*0.2 = 20 + 20 + 10.6 = 50.6 → 51
    expect(compositeScore(50, 50, 53)).toBe(51);
  });

  it('handles fractional inputs (used by aggregators that pre-average)', () => {
    // Aggregators pass `avg / count` which can be non-integer
    expect(compositeScore(33.333, 66.666, 50)).toBe(Math.round(33.333 * 0.4 + 66.666 * 0.4 + 50 * 0.2));
  });
});

describe('compositeScoreFromRow (null-aware)', () => {
  it('returns null when all three metrics are null', () => {
    expect(compositeScoreFromRow(null, null, null)).toBeNull();
  });

  it('returns the lone present metric when 2 of 3 are null', () => {
    expect(compositeScoreFromRow(80, null, null)).toBe(80);
    expect(compositeScoreFromRow(null, 60, null)).toBe(60);
    expect(compositeScoreFromRow(null, null, 50)).toBe(50);
  });

  it('re-weights when one of three is null (does NOT treat null as 0)', () => {
    // pc null: ta and oq each carry 0.5 weight (was 0.4 / 0.4)
    expect(compositeScoreFromRow(80, 80, null)).toBe(80);
    expect(compositeScoreFromRow(100, 0, null)).toBe(50);
    // oq null: ta=0.4/0.6=2/3, pc=0.2/0.6=1/3
    expect(compositeScoreFromRow(90, null, 60)).toBe(Math.round((90 * 0.4 + 60 * 0.2) / 0.6));
  });

  it('matches compositeScore exactly when all three are present', () => {
    expect(compositeScoreFromRow(80, 70, 60)).toBe(compositeScore(80, 70, 60));
    expect(compositeScoreFromRow(0, 0, 0)).toBe(0);
    expect(compositeScoreFromRow(100, 100, 100)).toBe(100);
  });

  it('does NOT bias toward zero when metrics are missing', () => {
    // The old `compositeScore(r.X ?? 0, r.Y ?? 0, r.Z ?? 0)` pattern would
    // produce 100*0.4 = 40 for a row scored only on tool_accuracy.
    // The correct null-aware behavior: re-weight to 100 (the present metric
    // dominates with weight=1.0).
    expect(compositeScoreFromRow(100, null, null)).toBe(100);
    expect(compositeScoreFromRow(100, null, null)).not.toBe(40);
  });
});

describe('weight constants', () => {
  it('sums to 1.0', () => {
    expect(WEIGHT_TOOL_ACCURACY + WEIGHT_OUTPUT_QUALITY + WEIGHT_PROTOCOL_COMPLIANCE).toBeCloseTo(1.0, 10);
  });

  it('matches Rust SCORE_WEIGHTS defaults (cross-language drift guard)', () => {
    // These values are the canonical defaults in src-tauri/src/engine/eval.rs::SCORE_WEIGHTS.
    // If you change them in Rust, this assertion fails — you also need to update the
    // mirror constants in src/lib/eval/evalFramework.ts (or, better, rely on the
    // loadScoreWeightsOnce() seeded values for runtime arithmetic).
    expect(WEIGHT_TOOL_ACCURACY).toBe(0.4);
    expect(WEIGHT_OUTPUT_QUALITY).toBe(0.4);
    expect(WEIGHT_PROTOCOL_COMPLIANCE).toBe(0.2);
  });
});

describe('scoreColor', () => {
  it('returns foreground for null', () => {
    expect(scoreColor(null)).toBe('text-foreground');
  });

  it('returns success for ≥80', () => {
    expect(scoreColor(80)).toBe('text-status-success');
    expect(scoreColor(95)).toBe('text-status-success');
    expect(scoreColor(100)).toBe('text-status-success');
  });

  it('returns warning for 50–79', () => {
    expect(scoreColor(50)).toBe('text-status-warning');
    expect(scoreColor(65)).toBe('text-status-warning');
    expect(scoreColor(79)).toBe('text-status-warning');
  });

  it('returns error for <50', () => {
    expect(scoreColor(0)).toBe('text-status-error');
    expect(scoreColor(49)).toBe('text-status-error');
  });
});
