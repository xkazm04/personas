import { motion, useReducedMotion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `stat_grid` — N labeled numbers in a compact tile grid; generalizes
 * `metric_spark` so Athena can show the 3-6 figures that frame a
 * situation ("4 failures this week · $0.82 spent · 96% success") in
 * one widget instead of a row of singletons.
 *
 * Config:
 *   {
 *     "stats": [
 *       {
 *         "label": "Failures (7d)",       // required
 *         "value": 4,                     // number or string
 *         "unit": "runs",                 // optional suffix
 *         "delta": "+3",                  // optional change string
 *         "trend": "up",                  // "up" | "down" | "flat" — colors delta
 *         "intent": "bad"                 // "default" | "good" | "warn" | "bad"
 *       }
 *     ],
 *     "columns": 3                        // optional, 2-4 (default 3)
 *   }
 */
interface StatItem {
  label: string;
  value: number | string;
  unit?: string;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  intent?: 'default' | 'good' | 'warn' | 'bad';
}

const VALUE_TEXT: Record<NonNullable<StatItem['intent']>, string> = {
  default: 'text-foreground',
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
};

export function StatGridWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const stats = (config?.stats as StatItem[] | undefined) ?? [];
  const columns = Math.max(2, Math.min((config?.columns as number | undefined) ?? 3, 4));

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      {title ? (
        <div className="typo-caption text-foreground uppercase tracking-wide mb-3">
          {title}
        </div>
      ) : null}
      {stats.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption">
          {t.overview.cockpit.widget_empty}
        </div>
      ) : (
        <div
          className="flex-1 grid gap-2 content-start overflow-y-auto"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {stats.map((stat, i) => (
            <motion.div
              key={`${i}-${stat.label}`}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut', delay: reduceMotion ? 0 : i * 0.06 }}
              className="rounded-input border border-foreground/10 bg-secondary/20 px-3 py-2.5 min-w-0"
            >
              <div className="typo-caption uppercase tracking-wide truncate">
                {stat.label}
              </div>
              <div
                className={`typo-data-lg tabular-nums mt-0.5 ${VALUE_TEXT[stat.intent ?? 'default']}`}
              >
                {stat.value === null || stat.value === undefined ? '—' : String(stat.value)}
                {stat.unit ? (
                  <span className="typo-caption ml-1">{stat.unit}</span>
                ) : null}
              </div>
              {stat.delta && (
                <div
                  className={`typo-caption tabular-nums ${
                    stat.trend === 'up'
                      ? 'text-emerald-400'
                      : stat.trend === 'down'
                        ? 'text-rose-400'
                        : ''
                  }`}
                >
                  {stat.delta}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
