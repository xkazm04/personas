/**
 * What an empty deck offers instead of a blank: the other chips that still
 * hold cards, each with its count and a printed digit. Picking one opens the
 * deck on that chip (`switchDeckChip`). Today's scope is the chip; the lanes
 * of the mandate plan replace this list when they land.
 */
import { Layers } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionChip } from '../model/decisionModel';
import { chipLabel } from './deckMeta';
import { switchDeckChip } from './deckStore';
import { DECK_PRIORITY, digitOf, isTypingTarget, plain } from './keys';
import { Keycap } from './parts';

export interface ChipOffer { chip: DecisionChip; n: number }

export function EmptyOffers({ offers }: { offers: ChipOffer[] }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  useAppKeyboard((e) => {
    if (isTypingTarget(e.target) || !plain(e) || e.shiftKey) return false;
    const d = digitOf(e);
    const offer = d ? offers[d - 1] : undefined;
    if (!offer) return false;
    switchDeckChip(offer.chip);
    e.preventDefault();
    return true;
  }, { enabled: offers.length > 0, priority: DECK_PRIORITY });
  if (offers.length === 0) return null;
  return (
    <div className="flex w-full max-w-[420px] flex-col gap-2" data-testid="deck-empty-offers">
      <span className="typo-eyebrow text-foreground">{m.dc_deck_empty_offers}</span>
      {offers.map((o, i) => (
        <Button
          key={o.chip}
          variant="ghost"
          size="md"
          block
          onClick={() => switchDeckChip(o.chip)}
          aria-label={tx(m.dc_deck_empty_offer_aria, { label: chipLabel(m, o.chip), count: o.n })}
          icon={<Layers className="h-4 w-4" aria-hidden />}
          className="au-branch au-sheen au-lift min-w-0 justify-start! rounded-input px-3! hover:bg-transparent [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
        >
          <span className="min-w-0 flex-1 text-left typo-body text-foreground">{chipLabel(m, o.chip)}</span>
          <span className="typo-heading tabular-nums text-foreground">{o.n}</span>
          <Keycap>{i + 1}</Keycap>
        </Button>
      ))}
    </div>
  );
}
