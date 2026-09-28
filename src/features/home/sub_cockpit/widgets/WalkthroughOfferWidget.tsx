import { useState } from 'react';
import { Compass, MessageSquareText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { GhostRows, Hint, KitButton, Tile } from '@/features/shared/components/kit';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { WALKTHROUGHS } from '@/features/companions/athena/guidance/walkthroughs';
import { useTourStore } from '@/stores/tourStore';
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
export function WalkthroughOfferWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const c = t.athena;
  const topic = typeof config?.topic === 'string' ? config.topic : '';
  const summary = typeof config?.summary === 'string' ? config.summary.trim() : '';
  const staticWalkthrough = WALKTHROUGHS[topic];
  const label = staticWalkthrough?.title(t) ?? topic;
  const [composeState, setComposeState] = useState<ComposeState>('idle');

  const showMe = () => {
    if (staticWalkthrough) {
      useAthenaStore.getState().startGuidance(topic);
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
        useTourStore.getState().startTour(id);
      })
      .catch((err) => {
        silentCatch('home/sub_cockpit/WalkthroughOfferWidget:compose')(err);
        setComposeState('failed');
      });
  };

  const tellMe = () => {
    useAthenaStore.getState().setPendingPrompt({
      text: tx(c.walkthrough_offer_tell_prompt, { topic: label.toLowerCase() }),
      autoSend: true,
    });
  };

  if (!topic) return null;

  const composing = composeState === 'composing';
  const failed = composeState === 'failed';
  return (
    <Tile
      span={span}
      title={title || c.walkthrough_offer_intro}
      actions={actions}
      meta={label}
      testId="companion-walkthrough-offer-widget"
      footer={
        composing ? footer : (
          <>
            {!failed && (
              <Hint content={c.walkthrough_offer_show_hint}>
                <span>
                  <KitButton tone="primary" icon={<Compass />} onClick={showMe} testId="companion-walkthrough-offer-show">
                    {c.walkthrough_offer_show}
                  </KitButton>
                </span>
              </Hint>
            )}
            <Hint content={c.walkthrough_offer_tell_hint}>
              <span>
                <KitButton tone={failed ? 'primary' : 'default'} icon={<MessageSquareText />} onClick={tellMe} testId="companion-walkthrough-offer-tell">
                  {c.walkthrough_offer_tell}
                </KitButton>
              </span>
            </Hint>
            {footer}
          </>
        )
      }
    >
      {summary && !composing && <p className="k-in typo-body m-0">{summary}</p>}
      {/* One polite region, mounted from the first render, so the change to "composing" is announced. */}
      <span className="sr-only" role="status">{composing ? c.walkthrough_composing : ''}</span>
      {composing && (
        /* Athena is authoring + validating the tour steps: the kit ghost under the sentence. */
        <div data-testid="companion-walkthrough-composing">
          <p className="k-in typo-body m-0">{c.walkthrough_composing}</p>
          <p className="k-in typo-caption k-quiet m-0">{c.walkthrough_composing_hint}</p>
          <GhostRows count={2} size="s" />
        </div>
      )}
      {failed && (
        <p data-testid="companion-walkthrough-compose-failed" className="k-in typo-body k-toned t-error m-0" role="alert">
          {c.walkthrough_compose_failed}
        </p>
      )}
    </Tile>
  );
}
