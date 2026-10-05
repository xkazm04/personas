// TileParts — the drawn quantities inside a tile. Each one is a figure, not a
// sentence: the reason a persona needs you is a glyph, the last ten runs are
// ten coloured cells, the day is twenty-four bars. Their words live in the
// tile's accessible name and in the hover card.

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { HEALTH_TONE_CLASS, healthSegments, type PersonaCardModel } from '../monitorModel';
import { dominantBadge } from '../grid/fleetGridModel';
import { PILE_VISUAL, needTone } from './piles';

const GLYPH_CLASS = { sm: 'fb-glyph', md: 'fb-glyph-md', lg: 'fb-glyph-lg' } as const;

/**
 * Why this persona needs you, as one glyph, with the queue depth beside it when
 * there is a queue (a failure is a state and has none). A small tile has room
 * for the glyph alone, sized to the tile.
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

/** The last ten outcomes, oldest left, in the Monitor's own health-bar tones. */
export const RunStrip = memo(function RunStrip({ card }: { card: PersonaCardModel }) {
  return (
    <span className="fb-runs" aria-hidden>
      {healthSegments(card, 10).map((tone, i) => <i key={i} className={HEALTH_TONE_CLASS[tone]} />)}
    </span>
  );
});

/** Runs per hour over the last day, one bar per hour, scaled to the busiest hour. */
export const Sparkline = memo(function Sparkline({ buckets }: { buckets: readonly number[] }) {
  const peak = Math.max(1, ...buckets);
  return (
    <span className="fb-spark" aria-hidden>
      {buckets.map((n, i) => <i key={i} style={{ height: `${Math.max(8, (n / peak) * 100)}%`, opacity: n > 0 ? 0.85 : 0.25 }} />)}
    </span>
  );
});

/** Success rate as a filled bar beside its figure; nothing to draw without runs. */
export function SuccessBar({ rate }: { rate: number | null }) {
  const { t } = useTranslation();
  if (rate === null) return <span className="typo-label">{t.monitor.board_no_runs}</span>;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Numeric value={rate} unit="ratio" precision={0} className="typo-data" />
      <span className="fb-bar"><span style={{ width: `${rate * 100}%` }} /></span>
    </span>
  );
}
