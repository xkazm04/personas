/**
 * The deck's two card-less states, drawn in the card's own material so the
 * stack never changes shape around them:
 *  - ghost  the roster has not answered yet — a quiet plate with the card's
 *           anatomy sketched in (no spinner, loading pattern v2);
 *  - empty  the queue has nothing left — said in words, not as a blank, and
 *           followed by the other chips that still hold cards (`EmptyOffers`).
 */
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyOffers, type ChipOffer } from './EmptyOffers';

export function GhostCard() {
  const { t } = useTranslation();
  return (
    <div
      className="au-card absolute inset-0 flex gap-2 overflow-hidden rounded-modal p-3 pl-0"
      role="status"
      aria-label={t.monitor.dc_deck_loading_aria}
      data-testid="deck-ghost"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4 pl-7 pt-3">
        <span className="au-hero-tile h-12 w-12 rounded-card" aria-hidden />
        <span className="au-hero-tile h-6 w-2/3 rounded-input" aria-hidden />
        <span className="au-hero-tile h-4 w-1/2 rounded-input" aria-hidden />
      </div>
      <div className="au-well w-[340px] flex-shrink-0 rounded-card" aria-hidden />
    </div>
  );
}

export function EmptyCard({ offers = [] }: { offers?: ChipOffer[] }) {
  const { t } = useTranslation();
  return (
    <div className="au-card absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-modal px-6" data-testid="deck-empty">
      <ScenarioEmptyState art="inbox" size="sm" title={t.monitor.dc_hub_peek_empty_title} subtitle={t.monitor.dc_hub_peek_empty_hint} />
      <EmptyOffers offers={offers} />
    </div>
  );
}
