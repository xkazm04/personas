// KpiDetailModal — the full-screen KPI detail surface that replaces the old
// right-edge KPIDetailDrawer. Two directional layouts behind one `variant` prop
// (prototype): 'triage' (a stacked incident "case file", max-w-4xl) and
// 'cockpit' (a wide two-column data console, max-w-6xl). Both reuse the shared
// data hook + the drawer's story-chart / steering / source pieces, so the only
// thing that differs is arrangement.
import { useMemo, useState } from 'react';
import { Archive, Cable, Gauge, Pause, Play, ShieldAlert } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { paceDescriptor } from './kpiMath';
import { categoryMeta, kindMeta, cadenceMeta, TRACK_COLOR } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';
import { summarizeEvidence } from './kpiMeasurementProvenance';
import { KpiStoryChart, KpiSourceSection } from './KPIDetailDrawer';
import { KpiSteeringPanel } from './KpiSteeringPanel';
import { KPIConnectWizard } from './KPIConnectWizard';
import { useKpiDetail } from './useKpiDetail';

export type KpiModalVariant = 'triage' | 'cockpit';

const TITLE_ID = 'kpi-detail-modal-title';

export function KpiDetailModal({
  kpi,
  variant,
  onClose,
}: {
  kpi: DevKpi;
  variant: KpiModalVariant;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const projects = useSystemStore((s) => s.projects);
  const detail = useKpiDetail(kpi);
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const projectName = useMemo(
    () => projects.find((p) => p.id === kpi.project_id)?.name ?? '—',
    [projects, kpi.project_id],
  );

  const wide = variant === 'cockpit';

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      staggerChildren={false}
      maxWidthClass={wide ? 'max-w-6xl' : 'max-w-4xl'}
      panelClassName="relative w-full h-[85vh] glass-md rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col"
    >
      <ModalHeader kpi={kpi} projectName={projectName} onClose={onClose} />

      <div className="flex-1 overflow-y-auto p-5">
        {wide ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-5">
              <HeroBlock kpi={kpi} />
              <Panel title={t.kpis.chart_trend_title} icon={Gauge}>
                <KpiStoryChart kpi={kpi} measurements={detail.measurements} linkedGoals={detail.linkedGoals} />
              </Panel>
              <HistoryBlock kpi={kpi} measurements={detail.measurements} />
            </div>
            <div className="space-y-5">
              <KpiSteeringPanel kpi={kpi} linkedGoals={detail.linkedGoals} measurements={detail.measurements} />
              <HowMeasured kpi={kpi} />
              <KpiSourceSection kpi={kpi} bindings={detail.bindings} onConnect={() => setConnectOpen(true)} />
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-5">
            <HeroBlock kpi={kpi} />
            <Panel title={t.kpis.chart_trend_title} icon={Gauge}>
              <KpiStoryChart kpi={kpi} measurements={detail.measurements} linkedGoals={detail.linkedGoals} />
            </Panel>
            <KpiSteeringPanel kpi={kpi} linkedGoals={detail.linkedGoals} measurements={detail.measurements} />
            <HowMeasured kpi={kpi} />
            <KpiSourceSection kpi={kpi} bindings={detail.bindings} onConnect={() => setConnectOpen(true)} />
            <HistoryBlock kpi={kpi} measurements={detail.measurements} />
          </div>
        )}
      </div>

      <ActionBar
        kpi={kpi}
        onMeasureNow={detail.measureNow}
        onRecordManual={detail.recordManual}
        onSetStatus={detail.setStatus}
        onArchive={() => setConfirmArchive(true)}
      />

      {connectOpen && (
        <KPIConnectWizard
          kpi={kpi}
          onClose={() => setConnectOpen(false)}
          onActivated={() => {
            detail.refreshBindings();
            void detail.fetchKpiMeasurements(kpi.id);
          }}
        />
      )}
      {confirmArchive && (
        <ConfirmDialog
          title={t.kpis.archive_confirm_title}
          body={t.kpis.archive_confirm_body}
          confirmLabel={t.kpis.archive_button}
          danger
          onConfirm={() => {
            void detail.setStatus('archived').then(() => {
              setConfirmArchive(false);
              onClose();
            });
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </BaseModal>
  );
}

// -- header ------------------------------------------------------------------

function ModalHeader({ kpi, projectName, onClose }: { kpi: DevKpi; projectName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const d = paceDescriptor(kpi);
  const cat = categoryMeta(kpi.category);
  const kind = kindMeta(kpi.measure_kind);
  const cad = cadenceMeta(kpi.cadence);
  const CatIcon = cat.icon;
  const trackLabel =
    d.track === 'met' ? t.kpis.track_met
      : d.track === 'off-track' ? t.kpis.track_off
        : d.track === 'unmeasured' ? t.kpis.track_unmeasured
          : t.kpis.track_on;

  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-primary/10 bg-secondary/10">
      <div className="min-w-0 flex items-start gap-3">
        <span
          className="mt-0.5 flex-shrink-0 w-9 h-9 rounded-card flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${TRACK_COLOR[d.track]} 16%, transparent)` }}
        >
          <CatIcon className="w-4.5 h-4.5" style={{ color: TRACK_COLOR[d.track] }} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="typo-caption text-foreground truncate">{projectName}</p>
          <h2 id={TITLE_ID} className="typo-title text-foreground truncate">{kpi.name}</h2>
          <p className="typo-caption text-foreground/70">
            {cat.label(t)} · {kind.label(t)} · {cad.label(t)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="typo-overline px-2 py-1 rounded-interactive"
          style={{
            color: TRACK_COLOR[d.track],
            background: `color-mix(in srgb, ${TRACK_COLOR[d.track]} 14%, transparent)`,
          }}
        >
          {trackLabel}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t.common.close}>
          {t.common.close}
        </Button>
      </div>
    </div>
  );
}

// -- shared blocks -----------------------------------------------------------

function HeroBlock({ kpi }: { kpi: DevKpi }) {
  const { t, tx } = useTranslation();
  const d = paceDescriptor(kpi);
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/20 p-4 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="typo-hero text-foreground tabular-nums">
          {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
        </span>
        {kpi.target_value != null && (
          <span className="typo-body text-foreground/80 tabular-nums">
            / <Numeric value={kpi.target_value} /> {kpi.unit}
          </span>
        )}
      </div>
      {d.progressPct != null && (
        <div className="h-1.5 rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${d.progressPct}%`, background: TRACK_COLOR[d.track] }}
          />
        </div>
      )}
      <p className="typo-caption text-foreground/80">
        {kpi.target_date ? tx(t.kpis.due_by, { date: kpi.target_date.slice(0, 10) }) : ''}
      </p>
    </div>
  );
}

function HowMeasured({ kpi }: { kpi: DevKpi }) {
  const { t, tx } = useTranslation();
  return (
    <div className="space-y-1.5">
      {kpi.description && <p className="typo-body text-foreground">{kpi.description}</p>}
      <p className="typo-body text-foreground/90">{describeMeasurement(kpi, t, tx)}</p>
      <details className="typo-caption text-foreground/70">
        <summary className="cursor-pointer select-none">{t.kpis.show_procedure}</summary>
        <code className="block mt-1 font-mono break-all">{kpi.measure_config}</code>
      </details>
    </div>
  );
}

function HistoryBlock({ kpi, measurements }: { kpi: DevKpi; measurements: ReturnType<typeof useKpiDetail>['measurements'] }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="typo-overline text-foreground mb-1.5">{t.kpis.history_title}</h3>
      {measurements.length === 0 ? (
        <p className="typo-caption text-foreground/80">{t.kpis.history_empty}</p>
      ) : (
        <ul className="space-y-1">
          {measurements.map((m) => {
            const prov = summarizeEvidence(m.evidence);
            const sourceLabels = t.kpis.measurement_source as Record<string, string>;
            return (
              <li key={m.id} className="rounded-card border border-border/15 bg-secondary/20 px-2 py-1.5">
                <div className="flex items-center gap-2 typo-body text-foreground">
                  <span className="tabular-nums font-medium">
                    <Numeric value={m.value} /> {kpi.unit}
                  </span>
                  <span className="typo-caption text-foreground/80">
                    <RelativeTime timestamp={m.measured_at} />
                  </span>
                  <span className="ml-auto typo-caption px-1.5 py-0.5 rounded border border-border/20 bg-secondary/40 text-foreground">
                    {sourceLabels[m.source] ?? m.source}
                  </span>
                </div>
                {prov.summary && (
                  prov.full ? (
                    <Tooltip content={prov.full} placement="top">
                      <p className="typo-caption text-foreground mt-0.5 font-mono truncate cursor-help">{prov.summary}</p>
                    </Tooltip>
                  ) : (
                    <p className="typo-caption text-foreground mt-0.5 font-mono truncate">{prov.summary}</p>
                  )
                )}
                {m.note && <p className="typo-caption text-foreground mt-0.5">{m.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActionBar({
  kpi,
  onMeasureNow,
  onRecordManual,
  onSetStatus,
  onArchive,
}: {
  kpi: DevKpi;
  onMeasureNow: () => Promise<unknown>;
  onRecordManual: (value: number) => Promise<void>;
  onSetStatus: (status: 'active' | 'paused' | 'archived') => Promise<unknown>;
  onArchive: () => void;
}) {
  const { t, tx } = useTranslation();
  const [manualValue, setManualValue] = useState('');

  return (
    <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-t border-primary/10 bg-secondary/10">
      {kpi.status === 'paused' ? (
        <AsyncButton size="sm" variant="secondary" icon={<Play className="w-3.5 h-3.5" />} onClick={() => onSetStatus('active')}>
          {t.kpis.resume_button}
        </AsyncButton>
      ) : (
        <AsyncButton size="sm" variant="secondary" icon={<Pause className="w-3.5 h-3.5" />} onClick={() => onSetStatus('paused')}>
          {t.kpis.pause_button}
        </AsyncButton>
      )}

      {(kpi.measure_kind === 'codebase' || kpi.measure_kind === 'derived') && (
        <AsyncButton size="sm" variant="secondary" icon={<Cable className="w-3.5 h-3.5" />} onClick={onMeasureNow} loadingText={t.kpis.measuring}>
          {t.kpis.measure_now}
        </AsyncButton>
      )}

      {kpi.measure_kind === 'manual' && (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-0.5 typo-caption text-foreground">
            {tx(t.kpis.manual_entry_label, { unit: kpi.unit || '—' })}
            <input
              type="number"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="rounded-input border border-primary/15 bg-background px-2 py-1 typo-body text-foreground tabular-nums w-28"
            />
          </label>
          <AsyncButton
            size="sm"
            variant="secondary"
            disabled={manualValue === ''}
            onClick={async () => {
              await onRecordManual(Number(manualValue));
              setManualValue('');
            }}
          >
            {t.kpis.record_button}
          </AsyncButton>
        </div>
      )}

      <div className="flex-1" />
      <Button size="sm" variant="ghost" icon={<Archive className="w-3.5 h-3.5" />} onClick={onArchive}>
        {t.kpis.archive_button}
      </Button>
    </div>
  );
}

// -- small shared panel ------------------------------------------------------

function Panel({ title, icon: Icon, children }: { title: string; icon: typeof ShieldAlert; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10 p-4">
      <h3 className="flex items-center gap-1.5 typo-overline text-foreground mb-2">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden />
        {title}
      </h3>
      {children}
    </div>
  );
}
