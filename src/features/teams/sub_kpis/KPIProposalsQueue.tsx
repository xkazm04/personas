// KPI proposals review queue — drains the scan's output. Each proposed KPI
// shows its rationale + measurement procedure; the user ACCEPTS it (optionally
// adjusting target value / date — the "volume"), or REJECTS it (archived, fed
// back to future scans as a negative example). Connector-parked proposals
// carry the "Connect <service>" CTA.
import { useMemo, useState } from 'react';
import { Cable, Check, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { Numeric } from '@/features/shared/components/display/Numeric';

export function KPIProposalsQueue({ onRefresh }: { onRefresh: () => void }) {
  const { t, tx } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const proposals = useMemo(() => kpis.filter((k) => k.status === 'proposed'), [kpis]);
  // Per-proposal target adjustments (the "volume"), keyed by KPI id.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});

  if (proposals.length === 0) {
    return (
      <EmptyState
        title={t.kpis.queue_empty_title}
        description={t.kpis.queue_empty_hint}
        action={{ label: t.kpis.queue_refresh, onClick: onRefresh }}
      />
    );
  }

  const accept = async (kpi: DevKpi) => {
    const rawTarget = targets[kpi.id];
    const rawDate = dates[kpi.id];
    const adjusted = rawTarget != null && rawTarget !== '' ? Number(rawTarget) : undefined;
    try {
      await updateKpi(kpi.id, {
        status: 'active',
        ...(adjusted != null && Number.isFinite(adjusted) ? { targetValue: adjusted } : {}),
        ...(rawDate ? { targetDate: rawDate } : {}),
      });
    } catch (err) {
      toastCatch('kpi accept', t.kpis.accept_failed)(err);
    }
  };

  const reject = async (kpi: DevKpi) => {
    try {
      await updateKpi(kpi.id, { status: 'archived' });
    } catch (err) {
      toastCatch('kpi reject', t.kpis.reject_failed)(err);
    }
  };

  return (
    <div className="space-y-3" data-testid="kpi-proposals-queue">
      {proposals.map((kpi) => (
        <div
          key={kpi.id}
          className="rounded-card border border-primary/15 bg-secondary/20 p-4 space-y-2"
          data-testid={`kpi-proposal-${kpi.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="typo-heading text-foreground">{kpi.name}</span>
                <span className="typo-caption text-foreground uppercase">{kpi.category}</span>
                <span className="typo-caption text-foreground">· {kpi.measure_kind}</span>
                {kpi.cadence !== 'manual' && (
                  <span className="typo-caption text-foreground">· {kpi.cadence}</span>
                )}
              </div>
              {kpi.rationale && (
                <p className="mt-1 typo-body text-foreground">{kpi.rationale}</p>
              )}
              {kpi.description && (
                <p className="mt-1 typo-caption text-foreground">{kpi.description}</p>
              )}
              <p className="mt-1 typo-caption text-foreground font-mono break-all">
                {kpi.measure_config}
              </p>
              {kpi.needed_connector && (
                <button
                  type="button"
                  onClick={() => setSidebarSection('credentials')}
                  className="mt-1 inline-flex items-center gap-1 typo-caption text-primary hover:underline"
                  data-testid={`kpi-proposal-connect-${kpi.id}`}
                >
                  <Cable className="w-3 h-3" />
                  {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
                </button>
              )}
            </div>
            {kpi.baseline_value != null && (
              <div className="typo-caption text-foreground whitespace-nowrap tabular-nums">
                {t.kpis.baseline_label}: <Numeric value={kpi.baseline_value} /> {kpi.unit}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 flex-wrap pt-1 border-t border-primary/10">
            <label className="flex flex-col gap-0.5 typo-caption text-foreground">
              {tx(t.kpis.target_label, { unit: kpi.unit || '—' })}
              <input
                type="number"
                defaultValue={kpi.target_value ?? undefined}
                onChange={(e) => setTargets((m) => ({ ...m, [kpi.id]: e.target.value }))}
                className="w-28 rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground tabular-nums"
                data-testid={`kpi-target-input-${kpi.id}`}
              />
            </label>
            <label className="flex flex-col gap-0.5 typo-caption text-foreground">
              {t.kpis.target_date_label}
              <input
                type="date"
                defaultValue={kpi.target_date?.slice(0, 10) ?? undefined}
                onChange={(e) => setDates((m) => ({ ...m, [kpi.id]: e.target.value }))}
                className="rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground"
              />
            </label>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" icon={<X className="w-3.5 h-3.5" />} onClick={() => void reject(kpi)} data-testid={`kpi-reject-${kpi.id}`}>
              {t.kpis.reject_button}
            </Button>
            <AsyncButton size="sm" variant="primary" icon={<Check className="w-3.5 h-3.5" />} onClick={() => accept(kpi)} data-testid={`kpi-accept-${kpi.id}`}>
              {t.kpis.accept_button}
            </AsyncButton>
          </div>
        </div>
      ))}
    </div>
  );
}
