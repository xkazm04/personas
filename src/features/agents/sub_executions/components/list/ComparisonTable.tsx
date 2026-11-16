import { Hash } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import type { ToolCallStep } from '../../libs/comparisonHelpers';
import { useTranslation } from '@/i18n/useTranslation';

export function ToolTimelineComparison({
  stepsLeft,
  stepsRight,
}: {
  stepsLeft: ToolCallStep[];
  stepsRight: ToolCallStep[];
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const maxSteps = Math.max(stepsLeft.length, stepsRight.length);
  if (maxSteps === 0) {
    return <p className="typo-body text-ink-1 text-center py-4">{e.no_tool_calls_short}</p>;
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
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-modal typo-body ${l ? 'bg-surface-2 border border-hair' : 'bg-transparent'}`}>
              {l ? (
                <>
                  <Hash className="w-3 h-3 text-primary/50 flex-shrink-0" />
                  <span className="font-mono text-ink-1 truncate">{l.tool_name}</span>
                  {l.duration_ms != null && (
                    <span className="ml-auto typo-code text-ink-1">{formatDuration(Number(l.duration_ms))}</span>
                  )}
                </>
              ) : (
                <span className="text-ink-1 typo-body">--</span>
              )}
            </div>

            {/* Delta badge */}
            <div className="w-16 text-center">
              {durDelta != null ? (
                <span className={`typo-code px-1.5 py-0.5 rounded-interactive ${
                  Math.abs(Number(durDelta)) < 500 ? 'text-ink-1'
                    : durDelta < 0 ? 'text-status-success bg-status-success/10'
                      : 'text-status-warning bg-status-warning/10'
                }`}>
                  {durDelta > 0 ? '+' : ''}{formatDuration(Number(durDelta))}
                </span>
              ) : l && r ? (
                <span className="text-ink-1 typo-body">--</span>
              ) : null}
            </div>

            {/* Right step */}
            <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-modal typo-body ${r ? 'bg-surface-2 border border-hair' : 'bg-transparent'}`}>
              {r ? (
                <>
                  <Hash className="w-3 h-3 text-primary/50 flex-shrink-0" />
                  <span className="font-mono text-ink-1 truncate">{r.tool_name}</span>
                  {r.duration_ms != null && (
                    <span className="ml-auto typo-code text-ink-1">{formatDuration(Number(r.duration_ms))}</span>
                  )}
                </>
              ) : (
                <span className="text-ink-1 typo-body">--</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
