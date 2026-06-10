import { motion, useReducedMotion } from 'framer-motion';
import { Lightbulb, TriangleAlert } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { runDecisionOption } from '@/features/plugins/companion/decision/resolveDecision';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `verdict` — Athena's answer card. The headline IS the recommendation;
 * reasoning explains why in 1-3 sentences; an optional caveat flags the
 * risk. When a decision is pending on the orb, the card renders the
 * decision's own option chips so the user can resolve it right here in
 * the Cockpit (same `runDecisionOption` path as the bubble / `;`-keys /
 * voice — all four surfaces resolve identically).
 *
 * Config:
 *   {
 *     "headline": "Approve the run",         // the answer, short
 *     "reasoning": "markdown…",              // why — 1-3 sentences
 *     "confidence": "high",                  // "high" | "medium" | "low"
 *     "intent": "good",                      // "good" | "warn" | "bad" | "info"
 *     "recommended_option": 1,               // 1-based index into the pending decision's options
 *     "caveat": "…"                          // optional watch-out line
 *   }
 */
export function VerdictWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const pendingDecision = useCompanionStore((s) => s.pendingDecision);

  const headline = (config?.headline as string) ?? '';
  const reasoning = config?.reasoning as string | undefined;
  const confidence = config?.confidence as 'high' | 'medium' | 'low' | undefined;
  const intent = (config?.intent as string | undefined) ?? 'info';
  const recommendedOption = config?.recommended_option as number | undefined;
  const caveat = config?.caveat as string | undefined;

  const intentClass =
    intent === 'good'
      ? 'text-emerald-400'
      : intent === 'warn'
        ? 'text-amber-400'
        : intent === 'bad'
          ? 'text-rose-400'
          : 'text-primary';

  const confidenceLabel =
    confidence === 'high'
      ? t.overview.cockpit.verdict_confidence_high
      : confidence === 'medium'
        ? t.overview.cockpit.verdict_confidence_medium
        : confidence === 'low'
          ? t.overview.cockpit.verdict_confidence_low
          : null;

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb className={`w-4 h-4 ${intentClass} shrink-0`} aria-hidden />
        <span className="typo-caption text-foreground uppercase tracking-wide">
          {title ?? t.overview.cockpit.verdict_title}
        </span>
        {confidenceLabel && (
          <span className="ml-auto typo-caption px-2 py-0.5 rounded-full bg-foreground/[0.06] border border-foreground/10 shrink-0">
            {t.overview.cockpit.verdict_confidence} · {confidenceLabel}
          </span>
        )}
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {headline ? (
          <div className={`typo-heading-lg ${intentClass}`}>{headline}</div>
        ) : (
          <div className="typo-caption">{t.overview.cockpit.widget_empty}</div>
        )}
        {reasoning && (
          <MarkdownRenderer
            content={reasoning}
            className="typo-body text-foreground leading-relaxed mt-2"
          />
        )}
        {caveat && (
          <div className="mt-2.5 flex items-start gap-2 rounded-input border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5">
            <TriangleAlert className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" aria-hidden />
            <span className="typo-caption text-foreground leading-relaxed">{caveat}</span>
          </div>
        )}
      </motion.div>

      {/* Live decision chips — only while the orb still holds the decision.
          Mirrors OrbDecisionBubble's digit-badge chips so the affordance is
          recognizably "the same question, answerable here". */}
      {pendingDecision && pendingDecision.options.length > 0 && (
        <div className="mt-auto pt-3">
          <div className="typo-caption uppercase tracking-wide mb-1.5">
            {t.overview.cockpit.verdict_resolve}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pendingDecision.options.map((opt, i) => {
              const recommended = recommendedOption === i + 1;
              return (
                <button
                  key={opt.key}
                  type="button"
                  data-testid={`cockpit-verdict-option-${i + 1}`}
                  onClick={() => runDecisionOption(opt)}
                  title={opt.hint ?? opt.label}
                  className={`inline-flex items-center gap-1.5 max-w-full rounded-interactive px-2.5 py-1.5 typo-caption font-medium transition-colors focus-ring border ${
                    opt.danger
                      ? 'bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20 text-rose-400'
                      : recommended
                        ? 'bg-primary/20 border-primary/40 hover:bg-primary/30 text-primary'
                        : 'bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary'
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-semibold ${
                      opt.danger ? 'bg-rose-500/20' : 'bg-primary/20'
                    }`}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{opt.label}</span>
                  {recommended && (
                    <span className="typo-caption text-primary/80">
                      ★
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
