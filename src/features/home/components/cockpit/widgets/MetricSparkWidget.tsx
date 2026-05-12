import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `metric_spark` — single KPI card with optional trend marker.
 *
 * Athena reaches for this when she wants the user to see one number
 * (and how it's changing) front and center: "12 unresolved Sentry
 * issues this week (+3)", "47 active personas (-2)".
 *
 * No backend fetching — Athena populates the values she's already
 * computed via connector_use or memory. The widget is purely visual
 * presentation of her conclusion.
 *
 * Config:
 *   {
 *     "label": "Unresolved Sentry issues",
 *     "value": 12,        // number or string
 *     "delta": "+3",      // optional change indicator (raw string)
 *     "trend": "up",      // "up" | "down" | "flat" — colors the delta
 *     "unit": "issues",   // optional suffix
 *     "intent": "warn"    // "default" | "good" | "warn" | "bad"
 *   }
 */
export function MetricSparkWidget({ config, title }: CockpitWidgetProps) {
  const label = (config?.label as string) ?? title ?? 'Metric';
  const value = config?.value;
  const delta = config?.delta as string | undefined;
  const trend = config?.trend as 'up' | 'down' | 'flat' | undefined;
  const unit = config?.unit as string | undefined;
  const intent = (config?.intent as string | undefined) ?? 'default';

  const intentClass =
    intent === 'good'
      ? 'text-emerald-400'
      : intent === 'warn'
        ? 'text-amber-400'
        : intent === 'bad'
          ? 'text-rose-400'
          : 'text-foreground';

  const trendClass =
    trend === 'up'
      ? 'text-emerald-400'
      : trend === 'down'
        ? 'text-rose-400'
        : 'text-foreground/50';

  const displayValue =
    value === null || value === undefined ? '—' : String(value);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      <div className="typo-caption text-foreground/60 uppercase tracking-wide mb-2">
        {label}
      </div>
      <div className="flex-1 flex flex-col items-start justify-center gap-1">
        <div className={`typo-display ${intentClass} tabular-nums`}>
          {displayValue}
          {unit ? (
            <span className="typo-body text-foreground/50 ml-1">{unit}</span>
          ) : null}
        </div>
        {delta ? (
          <div className={`typo-caption ${trendClass} tabular-nums`}>
            {delta}
          </div>
        ) : null}
      </div>
    </div>
  );
}
