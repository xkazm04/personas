import { useMemo } from 'react';

interface TimelineRulerProps {
  zoom: number;       // pixels per second
  duration: number;   // total composition duration in seconds
  scrollX: number;    // horizontal scroll offset in pixels
}

/** Format seconds as M:SS or M:SS.s */
function formatRulerTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === Math.floor(s)) {
    return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
  }
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export default function TimelineRuler({ zoom, duration, scrollX }: TimelineRulerProps) {
  // Choose tick interval based on zoom level
  const tickInterval = useMemo(() => {
    if (zoom >= 100) return 0.5;
    if (zoom >= 30) return 1;
    return 5;
  }, [zoom]);

  // Major tick interval for labels
  const majorInterval = useMemo(() => {
    if (tickInterval >= 5) return 5;
    if (tickInterval >= 1) return 5;
    return 2;
  }, [tickInterval]);

  // Render visible ticks plus some buffer
  const ticks = useMemo(() => {
    const totalWidth = Math.max(duration, 10) * zoom;
    const result: { x: number; label: string; major: boolean }[] = [];
    const startSec = Math.floor(scrollX / zoom / tickInterval) * tickInterval;
    const visibleWidth = totalWidth + 200;

    for (let sec = Math.max(0, startSec); sec * zoom < scrollX + visibleWidth; sec += tickInterval) {
      const x = sec * zoom - scrollX;
      const major = sec % majorInterval === 0;
      result.push({ x, label: formatRulerTime(sec), major });
    }
    return result;
  }, [zoom, duration, scrollX, tickInterval, majorInterval]);

  return (
    <div className="relative h-7 bg-gradient-to-b from-card to-card/80 border-b border-primary/15 overflow-hidden select-none flex-shrink-0">
      {/* Subtle grid lines extending down */}
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: `${tick.x}px` }}
        >
          {/* Tick mark */}
          <div
            className={`w-px ${
              tick.major
                ? 'h-full bg-foreground/20'
                : 'h-3 bg-foreground/10 mt-auto'
            }`}
          />
          {/* Label */}
          {tick.major && (
            <span className="absolute bottom-0.5 text-[9px] font-mono text-muted-foreground/60 leading-none whitespace-nowrap translate-x-1">
              {tick.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
