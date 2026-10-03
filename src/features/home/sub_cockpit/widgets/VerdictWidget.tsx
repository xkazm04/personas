import { Dot, Hint, KitButton, Stack, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { runDecisionOption } from '@/features/companions/athena/decision/resolveDecision';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';

/**
 * `verdict` — Athena's answer card. The headline IS the recommendation;
 * reasoning explains why in 1-3 sentences; an optional caveat flags the
 * risk. When a decision is pending on the orb, the card renders the
 * decision's own options so the user can resolve it right here in
 * the Cockpit (same `runDecisionOption` path as the bubble / `;`-keys /
 * voice — all four surfaces resolve identically).
 *
 * Rendered as one kit Tile: the verdict's intent is the tile's own mark on its rail (kit
 * grow-4), confidence is the head's meta; the headline is the one emphasis, in
 * ink (an answer, not a warning), its intent drawn as the Dot before it; the caveat is a caption
 * line behind a warning dot; the pending decision's options are KitButtons in the Tile footer
 * (the recommended one is the tile's primary call to action, each carries its number key as the
 * key hint, an option's own hint is its Hint), followed by any host footer actions.
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
export function VerdictWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
  const pendingDecision = useAthenaStore((s) => s.pendingDecision);

  const headline = (config?.headline as string | undefined) ?? '';
  const reasoning = config?.reasoning as string | undefined;
  const confidence = config?.confidence as 'high' | 'medium' | 'low' | undefined;
  const recommendedOption = config?.recommended_option as number | undefined;
  const caveat = config?.caveat as string | undefined;
  const tone = intentTone(config?.intent, 'info');
  const confidenceLabel = confidence === 'high' ? c.verdict_confidence_high
    : confidence === 'medium' ? c.verdict_confidence_medium
      : confidence === 'low' ? c.verdict_confidence_low : null;

  const options = pendingDecision?.options ?? [];
  const choices = options.length > 0 ? (
    <>
      <span className="typo-caption">{c.verdict_resolve}</span>
      {options.map((opt, i) => {
        const button = (
          <KitButton
            key={opt.key}
            tone={recommendedOption === i + 1 ? 'primary' : 'default'}
            icon={opt.danger ? <Dot tone="error" /> : undefined}
            hint={String(i + 1)}
            testId={`cockpit-verdict-option-${i + 1}`}
            onClick={() => runDecisionOption(opt)}
          >
            {opt.label}
          </KitButton>
        );
        return opt.hint ? <Hint key={opt.key} content={opt.hint}><span className="inline-flex">{button}</span></Hint> : button;
      })}
    </>
  ) : null;

  return (
    <Tile
      span={span}
      title={title ?? c.verdict_title}
      mark={headline ? { tone, glyph: 'solid', label: toneLabel(t, tone) } : undefined}
      meta={confidenceLabel ? `${c.verdict_confidence} · ${confidenceLabel}` : undefined}
      actions={actions}
      footer={choices || footer ? <>{choices}{footer}</> : undefined}
      state={headline ? undefined : 'empty'}
      empty={{ title: c.widget_empty }}
      testId="cockpit-verdict"
    >
      <div className="k-in max-w-[96ch]">
        <Stack gap="s">
          <div className="typo-heading-lg k-strong flex items-baseline gap-2">
            <Dot tone={tone} glyph="solid" />
            <span className="min-w-0">{headline}</span>
          </div>
          {reasoning && <MarkdownRenderer content={reasoning} variant="card" />}
          {caveat && (
            <p className="typo-caption m-0 flex items-baseline gap-2">
              <Dot tone="warning" glyph="hollow" />
              <span className="min-w-0">{caveat}</span>
            </p>
          )}
        </Stack>
      </div>
    </Tile>
  );
}
