import { motion, useReducedMotion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `timeline` — chronological events on a vertical rail. Athena uses it
 * to reconstruct how a situation developed (incident escalations, run
 * histories, schedule drift) so the user sees sequence and spacing, not
 * just a list.
 *
 * Config:
 *   {
 *     "events": [
 *       {
 *         "label": "Run failed",              // required
 *         "detail": "exit 1 after 42s…",      // optional
 *         "timestamp": "2026-06-10T14:02:00Z",// optional ISO — renders relative
 *         "intent": "bad"                     // "info" | "good" | "warn" | "bad"
 *       }
 *     ]
 *   }
 */
interface TimelineEvent {
  label: string;
  detail?: string;
  timestamp?: string;
  intent?: 'info' | 'good' | 'warn' | 'bad';
}

const DOT: Record<NonNullable<TimelineEvent['intent']>, string> = {
  info: 'bg-primary/60 ring-primary/20',
  good: 'bg-emerald-400/70 ring-emerald-400/20',
  warn: 'bg-amber-400/70 ring-amber-400/20',
  bad: 'bg-rose-400/70 ring-rose-400/20',
};

export function TimelineWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const events = (config?.events as TimelineEvent[] | undefined) ?? [];

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      <div className="typo-caption text-foreground uppercase tracking-wide mb-3">
        {title ?? t.overview.cockpit.timeline_title}
      </div>
      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption">
          {t.overview.cockpit.widget_empty}
        </div>
      ) : (
        <ol className="flex-1 overflow-y-auto relative space-y-3 pl-4 border-l border-foreground/10">
          {events.map((evt, i) => (
            <motion.li
              key={`${i}-${evt.label}`}
              initial={reduceMotion ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut', delay: reduceMotion ? 0 : i * 0.1 }}
              className="relative"
            >
              <span
                aria-hidden
                className={`absolute -left-[21.5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ${DOT[evt.intent ?? 'info']}`}
              />
              <div className="flex items-baseline justify-between gap-3">
                <span className="typo-body font-medium text-foreground leading-snug min-w-0">
                  {evt.label}
                </span>
                {evt.timestamp && (
                  <RelativeTime timestamp={evt.timestamp} className="typo-caption shrink-0" />
                )}
              </div>
              {evt.detail && (
                <p className="typo-caption leading-relaxed mt-0.5">{evt.detail}</p>
              )}
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}
