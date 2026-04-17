import { useState } from 'react';
import type { PipelineTraceEntry, PipelineStage } from '@/lib/execution/pipeline';
import { STAGE_META } from '@/lib/execution/pipeline';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { STAGE_COLORS } from './stageColors';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Waterfall Bar
// ---------------------------------------------------------------------------

export function StageBar({
  entry,
  totalDurationMs,
  isExpanded,
  onToggle,
  hasSubSpans,
}: {
  entry: PipelineTraceEntry;
  totalDurationMs: number;
  isExpanded: boolean;
  onToggle: () => void;
  hasSubSpans: boolean;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const stageKey = entry.span_type as PipelineStage;
  const config = STAGE_COLORS[stageKey];
  const meta = STAGE_META[stageKey];
  const offsetMs = entry.start_ms;
  const durationMs = entry.duration_ms ?? 0;
  const leftPct = totalDurationMs > 0 ? (offsetMs / totalDurationMs) * 100 : 0;
  const widthPct = totalDurationMs > 0 ? Math.max((durationMs / totalDurationMs) * 100, 0.5) : 0;

  return (
    <div
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-1.5 hover:bg-secondary/30 rounded transition-colors">
        {/* Left: stage label */}
        <div className="flex items-center gap-1.5 min-w-0">
          {hasSubSpans ? (
            <button onClick={onToggle} className="p-0.5 rounded hover:bg-primary/10 flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-foreground" />
              )}
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.text} ${config.border} flex-shrink-0`}>
            {config.category}
          </span>
          <span className="typo-heading text-foreground/85 truncate">{meta.label}</span>
          {entry.error && <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
        </div>

        {/* Center: waterfall bar */}
        <div className="relative h-6 w-full">
          <div className="absolute inset-0 bg-primary/5 rounded" />
          <div
            className={`absolute top-1 bottom-1 rounded-full ${entry.error ? 'bg-gradient-to-r from-red-500/50 to-orange-500/40 shadow-[inset_0_1px_2px_rgba(239,68,68,0.3)]' : `${config.barGradient} ${config.barShadow}`} transition-all`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              minWidth: '3px',
            }}
          />
          {/* Hover tooltip */}
          {hovered && (
            <div
              className="absolute z-20 bottom-full mb-1 bg-background/95 border border-primary/20 rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm whitespace-nowrap pointer-events-none"
              style={{ left: `${Math.min(leftPct, 70)}%` }}
            >
              <p className="typo-heading text-foreground/90 mb-1">{meta.label}</p>
              <p className="typo-body text-foreground mb-1">{meta.boundary}</p>
              <div className="flex items-center gap-3 typo-body">
                <span className="font-mono text-foreground">{formatDuration(durationMs)}</span>
                <span className="text-foreground">{t.agents.executions.offset_prefix} {formatDuration(offsetMs)}</span>
              </div>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {Object.entries(entry.metadata).map(([k, v]) => (
                    <div key={k} className="typo-body text-foreground">
                      <span className="text-foreground">{k}:</span>{' '}
                      <span className="font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: duration */}
        <span className="typo-code text-foreground text-right">
          {formatDuration(durationMs)}
        </span>
      </div>
    </div>
  );
}
