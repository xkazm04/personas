/**
 * Sparkline scale policy.
 *
 * A KPI row puts four tiles side by side and invites the eye to compare them.
 * The sparkline used to map every series onto its own `min`..`max`, so a
 * 99.1 -> 99.3 success-rate wiggle filled exactly as much of the 16px box as a
 * real cost climb: amplitude meant "this tile had a range", not "this moved a
 * lot". The fix is not to delete the sparkline but to let the caller say which
 * scale the series should be read on.
 *
 * - `'auto'`   - the old behaviour: fit the sample. Correct for a lone tile
 *                whose absolute level is meaningless.
 * - `'zero'`   - anchor the floor at 0 (or at the minimum, if the series goes
 *                negative), so height is proportional to magnitude.
 * - `{min,max}`- an explicit domain. This is what a ROW passes to every one of
 *                its tiles when their amplitudes are meant to be compared, and
 *                what a percent series passes as `{min:0,max:100}`.
 */
export type SparkScale = 'auto' | 'zero' | { min: number; max: number };

export interface SparkDomain {
  min: number;
  max: number;
}

/** The domain a series is drawn on under a given policy. */
export function sparklineDomain(data: number[], scale: SparkScale = 'auto'): SparkDomain {
  if (typeof scale === 'object') return { min: scale.min, max: scale.max };
  const sampleMin = Math.min(...data);
  const sampleMax = Math.max(...data);
  // `'zero'` on a series that dips below zero would clip it. The floor is the
  // lower of 0 and the sample, which keeps every point drawable while still
  // anchoring a normal (non-negative) series at 0.
  const min = scale === 'zero' ? Math.min(0, sampleMin) : sampleMin;
  return { min, max: sampleMax };
}

/**
 * The `points` attribute for the polyline, or `null` when there is nothing
 * honest to draw. Fewer than two points is not a line, and a caller that gets
 * `null` renders no sparkline at all rather than a flat stub that reads as
 * "no change".
 */
export function sparklinePoints(
  data: number[],
  scale: SparkScale,
  w: number,
  h: number,
): string | null {
  if (data.length < 2) return null;
  const { min, max } = sparklineDomain(data, scale);
  // A flat series (or a degenerate explicit domain) has no range to divide by.
  // Drawing it at the FLOOR, not at half height, is what makes a flat
  // high-percentage series look different from a flat low one on a shared
  // domain — `(v - min) / 1` is 0 when v === min.
  const range = max - min || 1;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      // Clamp: an explicit domain is a claim about the axis, not about the
      // data, so a point outside it must stay inside the box instead of
      // painting over the tile's own chrome.
      const t = Math.min(1, Math.max(0, (v - min) / range));
      return `${x},${h - t * h}`;
    })
    .join(' ');
}
