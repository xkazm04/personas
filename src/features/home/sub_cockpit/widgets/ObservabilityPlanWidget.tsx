import { useMemo } from 'react';
import { Activity, AlertTriangle, BarChart3, Gauge, Target } from 'lucide-react';
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
 * The 7th readiness item from cycle-6 doctrine: every persona needs
 * (a) an error path that doesn't black-hole — failures go to a queue a
 * human can review, not to a silent log; (b) at least one success
 * metric tracked so quality degradation is visible.
 *
 * Renders two stacked sections: error handling (red accent, the
 * "failure mode" half) and success metric (emerald accent, the
 * "ongoing-health" half).
 */
export function ObservabilityPlanWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const intent =
    typeof config?.intent === 'string' ? (config.intent as string).trim() : '';

  const errorHandling = useMemo<ErrorHandling | null>(() => {
    const raw = config?.error_handling;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const triggers = Array.isArray(obj.triggers)
      ? obj.triggers.filter((t): t is string => typeof t === 'string')
      : [];
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

  if (!errorHandling && !successMetric) {
    return (
      <div className="rounded-card border border-foreground/10 bg-secondary/40 p-3 typo-caption text-foreground">
        {t.plugins.companion.observability_plan_empty}
      </div>
    );
  }

  return (
    <div
      className="rounded-card border border-foreground/15 bg-secondary/30 p-4 space-y-3"
      data-testid="companion-observability-plan-widget"
    >
      <header className="flex items-baseline gap-2 typo-caption text-foreground">
        <Activity className="w-3.5 h-3.5" />
        <span className="font-medium">
          {title || t.plugins.companion.observability_plan_title}
        </span>
        {intent && (
          <span className="text-foreground truncate" title={intent}>
            · {intent}
          </span>
        )}
      </header>
      {errorHandling && (
        <section
          className="rounded-card border border-rose-500/30 bg-rose-500/[0.04] p-3 space-y-2"
          data-section="error-handling"
        >
          <h4 className="flex items-center gap-1.5 typo-caption text-rose-300/85 font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t.plugins.companion.observability_plan_error_path}
          </h4>
          {errorHandling.triggers.length > 0 && (
            <ul className="space-y-1 pl-1 typo-caption text-foreground">
              {errorHandling.triggers.map((trig, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="text-rose-400/85 shrink-0">•</span>
                  <span>{trig}</span>
                </li>
              ))}
            </ul>
          )}
          {errorHandling.escalation && (
            <div className="typo-caption text-foreground pt-1 border-t border-rose-500/15">
              <span className="text-foreground">
                {t.plugins.companion.observability_plan_escalation}
                {': '}
              </span>
              {errorHandling.escalation}
            </div>
          )}
        </section>
      )}
      {successMetric && (
        <section
          className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.04] p-3 space-y-2"
          data-section="success-metric"
        >
          <h4 className="flex items-center gap-1.5 typo-caption text-emerald-300/85 font-medium">
            <Target className="w-3.5 h-3.5" />
            {t.plugins.companion.observability_plan_success_metric}
          </h4>
          <div className="flex items-center gap-2 typo-caption">
            <MetricIcon kind={successMetric.kind} />
            <span className="font-medium text-foreground/90">
              {metricLabel(successMetric.kind, t)}
            </span>
          </div>
          {successMetric.description && (
            <p className="typo-caption text-foreground leading-relaxed">
              {successMetric.description}
            </p>
          )}
          {successMetric.target && (
            <div className="typo-caption text-foreground pt-1 border-t border-emerald-500/15">
              <span className="text-foreground">
                {t.plugins.companion.observability_plan_target}
                {': '}
              </span>
              {successMetric.target}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MetricIcon({ kind }: { kind: SuccessMetric['kind'] }) {
  if (kind === 'cost_per_run') {
    return <BarChart3 className="w-3.5 h-3.5 text-emerald-300/85" />;
  }
  if (kind === 'latency') {
    return <Gauge className="w-3.5 h-3.5 text-emerald-300/85" />;
  }
  return <BarChart3 className="w-3.5 h-3.5 text-emerald-300/85" />;
}

function metricLabel(
  kind: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (kind === 'count_by_status')
    return t.plugins.companion.observability_metric_count_by_status;
  if (kind === 'cost_per_run')
    return t.plugins.companion.observability_metric_cost_per_run;
  if (kind === 'latency')
    return t.plugins.companion.observability_metric_latency;
  return t.plugins.companion.observability_metric_custom;
}
