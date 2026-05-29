/**
 * Shared 0–5 Director-score visual language — tones + sparkline geometry.
 *
 * Extracted from VerdictTrendCell so the personas-table sparkline, the command
 * center Overview distribution, and the roster all speak the same colour/shape
 * vocabulary. The score scale is fixed (0–5), never min/max of the sample, so a
 * "4" sits in the same vertical position everywhere — trends stay comparable
 * across personas at a glance.
 */

export const SCORE_MAX = 5;

export type ScoreTier = 'high' | 'mid' | 'low';

export interface ScoreTone {
  /** CSS color var for line/text. */
  color: string;
  tier: ScoreTier;
}

/** Map a 0–5 score to its tone. ≥4 success, ≥2 warning, else error. */
export function scoreTone(score: number): ScoreTone {
  if (score >= 4) return { color: 'var(--status-success)', tier: 'high' };
  if (score >= 2) return { color: 'var(--status-warning)', tier: 'mid' };
  return { color: 'var(--status-error)', tier: 'low' };
}

/** A translucent fill derived from a tone color (for chips/bars). */
export function toneFill(color: string, pct = 12): string {
  return `color-mix(in oklab, ${color} ${pct}%, transparent)`;
}

/**
 * Project a score series onto an SVG box, anchored to the fixed 0–5 range.
 * Returns the `points` string for a `<polyline>` plus the last point's coords
 * (for the trailing dot). Assumes `scores.length >= 2`.
 */
export function sparklinePoints(
  scores: number[],
  w: number,
  h: number,
  pad: number,
): { points: string; lastX: number; lastY: number } {
  const x = (i: number) => pad + (i / (scores.length - 1)) * (w - pad * 2);
  const y = (s: number) => h - pad - (s / SCORE_MAX) * (h - pad * 2);
  const points = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  return {
    points,
    lastX: x(scores.length - 1),
    lastY: y(scores[scores.length - 1]!),
  };
}
