/**
 * Corner status indicators for a Quick-Navigation card.
 *
 * Each metric renders as one large, dominant, semi-transparent number with its
 * type-icon (and trend arrow, when present) at roughly half the number's size
 * arranged around it. One number per corner:
 *   - 1 metric  → top-right
 *   - 2 metrics → first top-right, second top-left
 * (Cards with more than two metrics — only Overview — show their two highest
 * priority; the corner model is intentionally limited to the two top corners.)
 *
 * Data comes from {@link useNavCardStatus}; this component is presentational.
 */
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { NavChipTone, NavStatChip, NavTrend } from './lib/useNavCardStatus';

// Static literals so Tailwind's JIT keeps them. The number is intentionally
// low-opacity (dominant but semi-transparent); the icons sit a touch stronger.
const TONE_NUM: Record<NavChipTone, string> = {
  red: 'text-red-400/45',
  amber: 'text-amber-400/45',
  blue: 'text-blue-400/45',
  emerald: 'text-emerald-400/45',
  cyan: 'text-cyan-400/45',
  sky: 'text-sky-400/45',
  slate: 'text-slate-300/45',
};
const TONE_ICON: Record<NavChipTone, string> = {
  red: 'text-red-400/80',
  amber: 'text-amber-400/80',
  blue: 'text-blue-400/80',
  emerald: 'text-emerald-400/80',
  cyan: 'text-cyan-400/80',
  sky: 'text-sky-400/80',
  slate: 'text-slate-300/80',
};

const TREND_ICON: Record<NavTrend, typeof ArrowUp> = { up: ArrowUp, down: ArrowDown, flat: Minus };
const TREND_COLOR: Record<NavTrend, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-foreground/40',
};

// Slot 0 → top-right, slot 1 → top-left.
const SLOT_POS = ['top-2.5 right-3', 'top-2.5 left-3'] as const;

function StatBadge({ chip, slot }: { chip: NavStatChip; slot: 0 | 1 }) {
  const Icon = chip.icon;
  const Trend = chip.trend ? TREND_ICON[chip.trend] : null;
  const alignRight = slot === 0;
  return (
    <div className={`pointer-events-none absolute z-20 ${SLOT_POS[slot]}`}>
      <Tooltip content={chip.title} placement={alignRight ? 'left' : 'right'} delay={300}>
        <div
          className={`pointer-events-auto flex flex-col gap-0.5 ${alignRight ? 'items-end' : 'items-start'}`}
          aria-label={chip.title}
        >
          {/* Icons at ~half the number's size, around it. */}
          <div className={`flex items-center gap-1 ${TONE_ICON[chip.tone]}`}>
            <Icon className="h-5 w-5" aria-hidden />
            {Trend && <Trend className={`h-5 w-5 ${TREND_COLOR[chip.trend!]}`} aria-hidden />}
          </div>
          {/* Dominant, semi-transparent number. */}
          <span className={`typo-hero font-black leading-none tabular-nums ${TONE_NUM[chip.tone]}`}>
            {chip.value}
          </span>
        </div>
      </Tooltip>
    </div>
  );
}

export default function NavStatChips({ chips }: { chips: NavStatChip[] }) {
  if (chips.length === 0) return null;
  // Two top corners only — first metric top-right, second top-left.
  return (
    <>
      {chips.slice(0, 2).map((chip, i) => (
        <StatBadge key={chip.key} chip={chip} slot={i as 0 | 1} />
      ))}
    </>
  );
}
