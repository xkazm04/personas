import { StatStrip, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { figureTile } from './figureTile';

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
 * Rendered as one kit Tile holding a StatStrip of one: the label glows, the figure takes the
 * figure's own tone, the delta's tone follows what the figure MEANS (`deltaTone`), and a small
 * count with a unit is drawn as units.
 *
 * Config:
 *   {
 *     "label": "Unresolved Sentry issues",
 *     "value": 12,        // number or string
 *     "delta": "+3",      // optional change indicator (raw string)
 *     "trend": "up",      // "up" | "down" | "flat"
 *     "unit": "issues",   // optional suffix
 *     "intent": "warn",   // "default" | "good" | "warn" | "bad" (how the figure reads)
 *     "better": "down",   // optional: which direction is good news for this figure
 *     "delta_intent": "bad" // optional: the delta's tone, stated outright
 *   }
 */
export function MetricSparkWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const label = (config?.label as string | undefined) ?? title ?? t.overview.cockpit.metric_default;
  return (
    <Tile span={span} actions={actions} footer={footer} testId="cockpit-metric-spark">
      <StatStrip tiles={[figureTile({ ...config, label })]} />
    </Tile>
  );
}
