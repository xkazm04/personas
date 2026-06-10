import { motion, useReducedMotion } from 'framer-motion';
import { Check, Minus, Star } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `comparison_cards` — the decision's options side-by-side with pros,
 * cons, and a recommended badge. Athena reaches for this when the user
 * is weighing 2-3 paths (approve vs reject, retry vs rollback) and the
 * trade-offs deserve more structure than prose.
 *
 * Config:
 *   {
 *     "options": [
 *       {
 *         "label": "Approve",               // required
 *         "summary": "Run the persona…",    // optional one-liner
 *         "pros": ["…"],                    // optional
 *         "cons": ["…"],                    // optional
 *         "recommended": true,              // accents the card + badge
 *         "intent": "good"                  // "good" | "warn" | "bad" | "info"
 *       }
 *     ]
 *   }
 */
interface ComparisonOption {
  label: string;
  summary?: string;
  pros?: string[];
  cons?: string[];
  recommended?: boolean;
  intent?: 'good' | 'warn' | 'bad' | 'info';
}

const INTENT_TEXT: Record<NonNullable<ComparisonOption['intent']>, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
  info: 'text-primary',
};

export function ComparisonCardsWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const options = (config?.options as ComparisonOption[] | undefined) ?? [];
  const cols = Math.max(1, Math.min(options.length, 3));

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      {title ? (
        <div className="typo-caption text-foreground uppercase tracking-wide mb-3">
          {title}
        </div>
      ) : null}
      {options.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption">
          {t.overview.cockpit.widget_empty}
        </div>
      ) : (
        <div
          className="flex-1 grid gap-2.5 overflow-y-auto"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {options.map((opt, i) => (
            <motion.div
              key={`${i}-${opt.label}`}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut', delay: reduceMotion ? 0 : i * 0.1 }}
              className={`rounded-card border p-3 min-w-0 flex flex-col ${
                opt.recommended
                  ? 'border-primary/40 bg-primary/[0.06]'
                  : 'border-foreground/10 bg-secondary/20'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`typo-body font-semibold truncate ${INTENT_TEXT[opt.intent ?? 'info']}`}
                >
                  {opt.label}
                </span>
                {opt.recommended && (
                  <span className="ml-auto inline-flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">
                    <Star className="w-3 h-3" aria-hidden />
                    {t.overview.cockpit.comparison_recommended}
                  </span>
                )}
              </div>
              {opt.summary && (
                <p className="typo-caption leading-relaxed mt-1">{opt.summary}</p>
              )}
              {(opt.pros?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1">
                  {opt.pros!.map((p, j) => (
                    <li key={j} className="flex items-start gap-1.5 typo-caption leading-relaxed">
                      <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" aria-hidden />
                      <span className="min-w-0">{p}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(opt.cons?.length ?? 0) > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {opt.cons!.map((c, j) => (
                    <li key={j} className="flex items-start gap-1.5 typo-caption leading-relaxed">
                      <Minus className="w-3 h-3 text-rose-400 mt-0.5 shrink-0" aria-hidden />
                      <span className="min-w-0">{c}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
