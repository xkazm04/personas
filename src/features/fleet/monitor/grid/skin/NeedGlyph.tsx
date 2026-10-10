// NeedGlyph — why a persona needs you, as one figure rather than a sentence.
//
// RELOCATED 2026-10-06 from `fleetboard/TileParts.tsx`. Its three siblings
// there (`RunStrip`, `Sparkline`, `SuccessBar`) drew the Board's large tile
// and had no other consumer, so they went with it; this one is worn by
// Activity's persona line, which is why it survives here beside the pile
// vocabulary it reads.

import { Numeric } from '@/features/shared/components/display/Numeric';
import type { PersonaCardModel } from '../../monitorModel';
import { dominantBadge } from '../fleetGridModel';
import { PILE_VISUAL, needTone } from './piles';

const GLYPH_CLASS = { sm: 'fb-glyph', md: 'fb-glyph-md', lg: 'fb-glyph-lg' } as const;

/**
 * Why this persona needs you, as one glyph, with the queue depth beside it when
 * there is a queue (a failure is a state and has none). The smallest size has
 * room for the glyph alone.
 */
export function NeedGlyph({ card, size }: { card: PersonaCardModel; size: keyof typeof GLYPH_CLASS }) {
  const badge = dominantBadge(card);
  const Icon = badge?.icon ?? PILE_VISUAL[needTone(card)].glyph;
  const count = size !== 'sm' && badge && badge.count > 0 ? badge.count : null;
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1">
      {count !== null && (
        <Numeric value={count} unit="count" className={size === 'lg' ? 'typo-data-lg leading-none' : 'typo-heading'} />
      )}
      <Icon className={GLYPH_CLASS[size]} aria-hidden />
    </span>
  );
}
