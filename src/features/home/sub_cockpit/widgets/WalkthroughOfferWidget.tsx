import { Compass, MessageSquareText, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { WALKTHROUGHS } from '@/features/plugins/companion/guidance/walkthroughs';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Two-button offer card Athena emits via `show_walkthrough_offer { topic }`
 * when a user asks "how do I X" and a guided walkthrough covers X:
 *
 *  - "Show me" → starts the guided walkthrough for `topic` (orb glides around
 *    the surface, elements glow, Athena narrates) via `startGuidance`.
 *  - "Just tell me" → seeds a chat turn asking for a plain explanation instead
 *    (setPendingPrompt + autoSend) — for users who'd rather read than be toured.
 *
 * Generalizes `show_persona_creation_offer` (which is hard-wired to the
 * persona_creation topic) to any allow-listed walkthrough. Advisory, read-once
 * — not pinnable to the cockpit.
 */
export function WalkthroughOfferWidget({ config }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const topic = typeof config?.topic === 'string' ? config.topic : '';
  const summary = typeof config?.summary === 'string' ? config.summary.trim() : '';
  const label = WALKTHROUGHS[topic]?.title(t) ?? topic;

  const showMe = () => {
    useCompanionStore.getState().startGuidance(topic);
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
      <div className="flex flex-col gap-2">
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
    </div>
  );
}
