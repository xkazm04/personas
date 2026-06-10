import { motion, useReducedMotion } from 'framer-motion';
import { Lightbulb } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `log_excerpt` — the evidence widget: a short monospace excerpt (log
 * lines, an error trace, a config snippet) with the lines that matter
 * highlighted and a caption saying what to notice. Athena uses it when
 * an explanation hinges on something the system actually said.
 *
 * Config:
 *   {
 *     "lines": ["…", "…"],            // raw lines, keep under ~20
 *     "highlight_lines": [2, 3],       // 1-based indices to accent
 *     "highlight_intent": "bad",       // "warn" | "bad" — tint of the accent
 *     "caption": "The retry loop…",    // what to notice
 *     "source": "sentry · PERS-212"    // optional provenance label
 *   }
 */
export function LogExcerptWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const lines = (config?.lines as string[] | undefined) ?? [];
  const highlights = new Set((config?.highlight_lines as number[] | undefined) ?? []);
  const highlightIntent = (config?.highlight_intent as string | undefined) ?? 'warn';
  const caption = config?.caption as string | undefined;
  const source = config?.source as string | undefined;

  const accent =
    highlightIntent === 'bad'
      ? 'bg-rose-500/10 border-l-rose-400/70'
      : 'bg-amber-500/10 border-l-amber-400/70';

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      <div className="flex items-baseline gap-2 mb-2.5">
        <span className="typo-caption text-foreground uppercase tracking-wide">
          {title ?? t.overview.cockpit.log_title}
        </span>
        {source && <span className="typo-code text-[11px] ml-auto truncate">{source}</span>}
      </div>
      {lines.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption">
          {t.overview.cockpit.widget_empty}
        </div>
      ) : (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="flex-1 min-h-0 overflow-auto rounded-input border border-foreground/10 bg-background/60"
        >
          <pre className="typo-code text-[11px] leading-relaxed py-1.5">
            {lines.map((line, i) => {
              const highlighted = highlights.has(i + 1);
              return (
                <div
                  key={i}
                  className={`px-2.5 flex gap-2.5 border-l-2 ${
                    highlighted ? accent : 'border-l-transparent'
                  }`}
                >
                  <span className="select-none w-5 text-right shrink-0 opacity-50">
                    {i + 1}
                  </span>
                  <span className={`whitespace-pre-wrap break-all min-w-0 ${highlighted ? 'text-foreground' : ''}`}>
                    {line || ' '}
                  </span>
                </div>
              );
            })}
          </pre>
        </motion.div>
      )}
      {caption && (
        <div className="mt-2.5 flex items-start gap-2">
          <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden />
          <span className="typo-caption leading-relaxed">{caption}</span>
        </div>
      )}
    </div>
  );
}
