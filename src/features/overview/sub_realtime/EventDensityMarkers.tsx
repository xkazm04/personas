import { memo, useMemo } from 'react';
import { DENSITY_BINS, MIN_OPACITY, MAX_OPACITY } from './timelinePlayerHelpers';

export const EventDensityMarkers = memo(function EventDensityMarkers({
  timestamps,
  rangeStart,
  rangeEnd,
}: {
  timestamps: number[];
  rangeStart: number;
  rangeEnd: number;
}) {
  const bins = useMemo(() => {
    const span = rangeEnd - rangeStart;
    if (span <= 0 || timestamps.length === 0) return null;

    const counts = new Uint32Array(DENSITY_BINS);
    const binWidth = span / DENSITY_BINS;
    for (const ts of timestamps) {
      const idx = Math.min(Math.floor((ts - rangeStart) / binWidth), DENSITY_BINS - 1);
      if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
    }

    let max = 0;
    for (let i = 0; i < DENSITY_BINS; i++) {
      if (counts[i]! > max) max = counts[i]!;
    }
    if (max === 0) return null;

    const opacities = new Float32Array(DENSITY_BINS);
    for (let i = 0; i < DENSITY_BINS; i++) {
      opacities[i] = counts[i]! > 0
        ? MIN_OPACITY + (counts[i]! / max) * (MAX_OPACITY - MIN_OPACITY)
        : 0;
    }
    return opacities;
  }, [timestamps, rangeStart, rangeEnd]);

  if (!bins) return null;

  return (
    <div className="absolute inset-0 flex" aria-hidden="true">
      {Array.from(bins, (opacity, i) => (
        <div
          key={i}
          className="flex-1 bg-cyan-400"
          style={{ opacity }}
        />
      ))}
    </div>
  );
});
