import { StatStrip, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { figureTile, type FigureConfig } from './figureTile';

/**
 * `stat_grid` — N labeled numbers in a compact tile grid; generalizes
 * `metric_spark` so Athena can show the 3-6 figures that frame a
 * situation ("4 failures this week · $0.82 spent · 96% success") in
 * one widget instead of a row of singletons.
 *
 * Rendered as one kit Tile holding a StatStrip: the strip wraps by the room it has, so labels
 * never truncate and a sixth figure never leaves a half-empty second row of boxes. `columns` is
 * accepted for old specs and ignored (the strip decides its own wrap).
 *
 * Config:
 *   {
 *     "stats": [
 *       {
 *         "label": "Failures (7d)",       // required
 *         "value": 4,                     // number or string
 *         "unit": "runs",                 // optional suffix
 *         "delta": "+3",                  // optional change string
 *         "trend": "up",                  // "up" | "down" | "flat"
 *         "intent": "bad",                // "default" | "good" | "warn" | "bad"
 *         "better": "down",               // optional: which direction is good news
 *         "delta_intent": "bad"           // optional: the delta's tone, stated outright
 *       }
 *     ]
 *   }
 */
export function StatGridWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const stats = Array.isArray(config?.stats) ? (config.stats as FigureConfig[]) : [];
  return (
    <Tile
      span={span}
      title={title}
      actions={actions}
      footer={footer}
      state={stats.length === 0 ? 'empty' : undefined}
      empty={{ title: t.overview.cockpit.widget_empty }}
      testId="cockpit-stat-grid"
    >
      <StatStrip tiles={stats.map(figureTile)} />
    </Tile>
  );
}
