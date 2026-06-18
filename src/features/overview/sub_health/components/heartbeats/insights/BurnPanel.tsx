import { useMemo } from 'react';
import { DollarSign, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { InsightPanel } from './InsightPanel';
import { buildBurn } from './data';

export function BurnPanel({ signals }: { signals: PersonaHealthSignal[] }) {
  const { t, tx } = useTranslation();
  const be = t.overview.burn_rate_extra;
  const b = useMemo(() => buildBurn(signals), [signals]);

  return (
    <InsightPanel icon={DollarSign} accent="success" title={be.title} subtitle={tx(be.active_personas_subtitle, { count: b.activeCount })}>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatTile label={be.daily_burn} value={`$${b.totalDailyBurn.toFixed(2)}`} tone="text-status-success" />
        <StatTile label={be.projected_monthly} value={`$${b.totalProjectedMonthly.toFixed(2)}`} tone="text-foreground/90" />
        <StatTile label={be.at_risk} value={String(b.atRisk.length)} tone={b.atRisk.length > 0 ? 'text-status-error' : 'text-status-success'} />
      </div>

      {b.topBurners.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="typo-caption text-foreground">{be.top_cost_drivers}</p>
          {b.topBurners.map(s => <BurnBar key={s.personaId} signal={s} max={b.topBurners[0]!.dailyBurnRate} />)}
        </div>
      )}

      {b.atRisk.length > 0 && (
        <div className="mt-3 p-2.5 rounded-card border border-status-error/20 bg-status-error/5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-status-error" />
            <span className="typo-caption text-status-error">{be.budget_exhaustion_warnings}</span>
          </div>
          <div className="flex flex-col gap-1">
            {b.atRisk.map(s => (
              <div key={s.personaId} className="flex items-center justify-between gap-2 typo-caption">
                <span className="inline-flex items-center gap-1.5 text-foreground truncate min-w-0">
                  <PersonaIcon icon={s.personaIcon} color={s.personaColor} display="framed" frameSize="xs" />
                  <span className="truncate">{s.personaName}</span>
                </span>
                <span className="text-status-error font-semibold shrink-0 tabular-nums">
                  {s.projectedExhaustionDays === 0 ? be.exhausted : `${s.projectedExhaustionDays}d`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </InsightPanel>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="px-2.5 py-2 rounded-card bg-secondary/40">
      <p className="typo-label text-foreground leading-tight">{label}</p>
      <p className={`typo-heading-lg tabular-nums ${tone} mt-1`}>{value}</p>
    </div>
  );
}

function BurnBar({ signal, max }: { signal: PersonaHealthSignal; max: number }) {
  const pct = max > 0 ? (signal.dailyBurnRate / max) * 100 : 0;
  const tone = signal.budgetRatio > 0.8 ? 'bg-status-error' : signal.budgetRatio > 0.5 ? 'bg-status-warning' : 'bg-status-success';
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 w-28 shrink-0 typo-caption text-foreground min-w-0">
        <PersonaIcon icon={signal.personaIcon} color={signal.personaColor} display="framed" frameSize="xs" />
        <span className="truncate">{signal.personaName}</span>
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="typo-data tabular-nums text-foreground w-14 text-right">${signal.dailyBurnRate.toFixed(2)}</span>
    </div>
  );
}
