import { useMemo } from 'react';
import { Dot, KeyValueGrid, Meta, Tile, type KeyValueItem } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface ErrorHandling {
  triggers: string[];
  escalation: string;
}

interface SuccessMetric {
  kind: 'count_by_status' | 'cost_per_run' | 'latency' | 'custom' | string;
  description: string;
  target?: string;
}

/**
 * Inline chat-card Athena emits via
 *   `show_observability_plan { intent, error_handling, success_metric }`.
 *
 * The 7th readiness item from the cycle-6 doctrine: every persona needs (a) an error path that
 * does not black-hole (failures reach a queue a human reviews) and (b) at least one tracked
 * success metric. One kit Tile holding one KeyValueGrid: the failure half (what goes wrong,
 * where it escalates; its glyph in the warning tone) and the health half (the metric, what it
 * measures, its target; its glyph in the success tone). The intent is not repeated here.
 */
export function ObservabilityPlanWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;

  const errorHandling = useMemo<ErrorHandling | null>(() => {
    const raw = config?.error_handling;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const triggers = Array.isArray(obj.triggers) ? obj.triggers.filter((x): x is string => typeof x === 'string') : [];
    const escalation = typeof obj.escalation === 'string' ? obj.escalation : '';
    return { triggers, escalation };
  }, [config]);

  const successMetric = useMemo<SuccessMetric | null>(() => {
    const raw = config?.success_metric;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const kind = typeof obj.kind === 'string' ? (obj.kind as SuccessMetric['kind']) : 'custom';
    const description = typeof obj.description === 'string' ? obj.description : '';
    const target = typeof obj.target === 'string' ? obj.target : undefined;
    return { kind, description, target };
  }, [config]);

  const items: KeyValueItem[] = [];
  if (errorHandling) {
    if (errorHandling.triggers.length > 0) {
      items.push({
        k: <Keyed tone="warning" label={a.observability_plan_error_path} />,
        v: <span className="flex flex-wrap gap-x-2" data-section="error-handling"><Meta parts={errorHandling.triggers.map((trig, i) => <span key={i}>{trig}</span>)} /></span>,
      });
    }
    if (errorHandling.escalation) items.push({ k: a.observability_plan_escalation, v: errorHandling.escalation });
  }
  if (successMetric) {
    items.push({
      k: <Keyed tone="success" label={a.observability_plan_success_metric} />,
      v: (
        <span className="flex flex-wrap gap-x-2" data-section="success-metric">
          <Meta parts={[<span key="k">{metricLabel(successMetric.kind, t)}</span>, successMetric.description ? <span key="d">{successMetric.description}</span> : null]} />
        </span>
      ),
    });
    if (successMetric.target) items.push({ k: a.observability_plan_target, v: successMetric.target });
  }

  return (
    <Tile
      span={span}
      title={title || a.observability_plan_title}
      actions={actions}
      footer={footer}
      state={!errorHandling && !successMetric ? 'empty' : undefined}
      empty={{ title: a.observability_plan_empty }}
      testId="companion-observability-plan-widget"
    >
      <KeyValueGrid items={items} min="260px" />
    </Tile>
  );
}

/** A key with its half's glyph: the failure half in the warning tone, the health half in success. */
function Keyed({ tone, label }: { tone: 'warning' | 'success'; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><Dot tone={tone} glyph="soft" />{label}</span>;
}

function metricLabel(kind: string, t: ReturnType<typeof useTranslation>['t']): string {
  if (kind === 'count_by_status') return t.athena.observability_metric_count_by_status;
  if (kind === 'cost_per_run') return t.athena.observability_metric_cost_per_run;
  if (kind === 'latency') return t.athena.observability_metric_latency;
  return t.athena.observability_metric_custom;
}
