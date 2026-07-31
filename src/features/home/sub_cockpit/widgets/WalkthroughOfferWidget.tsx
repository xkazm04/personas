import { useState } from 'react';
import { Compass, MessageSquareText, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { WALKTHROUGHS } from '@/features/plugins/companion/guidance/walkthroughs';
import { useSystemStore } from '@/stores/systemStore';
import { composeTour, ingestComposedTour } from '@/stores/slices/system/dynamicTours';
import { silentCatch } from '@/lib/silentCatch';
import type { CockpitWidgetProps } from '../widgetRegistry';

type ComposeState = 'idle' | 'composing' | 'failed';

/**
 * Two-button offer card Athena emits via `show_walkthrough_offer { topic }`
 * when a user asks "how do I X":
 *
 *  - "Show me" → if a static guided walkthrough covers `topic`, starts it via
 *    `startGuidance` (orb glides, elements glow, Athena narrates). Otherwise
 *    (Generative Tours) it asks `compose_tour` to author a spotlight
 *    walkthrough on the spot — a "composing your walkthrough…" ghost state
 *    holds the card while every step is validated against the anchor
 *    manifest, then the composed tour plays through the standard GuidedTour
 *    driver and lands in Home → Learning with the Athena-composed badge.
 *  - "Just tell me" → seeds a chat turn asking for a plain explanation instead
 *    (setPendingPrompt + autoSend) — for users who'd rather read than be toured.
 *
 * Composition failure is honest: the card flips to a short apology and the
 * "Just tell me" path stays available — a broken tour never plays.
 */
export function WalkthroughOfferWidget({ config }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const topic = typeof config?.topic === 'string' ? config.topic : '';
  const summary = typeof config?.summary === 'string' ? config.summary.trim() : '';
  const staticWalkthrough = WALKTHROUGHS[topic];
  const label = staticWalkthrough?.title(t) ?? topic;
  const [composeState, setComposeState] = useState<ComposeState>('idle');

  const showMe = () => {
    if (staticWalkthrough) {
      useCompanionStore.getState().startGuidance(topic);
      return;
    }
    // Generative Tours: no static tour matches — compose one.
    if (composeState === 'composing') return;
    setComposeState('composing');
    composeTour(topic, summary || undefined)
      .then((record) => {
        const id = ingestComposedTour(record);
        if (!id) {
          setComposeState('failed');
          return;
        }
        setComposeState('idle');
        useSystemStore.getState().startTour(id);
      })
      .catch((err) => {
        silentCatch('home/sub_cockpit/WalkthroughOfferWidget:compose')(err);
        setComposeState('failed');
      });
  };

  const tellMe = () => {
    useCompanionStore.getState().setPendingPrompt({
      text: tx(c.walkthrough_offer_tell_prompt, { topic: label.toLowerCase() }),
      autoSend: true,
    });
  };

  if (!topic) return null;

  return (
    <div
      data-testid="companion-walkthrough-offer-widget"
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
    >
      <header className="flex items-baseline gap-2 typo-caption text-primary">
        <Sparkles className="w-3.5 h-3.5" />
        <span className="font-medium">{c.walkthrough_offer_intro}</span>
        <span className="text-foreground truncate" title={summary || label}>
          · {label}
        </span>
      </header>
      {summary && <p className="typo-body text-foreground">{summary}</p>}

      {composeState === 'composing' ? (
        /* Ghost state: Athena is authoring + validating the tour steps. */
        <div
          data-testid="companion-walkthrough-composing"
          className="rounded-interactive border border-primary/20 bg-secondary/30 px-3 py-3 space-y-2"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 shrink-0 text-primary animate-pulse" />
            <span className="typo-body font-medium text-foreground">{c.walkthrough_composing}</span>
          </div>
          <p className="typo-caption text-foreground">{c.walkthrough_composing_hint}</p>
          <div className="space-y-1.5 pt-1" aria-hidden="true">
            <div className="h-2 rounded-full bg-primary/10 animate-pulse w-3/4" />
            <div className="h-2 rounded-full bg-primary/10 animate-pulse w-1/2" />
            <div className="h-2 rounded-full bg-primary/10 animate-pulse w-2/3" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {composeState === 'failed' && (
            <p
              data-testid="companion-walkthrough-compose-failed"
              className="typo-caption text-destructive"
              role="alert"
            >
              {c.walkthrough_compose_failed}
            </p>
          )}
          {composeState !== 'failed' && (
            <button
              type="button"
              data-testid="companion-walkthrough-offer-show"
              onClick={showMe}
              className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-interactive bg-primary text-primary-foreground hover:opacity-90 focus-ring"
            >
              <Compass className="w-4 h-4 shrink-0" />
              <span className="flex flex-col">
                <span className="typo-body font-medium">{c.walkthrough_offer_show}</span>
                <span className="typo-caption opacity-90">{c.walkthrough_offer_show_hint}</span>
              </span>
            </button>
          )}
          <button
            type="button"
            data-testid="companion-walkthrough-offer-tell"
            onClick={tellMe}
            className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-interactive border border-primary/30 bg-secondary/30 text-foreground hover:bg-secondary/50 focus-ring"
          >
            <MessageSquareText className="w-4 h-4 shrink-0 text-primary" />
            <span className="flex flex-col">
              <span className="typo-body font-medium">{c.walkthrough_offer_tell}</span>
              <span className="typo-caption text-foreground">{c.walkthrough_offer_tell_hint}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
