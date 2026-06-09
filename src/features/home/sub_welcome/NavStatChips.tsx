/**
 * Corner status chips overlaid on a Quick-Navigation card — a compact
 * "number + type-icon + tone (+ trend arrow)" pill per metric. Data comes from
 * {@link useNavCardStatus}; this component is purely presentational.
 */
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { NavChipTone, NavStatChip, NavTrend } from './lib/useNavCardStatus';

// Static class strings (no dynamic construction) so Tailwind's JIT keeps them.
const TONE: Record<NavChipTone, string> = {
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  sky: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  slate: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
};

const TREND_ICON: Record<NavTrend, typeof ArrowUp> = { up: ArrowUp, down: ArrowDown, flat: Minus };
const TREND_COLOR: Record<NavTrend, string> = {
  up: 'text-emerald-400',
  down: 'text-rose-400',
  flat: 'text-foreground/50',
};

export default function NavStatChips({ chips }: { chips: NavStatChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-1.5 pr-10">
      {chips.map((chip) => {
        const Icon = chip.icon;
        const Trend = chip.trend ? TREND_ICON[chip.trend] : null;
        return (
          <Tooltip key={chip.key} content={chip.title} placement="top" delay={300}>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 typo-caption font-semibold backdrop-blur-sm ${TONE[chip.tone]}`}
              aria-label={chip.title}
            >
              <Icon className="h-3 w-3" aria-hidden />
              <span className="tabular-nums">{chip.value}</span>
              {Trend && <Trend className={`h-3 w-3 ${TREND_COLOR[chip.trend!]}`} aria-hidden />}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
