// KPI detail drawer — measurement history (sparkline + list with evidence),
// manual value entry, pause/resume + archive. Compact right-hand drawer
// matching the GoalDetailDrawer interaction model.
import { useEffect, useState } from 'react';
import { Archive, Pause, Play, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { kpiTrack, sparklinePoints } from './kpiMath';

export function KPIDetailDrawer({ kpi, onClose }: { kpi: DevKpi; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const measurements = useSystemStore((s) => s.kpiMeasurements);
  const fetchKpiMeasurements = useSystemStore((s) => s.fetchKpiMeasurements);
  const recordKpiMeasurement = useSystemStore((s) => s.recordKpiMeasurement);
  const updateKpi = useSystemStore((s) => s.updateKpi);
  const evaluateKpi = useSystemStore((s) => s.evaluateKpi);

  const [manualValue, setManualValue] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    void fetchKpiMeasurements(kpi.id);
  }, [kpi.id, fetchKpiMeasurements]);

  const track = kpiTrack(kpi);
  const points = sparklinePoints(measurements);

  const submitManual = async () => {
    const v = Number(manualValue);
    if (!Number.isFinite(v)) return;
    try {
      await recordKpiMeasurement(kpi.id, v);
      setManualValue('');
    } catch (err) {
      toastCatch('kpi measure', t.kpis.measure_failed)(err);
    }
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-40 w-full max-w-[26rem] bg-background border-l border-primary/15 shadow-elevation-3 flex flex-col"
      role="dialog"
      aria-label={kpi.name}
      data-testid="kpi-detail-drawer"
    >
      <div className="flex items-start justify-between gap-2 p-4 border-b border-primary/10">
        <div className="min-w-0">
          <h2 className="typo-heading text-foreground">{kpi.name}</h2>
          <p className="typo-caption text-foreground">
            {kpi.category} · {kpi.measure_kind} · {kpi.cadence}
          </p>
        </div>
        <Button size="sm" variant="ghost" icon={<X className="w-4 h-4" />} onClick={onClose} aria-label={t.common.close} />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="rounded-card border border-primary/15 bg-secondary/20 p-3 space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="typo-title text-foreground tabular-nums">
              {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
            </span>
            {kpi.target_value != null && (
              <span className="typo-body text-foreground tabular-nums">
                / <Numeric value={kpi.target_value} /> {kpi.unit}
              </span>
            )}
          </div>
          <p className="typo-caption text-foreground">
            {track === 'met'
              ? t.kpis.track_met
              : track === 'off-track'
                ? t.kpis.track_off
                : track === 'unmeasured'
                  ? t.kpis.track_unmeasured
                  : t.kpis.track_on}
            {kpi.target_date ? ` · ${tx(t.kpis.due_by, { date: kpi.target_date.slice(0, 10) })}` : ''}
          </p>
          {points && (
            <svg viewBox="0 0 96 24" className="w-full h-6 text-primary" aria-hidden>
              <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </div>

        {kpi.description && <p className="typo-body text-foreground">{kpi.description}</p>}
        <p className="typo-caption text-foreground font-mono break-all">{kpi.measure_config}</p>

        {(kpi.measure_kind === 'codebase' || kpi.measure_kind === 'derived') && (
          <AsyncButton
            size="sm"
            variant="secondary"
            onClick={() => evaluateKpi(kpi.id).catch(toastCatch('kpi evaluate', t.kpis.evaluate_failed))}
            loadingText={t.kpis.measuring}
            data-testid="kpi-measure-now"
          >
            {t.kpis.measure_now}
          </AsyncButton>
        )}

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-0.5 typo-caption text-foreground flex-1">
            {tx(t.kpis.manual_entry_label, { unit: kpi.unit || '—' })}
            <input
              type="number"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground tabular-nums"
              data-testid="kpi-manual-value-input"
            />
          </label>
          <AsyncButton size="sm" variant="secondary" onClick={submitManual} disabled={manualValue === ''} data-testid="kpi-manual-record">
            {t.kpis.record_button}
          </AsyncButton>
        </div>

        <div>
          <h3 className="typo-caption text-foreground uppercase mb-1">{t.kpis.history_title}</h3>
          {measurements.length === 0 ? (
            <p className="typo-caption text-foreground">{t.kpis.history_empty}</p>
          ) : (
            <ul className="space-y-1">
              {measurements.map((m) => (
                <li key={m.id} className="flex items-center gap-2 typo-body text-foreground">
                  <span className="tabular-nums">
                    <Numeric value={m.value} /> {kpi.unit}
                  </span>
                  <span className="typo-caption text-foreground">
                    {m.source} · <RelativeTime timestamp={m.measured_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 p-4 border-t border-primary/10">
        {kpi.status === 'paused' ? (
          <AsyncButton size="sm" variant="secondary" icon={<Play className="w-3.5 h-3.5" />} onClick={() => updateKpi(kpi.id, { status: 'active' })}>
            {t.kpis.resume_button}
          </AsyncButton>
        ) : (
          <AsyncButton size="sm" variant="secondary" icon={<Pause className="w-3.5 h-3.5" />} onClick={() => updateKpi(kpi.id, { status: 'paused' })}>
            {t.kpis.pause_button}
          </AsyncButton>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={<Archive className="w-3.5 h-3.5" />} onClick={() => setConfirmArchive(true)} data-testid="kpi-archive">
          {t.kpis.archive_button}
        </Button>
      </div>

      {confirmArchive && (
        <ConfirmDialog
          title={t.kpis.archive_confirm_title}
          body={t.kpis.archive_confirm_body}
          confirmLabel={t.kpis.archive_button}
          danger
          onConfirm={() => {
            void updateKpi(kpi.id, { status: 'archived' })
              .then(() => {
                setConfirmArchive(false);
                onClose();
              })
              .catch(toastCatch('kpi archive', t.kpis.archive_failed));
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </div>
  );
}
