import { useMemo } from 'react';
import { formatRulerTime } from '../utils/format';

interface TimelineRulerProps {
  zoom: number;       // pixels per second
  duration: number;   // total composition duration in seconds
}

export default function TimelineRuler({ zoom, duration }: TimelineRulerProps) {
  // Choose tick interval based on zoom level
  const tickInterval = useMemo(() => {
    if (zoom >= 100) return 0.5;
    if (zoom >= 30) return 1;
    return 5;
  }, [zoom]);

  // Major tick interval for labels
  const majorInterval = useMemo(() => {
    if (tickInterval >= 5) return 5;
    return 5;
  }, [tickInterval]);

  const ticks = useMemo(() => {
    const totalSec = Math.max(duration, 10);
    const result: { x: number; label: string; major: boolean }[] = [];
    const count = Math.ceil(totalSec / tickInterval) + 1;
    for (let i = 0; i < count; i++) {
      const sec = i * tickInterval;
      const x = sec * zoom;
      const major = Math.abs(sec % majorInterval) < 1e-6;
      result.push({ x, label: formatRulerTime(sec), major });
    }
    return result;
  }, [zoom, duration, tickInterval, majorInterval]);

  return (
    <div className="relative h-full select-none pointer-events-none">
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="absolute top-0 h-full"
          style={{ left: `${tick.x}px` }}
        >
          {/* Tick mark */}
          <div
            className={`w-px ${
              tick.major
                ? 'h-full bg-foreground/25'
                : 'h-2 bg-foreground/15 mt-auto'
            }`}
          />
          {/* Label */}
          {tick.major && (
            <span className="absolute bottom-0.5 left-1 text-md font-mono text-foreground leading-none whitespace-nowrap tabular-nums">
              {tick.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
