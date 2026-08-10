// TriageCardHeader — the first two seconds of a card.
//
// Two jobs now: WHAT IT SAYS (the headline) and, when there is one, the ONE
// fact that reframes the decision (the alert banner). A rule closes the block,
// so the prose below starts against an edge.
//
// WHAT KIND of thing this is and WHOSE it is are no longer here at all. They
// were a row of chips and a source stamp above the headline, and that row cost
// the prose its height on every card; both now straddle the card's borders
// alongside the metric badges (see `CardEdgeRails`). The headline therefore
// owns a standalone row at the card's full width — no chip column beside it, no
// measure cap on it.
//
// Hierarchy here is TYPE + TOKEN, never opacity (Design.md §"Hierarchy by type
// + color tokens"): headline `typo-heading` / `text-foreground`, the banner's
// label in its tone.
import { memo } from 'react';

import type { TriageAlert, TriageItem } from '../triageTypes';
import { TONE_BORDER, TONE_FILL, TONE_TEXT } from './DeckChips';

/**
 * The alert banner — the one fact that reframes the decision.
 *
 * Deliberately NOT a chip. A chip sits in a row of six other chips and reads as
 * one more label; the fact that a team step is HELD on this verdict has to be
 * the second thing the eye lands on after the headline. So: a solid tone rail
 * down the leading edge, the tone's own tint, and the consequence spelled out
 * in prose rather than implied by a colour.
 *
 * NOT a live region. It used to carry `role="status"`, which is an implicit
 * `aria-live="polite"` — and the deck keeps THREE cards mounted for depth, so
 * the surface that documents itself as having "ONE live region" was mounting up
 * to three more, each announcing a banner belonging to a card nobody is
 * deciding. The banner is card CONTENT: it is read in place, as part of the
 * card, when the card is read. What actually changes gets announced through the
 * app's `AriaLiveProvider` (see `TriageDeckVariant`).
 */
function AlertBanner({ alert }: { alert: TriageAlert }) {
  const Icon = alert.icon;
  return (
    <div
      className={`mt-3 flex items-start gap-2.5 overflow-hidden rounded-card border ${TONE_BORDER[alert.tone]} bg-secondary/25`}
    >
      <span className={`w-1 shrink-0 self-stretch ${TONE_FILL[alert.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <p className={`flex items-center gap-1.5 typo-label ${TONE_TEXT[alert.tone]}`}>
          {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          {alert.label}
        </p>
        {alert.detail ? <p className="typo-caption mt-0.5 text-foreground">{alert.detail}</p> : null}
      </div>
    </div>
  );
}

/**
 * Memoised on `item`, stable for the life of a card.
 *
 * Neither the headline nor the banner depends on what is being typed into a
 * question card's answer box — which is the one thing that re-renders
 * `TriageCard` past its own `memo`.
 */
export const TriageCardHeader = memo(function TriageCardHeader({ item }: { item: TriageItem }) {
  return (
    <header className="shrink-0 border-b border-primary/10 pb-3.5">
      {/* No measure cap, no neighbours, NO `text-balance`. The 68ch cap belongs
          to the PROSE, which is read a line at a time; a headline is scanned in
          one movement, and capping it was buying a second line the card then
          had to pay for in height.
          `text-balance` was doing the same thing by another route — it evens
          the two lines out, which means breaking the FIRST one well before the
          card's edge. The box was always the card's full width; balancing was
          what stopped the text from using it.

          The weight is an inline style and cannot be a utility: the rules in
          typography.css are UNLAYERED, so they beat every Tailwind @layer
          regardless of specificity and `typo-heading font-semibold` is silently
          a no-op (that file says so itself). 600 rather than the token's 700 —
          at 14px the headline no longer needs size AND weight to outrank the
          prose beneath it. */}
      <h2 className="typo-heading text-foreground" style={{ fontWeight: 600 }}>
        {item.title}
      </h2>

      {item.alert ? <AlertBanner alert={item.alert} /> : null}
    </header>
  );
});
