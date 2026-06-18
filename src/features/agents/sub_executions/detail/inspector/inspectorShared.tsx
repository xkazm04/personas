import { ArrowDownToLine, ArrowUpFromLine, DollarSign, Database, Clock, type LucideIcon } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { HighlightedJsonBlock } from './HighlightedJsonBlock';
import { formatCost, type ToolCallStep } from './inspectorTypes';
import type { PersonaExecution } from '@/lib/types/types';

/**
 * Shared primitives for the prototype Inspector variants.
 *
 * `InspectorStatStrip` is the dense, single-row replacement for the baseline's
 * five tall metric cards. `StepIO` renders one tool call's input/output as
 * syntax-highlighted JSON (via {@link HighlightedJsonBlock}) instead of the
 * baseline's plain `<pre>` previews. Both are consumed by every variant, so
 * they're extracted here from round 1.
 */

export function InspectorStatStrip({ execution }: { execution: PersonaExecution }) {
  const { t } = useTranslation();
  const e = t.agents.executions;

  const cacheRead = execution.cache_read_tokens ?? 0;
  const cacheCreation = execution.cache_creation_tokens ?? 0;
  const hasCacheData = cacheRead > 0 || cacheCreation > 0;
  const totalInputWithCache = execution.input_tokens + cacheRead + cacheCreation;
  const cacheHitPct =
    totalInputWithCache > 0 ? Math.round((cacheRead / totalInputWithCache) * 100) : 0;

  const stats: Array<{ icon: LucideIcon; label: string; value: string }> = [
    { icon: ArrowDownToLine, label: e.input_tokens, value: execution.input_tokens.toLocaleString() },
    { icon: ArrowUpFromLine, label: e.output_tokens, value: execution.output_tokens.toLocaleString() },
    { icon: DollarSign, label: e.cost, value: formatCost(execution.cost_usd) },
    { icon: Database, label: e.cache_hit, value: hasCacheData ? `${cacheHitPct}%` : '–' },
    { icon: Clock, label: e.duration, value: formatDuration(execution.duration_ms) },
  ];

  return (
    <div className="flex flex-wrap items-stretch gap-px rounded-modal border border-primary/20 bg-secondary/40 overflow-hidden">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="flex-1 min-w-[104px] flex items-center gap-2 px-3 py-2 bg-secondary/20">
            <Icon className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
            <div className="min-w-0">
              <div className="typo-code text-foreground uppercase tracking-wider truncate">{s.label}</div>
              <div className="typo-body font-mono text-foreground/90 truncate">{s.value}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Labeled, syntax-highlighted input + output for one tool-call step. */
export function StepIO({ step, dense = false }: { step: ToolCallStep; dense?: boolean }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const maxH = dense ? 'max-h-48' : 'max-h-80';

  if (!step.input_preview && !step.output_preview) {
    return <div className="typo-code text-foreground py-3 text-center">{e.pending}</div>;
  }

  return (
    <div className="space-y-2.5">
      {step.input_preview && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 typo-code text-blue-400 uppercase tracking-wider">
            <ArrowDownToLine className="w-3 h-3" /> {e.input}
          </div>
          <div className={`${maxH} overflow-y-auto`}>
            <HighlightedJsonBlock raw={step.input_preview} />
          </div>
        </div>
      )}
      {step.output_preview && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 typo-code text-amber-400 uppercase tracking-wider">
            <ArrowUpFromLine className="w-3 h-3" /> {e.output}
          </div>
          <div className={`${maxH} overflow-y-auto`}>
            <HighlightedJsonBlock raw={step.output_preview} />
          </div>
        </div>
      )}
    </div>
  );
}
