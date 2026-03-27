import { useRef, useCallback, useEffect } from 'react';
import { Terminal } from 'lucide-react';
import type { ToolCallStep } from '@/hooks/execution/useReplayTimeline';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';

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
  const formatMs = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-1">
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className="relative h-3 bg-secondary/50 rounded-full cursor-pointer border border-primary/10 overflow-hidden select-none"
      >
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500/60 to-violet-500/60 rounded-full transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
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
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-500 shadow-elevation-2 shadow-blue-500/30 transition-[left] duration-75 z-20"
          style={{ left: `calc(${pct}% - 7px)` }}
        />
      </div>
      <div className="flex justify-between typo-code text-muted-foreground/50 tabular-nums">
        <span>{formatMs(currentMs)}</span>
        <span>{formatMs(totalMs)}</span>
      </div>
    </div>
  );
}

/** Replay terminal panel. */
export function ReplayTerminalPanel({
  visibleLines,
  totalLines,
}: {
  visibleLines: Array<{ index: number; text: string; timestamp_ms: number }>;
  totalLines: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="typo-heading text-muted-foreground/70">Output</span>
        <span className="ml-auto typo-body tabular-nums text-muted-foreground/60">
          {visibleLines.length}/{totalLines} lines
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 typo-code leading-relaxed"
      >
        {visibleLines.map((line) => {
          const style = classifyLine(line.text);
          const cls = TERMINAL_STYLE_MAP[style];
          return (
            <div key={line.index} className={cls || 'text-foreground/90'}>
              {line.text || '\u00A0'}
            </div>
          );
        })}
        {visibleLines.length === 0 && (
          <div className="text-muted-foreground/60 italic">Scrub forward to see output...</div>
        )}
      </div>
    </div>
  );
}
