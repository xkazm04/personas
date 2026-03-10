import { useCallback, useRef } from 'react';
import type { ToolCallStep } from '@/hooks/execution/useReplayTimeline';
import { formatMs } from './ReplayHelpers';

/** Timeline scrub bar with tool step markers. */
export function TimelineScrubber({
  currentMs,
  totalMs,
  toolSteps,
  activeStepIndex,
  forkPoint,
  onScrub,
  onSetForkPoint,
}: {
  currentMs: number;
  totalMs: number;
  toolSteps: ToolCallStep[];
  activeStepIndex: number | null;
  forkPoint: number | null;
  onScrub: (ms: number) => void;
  onSetForkPoint: (idx: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!trackRef.current || totalMs <= 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const scrub = (clientX: number) => {
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        onScrub(pct * totalMs);
      };
      scrub(e.clientX);
      const onMove = (ev: PointerEvent) => scrub(ev.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [totalMs, onScrub],
  );

  const pct = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

  return (
    <div className="space-y-1">
      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className="relative h-3 bg-secondary/50 rounded-full cursor-pointer border border-primary/10 overflow-hidden select-none"
      >
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500/60 to-violet-500/60 rounded-full transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />

        {/* Tool step markers */}
        {toolSteps.map((s) => {
          const x = totalMs > 0 ? (s.started_at_ms / totalMs) * 100 : 0;
          const isFork = forkPoint === s.step_index;
          return (
            <div
              key={s.step_index}
              className={`absolute top-0 h-full w-[3px] transition-colors cursor-pointer ${
                isFork
                  ? 'bg-amber-400/90 z-10'
                  : activeStepIndex === s.step_index
                    ? 'bg-blue-400/80'
                    : 'bg-primary/25'
              }`}
              style={{ left: `${x}%` }}
              title={`Step ${s.step_index + 1}: ${s.tool_name}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetForkPoint(isFork ? null : s.step_index);
              }}
            />
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-500 shadow-md shadow-blue-500/30 transition-[left] duration-75 z-20"
          style={{ left: `calc(${pct}% - 7px)` }}
        />
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-sm font-mono text-muted-foreground/50 tabular-nums">
        <span>{formatMs(currentMs)}</span>
        <span>{formatMs(totalMs)}</span>
      </div>
    </div>
  );
}
