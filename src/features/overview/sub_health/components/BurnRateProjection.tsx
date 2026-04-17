import { useMemo } from 'react';
import { DollarSign, AlertTriangle } from 'lucide-react';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { useTranslation } from '@/i18n/useTranslation';

interface BurnRateProjectionProps {
  signals: PersonaHealthSignal[];
}

export function BurnRateProjection({ signals }: BurnRateProjectionProps) {
  const { t, tx } = useTranslation();
  const projections = useMemo(() => {
    const active = signals.filter(s => s.totalExecutions > 0);
    const totalDailyBurn = active.reduce((sum, s) => sum + s.dailyBurnRate, 0);
    const totalProjectedMonthly = active.reduce((sum, s) => sum + s.projectedMonthlyCost, 0);
    const atRisk = active.filter(s => s.projectedExhaustionDays !== null && s.projectedExhaustionDays <= 7);
    const topBurners = [...active].sort((a, b) => b.dailyBurnRate - a.dailyBurnRate).slice(0, 5);

    return { totalDailyBurn, totalProjectedMonthly, atRisk, topBurners, activeCount: active.length };
  }, [signals]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <DollarSign className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h3 className="typo-heading text-foreground/90">{t.overview.burn_rate_extra.title}</h3>
          <p className="typo-caption text-foreground">
            {tx(t.overview.burn_rate_extra.active_personas_subtitle, { count: projections.activeCount })}
          </p>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="px-3 py-2 rounded-card bg-secondary/40">
          <p className="text-[10px] text-foreground uppercase tracking-wider">{t.overview.burn_rate_extra.daily_burn}</p>
          <p className="typo-heading-lg text-emerald-400">${projections.totalDailyBurn.toFixed(2)}</p>
        </div>
        <div className="px-3 py-2 rounded-card bg-secondary/40">
          <p className="text-[10px] text-foreground uppercase tracking-wider">{t.overview.burn_rate_extra.projected_monthly}</p>
          <p className="typo-heading-lg text-foreground/90">${projections.totalProjectedMonthly.toFixed(2)}</p>
        </div>
        <div className="px-3 py-2 rounded-card bg-secondary/40">
          <p className="text-[10px] text-foreground uppercase tracking-wider">{t.overview.burn_rate_extra.at_risk}</p>
          <p className={`typo-heading-lg ${projections.atRisk.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {projections.atRisk.length}
          </p>
        </div>
      </div>

      {/* Top burners */}
      {projections.topBurners.length > 0 && (
        <div className="space-y-1.5">
          <p className="typo-caption text-foreground mb-2">{t.overview.burn_rate_extra.top_cost_drivers}</p>
          {projections.topBurners.map((s) => (
            <BurnBar key={s.personaId} signal={s} maxBurn={projections.topBurners[0]!.dailyBurnRate} />
          ))}
        </div>
      )}

      {/* At-risk warnings */}
      {projections.atRisk.length > 0 && (
        <div className="mt-4 p-3 rounded-card border border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span className="typo-caption text-red-400">{t.overview.burn_rate_extra.budget_exhaustion_warnings}</span>
          </div>
          <div className="space-y-1">
            {projections.atRisk.map((s) => (
              <div key={s.personaId} className="flex items-center justify-between typo-caption">
                <span className="text-foreground truncate">
                  {s.personaIcon && <span className="mr-1">{s.personaIcon}</span>}
                  {s.personaName}
                </span>
                <span className="text-red-400 font-semibold flex-shrink-0 ml-2">
                  {s.projectedExhaustionDays === 0 ? t.overview.burn_rate_extra.exhausted : `${s.projectedExhaustionDays}d left`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BurnBar({ signal, maxBurn }: { signal: PersonaHealthSignal; maxBurn: number }) {
  const pct = maxBurn > 0 ? (signal.dailyBurnRate / maxBurn) * 100 : 0;
  const barColor = signal.budgetRatio > 0.8 ? 'bg-red-400' : signal.budgetRatio > 0.5 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 truncate typo-caption text-foreground">
        {signal.personaIcon && <span className="mr-1">{signal.personaIcon}</span>}
        {signal.personaName}
      </div>
      <div className="flex-1 h-2 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="typo-code font-mono text-foreground w-16 text-right">${signal.dailyBurnRate.toFixed(2)}/d</span>
    </div>
  );
}
