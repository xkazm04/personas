// CardEdgeRails — the card's META, evicted onto its borders.
//
// Everything here used to live inside the card, above the headline, and it cost
// the prose a full row on every single card. The pattern `MetricBadgeRow`
// already established — a pill straddling the top edge, half in and half out —
// is the one this follows: the card body then contains ONLY the case being
// judged.
//
// WHY TWO EDGES AND NOT ONE. Measured on the live deck, the widest card wants
// 427px of chips + 175px of metric badges + 181px of source stamp = 783px
// across a 690px card with 658px of usable rail. One rail cannot hold them, and
// a rail that silently clips a pill is worse than a second rail. So:
//
//   top border    — metric badges (centred, `MetricBadgeRow`, untouched) and
//                   the source stamp (right). 356px worst case; they never meet.
//   bottom border — the kind + tag chips (left). 427px worst case.
//
// Each rail's inner half lands in padding the card already reserves (`pt-9`
// above, `pb-5` below), so nothing here can ever overlap a line of prose.
//
// All of it is rendered OUTSIDE the card frame, which is `overflow-hidden` —
// straddling from the inside is simply clipped. It is rendered inside the DRAG
// layer, though, so the meta flies with the card rather than hanging in the air
// behind it.
//
// Reading order: a screen reader now meets the headline first and the kind /
// project last. That is not a regression in what is CONVEYED — the deck
// announces "<kind>: <title>" the moment a card is dealt (see
// `TriageDeckVariant`'s deal utterance), which is earlier than either DOM
// position ever spoke.
import { memo } from 'react';

import type { TriageItem } from '../triageTypes';
import { Chip, KIND_META, kindCopy } from './DeckChips';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Whose card this is — project, persona or workspace — in the top-right corner.
 *
 * The label carries the colour dot the rest of the app uses for that entity, so
 * "which project am I in" is answered by a glance at one corner rather than by
 * finding PROJECT in a grid of six equal-weight facts.
 *
 * Opaque `bg-background` and a shadow, exactly like a metric badge: it sits ON
 * the card's 2px border, and a translucent surface would let that border draw a
 * line straight through the project name.
 */
export const SourceStampRail = memo(function SourceStampRail({
  source,
}: {
  source: TriageItem['source'];
}) {
  return (
    <div className="pointer-events-none absolute right-4 top-0 z-40 flex max-w-[55%] -translate-y-1/2 items-center gap-2 rounded-card border border-primary/20 bg-background px-2.5 py-1 shadow-elevation-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${source.color ? '' : 'bg-primary'}`}
        style={source.color ? { backgroundColor: source.color } : undefined}
        aria-hidden
      />
      <span className="min-w-0 text-right">
        <span className="typo-caption block truncate text-foreground">{source.label}</span>
        {source.sublabel ? (
          <span className="typo-label block truncate text-muted-foreground">{source.sublabel}</span>
        ) : null}
      </span>
    </div>
  );
});

/**
 * WHAT KIND of thing this is, along the bottom border.
 *
 * Each chip gets an opaque `bg-background` shell under it for the same reason
 * the stamp is opaque — the tone tints are translucent by design, and the card
 * border would otherwise run through every label.
 *
 * `overflow-hidden` rather than wrap: a rail that grows a second row is a rail
 * that has started eating the card again, which is the whole thing this file
 * exists to stop.
 */
export const KindChipRail = memo(function KindChipRail({ item }: { item: TriageItem }) {
  const { t } = useTranslation();
  const kind = KIND_META[item.kind];

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex translate-y-1/2 items-center gap-1.5 overflow-hidden px-4">
      <span className="rounded-pill bg-background">
        <Chip label={kindCopy(t, item.kind).one} tone={kind.tone} icon={kind.icon} />
      </span>
      {item.tags.map((tag) => (
        <span key={tag.id} className="rounded-pill bg-background">
          <Chip label={tag.label} tone={tag.tone} icon={tag.icon} />
        </span>
      ))}
    </div>
  );
});
