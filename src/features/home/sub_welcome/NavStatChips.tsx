/**
 * The live figures at the foot of a Quick-Navigation card: each metric is its type icon in the
 * metric's tone, the figure, and a trend arrow when there is one. What a figure counts is the
 * chip's title, carried by the kit's Hint (a tip on hover plus a description a reader hears),
 * so the number is never unexplained. A card shows its two highest-priority metrics.
 *
 * Data comes from {@link useNavCardStatus}; this component is presentational.
 */
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Hint } from '@/features/shared/components/kit';
import type { NavStatChip, NavTrend } from './lib/useNavCardStatus';

const TREND_ICON: Record<NavTrend, typeof ArrowUp> = { up: ArrowUp, down: ArrowDown, flat: Minus };
const TREND_TONE: Record<NavTrend, string> = { up: 't-success', down: 't-error', flat: 't-neutral' };

function NavFigure({ chip }: { chip: NavStatChip }) {
  const Icon = chip.icon;
  const Trend = chip.trend ? TREND_ICON[chip.trend] : null;
  return (
    <Hint content={chip.title}>
      <span className="inline-flex items-center gap-1.5">
        <Icon className={`w-4 h-4 k-toned t-${chip.tone}`} aria-hidden />
        <span className="typo-data-lg k-medium">{chip.value}</span>
        {Trend && <Trend className={`w-3.5 h-3.5 k-toned ${TREND_TONE[chip.trend!]}`} aria-hidden />}
      </span>
    </Hint>
  );
}

export default function NavStatChips({ chips }: { chips: NavStatChip[] }) {
  if (chips.length === 0) return null;
  return (
    <>
      {chips.slice(0, 2).map((chip) => <NavFigure key={chip.key} chip={chip} />)}
    </>
  );
}
