import { Hash } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import type { ToolCallStep } from './comparisonHelpers';

export function ToolTimelineComparison({
  stepsLeft,
  stepsRight,
}: {
  stepsLeft: ToolCallStep[];
  stepsRight: ToolCallStep[];
}) {
  const maxSteps = Math.max(stepsLeft.length, stepsRight.length);
  if (maxSteps === 0) {
    return <p className="typo-body text-muted-foreground/50 text-center py-4">No tool calls</p>;
  }

  return (
    <div className="space-y-1">
      {Array.from({ length: maxSteps }, (_, i) => {
        const l = stepsLeft[i];
        const r = stepsRight[i];
        const durDelta = l?.duration_ms != null && r?.duration_ms != null
          ? r.duration_ms - l.duration_ms
          : null;

        return (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            {/* Left step */}
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl typo-body ${l ? 'bg-secondary/40 border border-primary/10' : 'bg-transparent'}`}>
              {l ? (
                <>
                  <Hash className="w-3 h-3 text-primary/50 flex-shrink-0" />
                  <span className="font-mono text-foreground/80 truncate">{l.tool_name}</span>
                  {l.duration_ms != null && (
                    <span className="ml-auto typo-code text-muted-foreground/60">{formatDuration(l.duration_ms)}</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground/60 typo-body">&mdash;</span>
              )}
            </div>

            {/* Delta badge */}
            <div className="w-16 text-center">
              {durDelta != null ? (
                <span className={`typo-code px-1.5 py-0.5 rounded ${
                  Math.abs(durDelta) < 500 ? 'text-muted-foreground/50'
                    : durDelta < 0 ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-amber-400 bg-amber-500/10'
                }`}>
                  {durDelta > 0 ? '+' : ''}{formatDuration(durDelta)}
                </span>
              ) : l && r ? (
                <span className="text-muted-foreground/60 typo-body">&mdash;</span>
              ) : null}
            </div>

            {/* Right step */}
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl typo-body ${r ? 'bg-secondary/40 border border-primary/10' : 'bg-transparent'}`}>
              {r ? (
                <>
                  <Hash className="w-3 h-3 text-primary/50 flex-shrink-0" />
                  <span className="font-mono text-foreground/80 truncate">{r.tool_name}</span>
                  {r.duration_ms != null && (
                    <span className="ml-auto typo-code text-muted-foreground/60">{formatDuration(r.duration_ms)}</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground/60 typo-body">&mdash;</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
