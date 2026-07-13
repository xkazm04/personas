import { useEffect, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { silentCatch } from '@/lib/silentCatch';
import {
  getHealingEffectiveness,
  listHealingAuditLog,
  type HealingEffectivenessReport,
} from '@/api/overview/healing';
import type { HealingAuditEntry } from '@/lib/bindings/HealingAuditEntry';

// ---------------------------------------------------------------------------
// Self-healing effectiveness — a compact Health-tab surface showing how often
// auto-fixes actually held (confirm vs revert rates, overall + per category)
// plus the most recent healing activity. Fed by the durable healing_audit_log
// effectiveness ledger (see repos/execution/healing.rs). Kept additive so it
// slots below the Vitals Ledger without touching the insight panels.
// ---------------------------------------------------------------------------

const ACTIVITY_LIMIT = 6;

function rateColor(rate: number): string {
  if (rate >= 0.7) return 'text-emerald-400';
  if (rate >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}

function rateBarColor(rate: number): string {
  if (rate >= 0.7) return 'bg-emerald-500/70';
  if (rate >= 0.4) return 'bg-amber-500/70';
  return 'bg-red-500/70';
}

export function HealingEffectivenessPanel() {
  const { t } = useTranslation();
  const te = t.overview.healing_effectiveness;
  const [report, setReport] = useState<HealingEffectivenessReport | null>(null);
  const [activity, setActivity] = useState<HealingAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getHealingEffectiveness(), listHealingAuditLog(undefined, ACTIVITY_LIMIT)])
      .then(([r, a]) => {
        if (!alive) return;
        setReport(r);
        setActivity(a);
      })
      .catch(silentCatch('healing-effectiveness-load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const pct = (rate: number) => `${Math.round(rate * 100)}%`;

  return (
    <section className="rounded-card border border-primary/10 bg-secondary/20 p-4">
      <header className="flex items-center gap-2 mb-3">
        <HeartPulse className="w-4 h-4 text-rose-400" />
        <h3 className="typo-body font-medium text-foreground/90">{te.title}</h3>
        {report && (
          <span className="typo-caption text-foreground ml-auto">
            {te.window_label} {report.window_days}d
          </span>
        )}
      </header>

      {loading ? (
        <LoadingSpinner label={te.loading} />
      ) : !report || report.attempted === 0 ? (
        <p className="typo-caption text-foreground py-4 text-center">{te.no_data}</p>
      ) : (
        <div className="space-y-4">
          {/* Overall */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className={`typo-h3 font-semibold ${rateColor(report.success_rate)}`}>
                {pct(report.success_rate)}
              </span>
              <span className="typo-caption text-foreground">{te.success_rate}</span>
            </div>
            <div className="flex items-center gap-3 typo-caption ml-auto">
              <Stat label={te.confirmed} value={report.confirmed} className="text-emerald-400" />
              <Stat label={te.reverted} value={report.reverted} className="text-red-400" />
              <Stat label={te.attempted} value={report.attempted} className="text-foreground/90" />
            </div>
          </div>

          {/* Per-category breakdown */}
          {report.by_category.length > 0 && (
            <ul className="space-y-1.5">
              {report.by_category.slice(0, 4).map((row) => (
                <li key={row.category} className="flex items-center gap-2 typo-caption">
                  <span className="w-24 shrink-0 truncate text-foreground/90">
                    {tokenLabel(t, 'healing_category', row.category)}
                  </span>
                  <span className="flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden">
                    <span
                      className={`block h-full ${rateBarColor(row.success_rate)}`}
                      style={{ width: `${Math.round(row.success_rate * 100)}%` }}
                    />
                  </span>
                  <span className={`w-9 text-right tabular-nums ${rateColor(row.success_rate)}`}>
                    {pct(row.success_rate)}
                  </span>
                  <span className="w-16 text-right text-foreground tabular-nums">
                    <Numeric value={row.confirmed} />/<Numeric value={row.attempted} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Recent activity */}
          {activity.length > 0 && (
            <div>
              <h4 className="typo-caption text-foreground mb-1.5">{te.recent_activity}</h4>
              <ul className="space-y-1">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 typo-caption">
                    <span className="flex-1 truncate text-foreground">{entry.message}</span>
                    <RelativeTime
                      timestamp={entry.createdAt}
                      className="shrink-0 text-foreground tabular-nums"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`font-medium tabular-nums ${className}`}>
        <Numeric value={value} />
      </span>
      <span className="text-foreground">{label}</span>
    </span>
  );
}
