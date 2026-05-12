import { useEffect, useState } from 'react';
import { Activity, AlertCircle, Cpu, DollarSign, Hourglass, Sparkles, Tag } from 'lucide-react';

import { getExecution } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Execution facts — six KPI tiles for a single execution.
 *
 * Config:
 *   { executionId: string, personaId: string }
 */
export function ExecutionFactsWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const executionId = (config?.executionId as string | undefined) ?? '';
  const personaId = (config?.personaId as string | undefined) ?? '';

  const [exec, setExec] = useState<PersonaExecution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!executionId || !personaId) return;
    let cancelled = false;
    getExecution(executionId, personaId)
      .then((row) => { if (!cancelled) setExec(row); })
      .catch((err) => {
        silentCatch('ExecutionFactsWidget:getExecution')(err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [executionId, personaId]);

  return (
    <div
      data-testid="cockpit-widget-execution_facts"
      className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground/60 uppercase tracking-wide">
          {title ?? t.overview.cockpit.execution_facts_title}
        </div>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center gap-2 typo-caption text-rose-300/80">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      ) : !exec ? (
        <div className="flex-1 grid grid-cols-2 gap-2 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-input bg-foreground/[0.04] h-14" />
          ))}
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-2 overflow-y-auto min-h-0">
          <KpiTile
            icon={<Cpu className="w-3.5 h-3.5 text-violet-400/80" />}
            label={t.overview.cockpit.fact_model}
            value={exec.model_used ?? '—'}
            mono
          />
          <KpiTile
            icon={<DollarSign className="w-3.5 h-3.5 text-emerald-400/80" />}
            label={t.overview.cockpit.fact_cost}
            value={`$${exec.cost_usd.toFixed(4)}`}
          />
          <KpiTile
            icon={<Hourglass className="w-3.5 h-3.5 text-sky-400/80" />}
            label={t.overview.cockpit.fact_duration}
            value={
              exec.duration_ms != null
                ? `${(exec.duration_ms / 1000).toFixed(1)}s`
                : '—'
            }
          />
          <KpiTile
            icon={<Activity className="w-3.5 h-3.5 text-amber-400/80" />}
            label={t.overview.cockpit.fact_tokens}
            value={`${exec.input_tokens.toLocaleString()} / ${exec.output_tokens.toLocaleString()}`}
          />
          <KpiTile
            icon={<Tag className="w-3.5 h-3.5 text-foreground/55" />}
            label={t.overview.cockpit.fact_status}
            value={exec.status}
            tone={statusTone(exec.status)}
          />
          <KpiTile
            icon={<Sparkles className="w-3.5 h-3.5 text-fuchsia-400/80" />}
            label={t.overview.cockpit.fact_outcome}
            value={prettyOutcome(exec.business_outcome)}
            tone={outcomeTone(exec.business_outcome)}
          />
        </div>
      )}
    </div>
  );
}

function KpiTile({
  icon, label, value, tone, mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'error' | null;
  mono?: boolean;
}) {
  const valueTone =
    tone === 'success' ? 'text-emerald-300' :
    tone === 'warning' ? 'text-amber-300' :
    tone === 'error'   ? 'text-rose-300' :
    'text-foreground/95';
  return (
    <div className="rounded-input border border-foreground/10 bg-background/40 px-3 py-2 min-w-0">
      <div className="flex items-center gap-1.5 typo-caption text-foreground/55">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 typo-body font-medium ${valueTone} ${mono ? 'font-mono' : ''} truncate`}>
        {value}
      </div>
    </div>
  );
}

function statusTone(status: string): 'success' | 'warning' | 'error' | null {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'success') return 'success';
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'running' || s === 'pending') return 'warning';
  return null;
}

function prettyOutcome(o: string): string {
  switch (o) {
    case 'value_delivered': return 'Value delivered';
    case 'no_input_available': return 'No input';
    case 'precondition_failed': return 'Precondition failed';
    case 'partial': return 'Partial';
    case 'unknown': return 'Unknown';
    default: return o;
  }
}

function outcomeTone(o: string): 'success' | 'warning' | 'error' | null {
  if (o === 'value_delivered') return 'success';
  if (o === 'partial' || o === 'no_input_available') return 'warning';
  if (o === 'precondition_failed') return 'error';
  return null;
}
