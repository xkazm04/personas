/**
 * The quantum a UnitStrip draws a quantity in: the smallest 1-2-5 step (from `min` up) that
 * keeps the strip at or under `maxUnits` squares, so a busy month and a quiet day both draw a
 * countable strip. The chosen step is shown in the section's legend.
 */
export function quantumFor(total: number, maxUnits = 60, min = 1): number {
  if (!(total > 0)) return min;
  for (let mag = min; mag < 1e12; mag *= 10) {
    for (const step of [1, 2, 5]) {
      const q = mag * step;
      if (total / q <= maxUnits) return q;
    }
  }
  return min;
}
