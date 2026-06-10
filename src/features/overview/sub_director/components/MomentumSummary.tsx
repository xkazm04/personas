import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { momentumCounts, MOMENTUM_ORDER, MOMENTUM_TONE, type Momentum } from '../momentum';
import { toggleFilter, type RosterFilter } from '../rosterFilter';
import type { DirectorRosterEntry } from '@/api/director';

const ICON: Record<Momentum, LucideIcon> = {
  improving: TrendingUp,
  flat: Minus,
  declining: TrendingDown,
};

/**
 * Portfolio momentum readout — how many agents improved, held, or slipped
 * versus their previous review. The "is the fleet getting better?" headline,
 * derived entirely from the roster's score trends. Each bucket is a one-click
 * filter on the coaching table (re-click to clear); the active bucket reads as
 * pressed.
 */
export function MomentumSummary({
  roster,
  filter,
  onSelect,
}: {
  roster: DirectorRosterEntry[];
  filter: RosterFilter | null;
  onSelect: (filter: RosterFilter | null) => void;
}) {
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1">
      <span className="typo-caption uppercase tracking-wider text-foreground">{t.director.momentum_label}</span>
      {present.map((m) => {
        const Icon = ICON[m];
        const active = filter?.type === 'momentum' && filter.momentum === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onSelect(toggleFilter(filter, { type: 'momentum', momentum: m }))}
            aria-pressed={active}
            title={t.director.triage_chip_hint}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-pill typo-caption text-foreground transition-shadow focus-ring"
            style={{
              backgroundColor: active ? `color-mix(in oklab, ${MOMENTUM_TONE[m]} 16%, transparent)` : undefined,
              boxShadow: active ? `inset 0 0 0 1px ${MOMENTUM_TONE[m]}` : undefined,
            }}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: MOMENTUM_TONE[m] }} />
            <Numeric value={counts[m]} className="font-semibold tabular-nums" />
            {LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}
