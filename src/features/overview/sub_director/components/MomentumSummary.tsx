import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { momentumCounts, MOMENTUM_ORDER, MOMENTUM_TONE, type Momentum } from '../momentum';
import type { DirectorRosterEntry } from '@/api/director';

const ICON: Record<Momentum, LucideIcon> = {
  improving: TrendingUp,
  flat: Minus,
  declining: TrendingDown,
};

/**
 * Portfolio momentum readout — how many agents improved, held, or slipped
 * versus their previous review. The "is the fleet getting better?" headline,
 * derived entirely from the roster's score trends. Display-only here; the
 * campaign's filter step makes the buckets click-to-filter.
 */
export function MomentumSummary({ roster }: { roster: DirectorRosterEntry[] }) {
  const { t } = useTranslation();
  const counts = momentumCounts(roster);
  const present = MOMENTUM_ORDER.filter((m) => counts[m] > 0);
  if (present.length === 0) return null;

  const LABEL: Record<Momentum, string> = {
    improving: t.director.momentum_improving,
    flat: t.director.momentum_flat,
    declining: t.director.momentum_declining,
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
      <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.momentum_label}</span>
      {present.map((m) => {
        const Icon = ICON[m];
        return (
          <span key={m} className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: MOMENTUM_TONE[m] }} />
            <Numeric value={counts[m]} className="font-semibold tabular-nums" />
            {LABEL[m]}
          </span>
        );
      })}
    </div>
  );
}
