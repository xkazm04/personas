import { useEffect, useState } from 'react';

import { getExecution } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { tokenLabel } from '@/i18n/tokenMaps';
import { silentCatch } from '@/lib/silentCatch';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Dot, KeyValueGrid, Tile, type Tone } from '@/features/shared/components/kit';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Execution facts - six facts about a single execution as one kit Tile holding a
 * KeyValueGrid (quiet keys over regular values). Status and outcome carry their
 * tone as a Dot before the value; nothing else is coloured.
 *
 * Config:
 *   { executionId: string, personaId: string }
 */
export function ExecutionFactsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
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

  const status = exec ? statusTone(exec.status) : null;
  const outcome = exec ? outcomeTone(exec.business_outcome) : null;
  return (
    <Tile
      span={span}
      title={title ?? c.execution_facts_title}
      actions={actions}
      footer={footer}
      testId="cockpit-widget-execution_facts"
      state={!exec && !error ? 'loading' : undefined}
      ghostRows={2}
      error={error ? { title: error } : undefined}
    >
      {exec && (
        <KeyValueGrid
          min="10rem"
          items={[
            { k: c.fact_model, v: exec.model_used ? <span className="typo-code">{exec.model_used}</span> : null, none: '-' },
            { k: c.fact_cost, v: <Numeric value={exec.cost_usd} unit="usd" /> },
            {
              k: c.fact_duration,
              v: exec.duration_ms != null ? <><Numeric value={exec.duration_ms / 1000} precision={1} />s</> : null,
              none: '-',
            },
            { k: c.fact_tokens, v: <><Numeric value={exec.input_tokens} /> / <Numeric value={exec.output_tokens} /></> },
            { k: c.fact_status, draw: status && <Dot tone={status} />, v: tokenLabel(t, 'execution', exec.status) },
            { k: c.fact_outcome, draw: outcome && <Dot tone={outcome} />, v: outcomeLabel(exec.business_outcome, t) },
          ]}
        />
      )}
    </Tile>
  );
}

function statusTone(status: string): Tone | null {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'success') return 'success';
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'running' || s === 'pending') return 'warning';
  return null;
}

function outcomeLabel(o: string, t: Translations): string {
  const d = t.director;
  switch (o) {
    case 'value_delivered': return d.value_leak_delivered;
    case 'no_input_available': return d.value_leak_no_input;
    case 'precondition_failed': return d.value_leak_precondition;
    case 'partial': return d.value_leak_partial;
    case 'unknown': return d.value_leak_unknown;
    default: return o;
  }
}

function outcomeTone(o: string): Tone | null {
  if (o === 'value_delivered') return 'success';
  if (o === 'partial' || o === 'no_input_available') return 'warning';
  if (o === 'precondition_failed') return 'error';
  return null;
}
