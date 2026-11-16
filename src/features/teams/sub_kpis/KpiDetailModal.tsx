// KpiDetailModal — the full-screen KPI detail surface (replaces the retired
// right-edge KPIDetailDrawer everywhere). A stacked "case file": header band,
// then hero → story → steering → how-measured → source → history, with the
// measure / pause / archive actions pinned to a footer bar. Built on the shared
// BaseModal primitive; reuses the shared data hook + detail parts.
import { useMemo, useState } from 'react';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { Archive, Cable, Gauge, History, Pause, Play, Ruler } from 'lucide-react';

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
import { RichMarkdown } from '@/features/shared/components/editors/RichMarkdown';
import { paceDescriptor } from './kpiMath';
import { computeConvergence, splitChannels, type Convergence } from './kpiConvergence';
import { categoryMeta, kindMeta, cadenceMeta, TRACK_COLOR } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';
import { summarizeEvidence } from './kpiMeasurementProvenance';
import { KpiStoryChart, KpiSourceSection } from './kpiDetailParts';
import { KpiSteeringPanel } from './KpiSteeringPanel';
import { KPIConnectWizard } from './KPIConnectWizard';
import { useKpiDetail } from './useKpiDetail';
import { KpiSection } from './KpiDetailSection';

const TITLE_ID = 'kpi-detail-modal-title';

export function KpiDetailModal({
  kpi,
  onClose,
}: {
  kpi: DevKpi;
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

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      staggerChildren={false}
      // 20% wider than the max-w-4xl it had (56rem -> 67rem), and the reading
      // column inside grows by the same fifth (42rem -> 50rem) - widening only
      // the shell would have added margin, not room.
      maxWidthClass="max-w-[67rem]"
      panelClassName="relative w-full h-[85vh] glass-md rounded-card shadow-elevation-4 overflow-hidden flex flex-col"
    >
      <ModalHeader kpi={kpi} projectName={projectName} onClose={onClose} />

      <div className="flex-1 overflow-y-auto p-5">
        {/* One document, the Manifest's way: every block is a KpiSection and
            the hairlines between them come from this divide-y, so a section
            that has nothing to say (steering, source) leaves no gap behind. */}
        <div className="max-w-[50rem] mx-auto divide-y divide-primary/10">
          <section className="pb-5">
            <HeroBlock kpi={kpi} />
          </section>
          <KpiSection title={t.kpis.chart_trend_title} icon={Gauge}>
            {/* P3 convergence: production stays the solid truth line; the sim
                channel overlays dashed, and the readout names the gap. */}
            <StoryWithConvergence kpi={kpi} measurements={detail.measurements} linkedGoals={detail.linkedGoals} />
          </KpiSection>
          <KpiSteeringPanel kpi={kpi} linkedGoals={detail.linkedGoals} measurements={detail.measurements} />
          <HowMeasured kpi={kpi} />
          <KpiSourceSection kpi={kpi} bindings={detail.bindings} onConnect={() => setConnectOpen(true)} />
          <HistoryBlock kpi={kpi} measurements={detail.measurements} />
        </div>
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
          : d.track === 'unpaced' ? t.kpis.track_unpaced
            : t.kpis.track_on;

  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-hair bg-surface-1">
      <div className="min-w-0 flex items-start gap-3">
        <span
          className="mt-0.5 flex-shrink-0 w-9 h-9 rounded-card flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${TRACK_COLOR[d.track]} 16%, transparent)` }}
        >
          <CatIcon className="w-4.5 h-4.5" style={{ color: TRACK_COLOR[d.track] }} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="typo-caption text-ink-2 truncate">{projectName}</p>
          <h2 id={TITLE_ID} className="typo-title truncate">{kpi.name}</h2>
          <p className="typo-caption text-ink-2">
            {cat.label(t)} · {kind.label(t)} · {cad.label(t)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="typo-eyebrow px-2 py-1 rounded-interactive"
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
    <div className="rounded-card border border-hair bg-surface-1 p-4 space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="typo-hero text-foreground num">
          {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
        </span>
        {kpi.target_value != null && (
          <span className="typo-data-lg">
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
      <p className="typo-caption">
        {kpi.target_date ? tx(t.kpis.due_by, { date: kpi.target_date.slice(0, 10) }) : ''}
      </p>
    </div>
  );
}

/** P3 — the story chart with the sim-vs-real convergence readout. With no
 *  simulated measurements this is exactly the plain production story chart. */
function StoryWithConvergence({
  kpi,
  measurements,
  linkedGoals,
}: {
  kpi: DevKpi;
  measurements: ReturnType<typeof useKpiDetail>['measurements'];
  linkedGoals: ReturnType<typeof useKpiDetail>['linkedGoals'];
}) {
  const { t, tx } = useTranslation();
  const { production, sim } = useMemo(() => splitChannels(measurements), [measurements]);
  const conv: Convergence = useMemo(
    () => computeConvergence(measurements, kpi.target_value, kpi.baseline_value),
    [measurements, kpi.target_value, kpi.baseline_value],
  );

  const verdictLabel: Record<Convergence['verdict'], string> = {
    converging: t.kpis.conv_verdict_converging,
    diverging: t.kpis.conv_verdict_diverging,
    stable: t.kpis.conv_verdict_stable,
    insufficient: t.kpis.conv_verdict_insufficient,
  };
  const verdictState: Record<Convergence['verdict'], StateMarkState> = {
    converging: 'success',
    diverging: 'error',
    stable: 'neutral',
    insufficient: 'blank',
  };

  return (
    <div>
      <KpiStoryChart kpi={kpi} measurements={production} simMeasurements={sim} linkedGoals={linkedGoals} />
      {sim.length > 0 && (
        <div className="mt-2 space-y-1" data-testid="kpi-convergence-readout">
          {/* channel legend */}
          <div className="flex items-center gap-3 typo-caption text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2" style={{ borderColor: 'var(--primary)' }} aria-hidden />
              {t.kpis.env_labels.production}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: '#8B5CF6' }} aria-hidden />
              {t.kpis.trend_sim_suffix}
            </span>
            <span className="ml-auto" data-testid="kpi-convergence-verdict">
              <StateMark state={verdictState[conv.verdict]} label={verdictLabel[conv.verdict]} />
            </span>
          </div>
          {production.length === 0 ? (
            <p className="typo-caption text-ink-2">{t.kpis.conv_no_prod}</p>
          ) : conv.latest ? (
            <>
              <p className="typo-body text-foreground">
                {t.kpis.conv_gap_label}{' '}
                <span className="font-medium num">
                  {conv.latest.gap > 0 ? '+' : ''}
                  <Numeric value={conv.latest.gap} /> {kpi.unit}
                </span>{' '}
                <span className="opacity-80">
                  ({t.kpis.conv_sim_label} <Numeric value={conv.latest.simValue} /> · {t.kpis.conv_real_label}{' '}
                  <Numeric value={conv.latest.prodValue} />
                  {conv.latest.normalized != null && (
                    <> · {tx(t.kpis.conv_share_of_span, { pct: Math.round(conv.latest.normalized * 100) })}</>
                  )}
                  )
                </span>
              </p>
              {conv.latest.prodStaleDays >= 2 && (
                <p className="typo-caption text-status-warning" data-testid="kpi-convergence-stale">
                  {tx(t.kpis.conv_stale_hint, { days: conv.latest.prodStaleDays })}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function HowMeasured({ kpi }: { kpi: DevKpi }) {
  const { t, tx } = useTranslation();
  return (
    <KpiSection title={t.kpis.section_how} icon={Ruler}>
      <div className="space-y-2">
      {/* The description is AUTHORED - the KPI scan writes it, an agent can
          rewrite it - so it renders as RichMarkdown: a scan may put a gauge,
          a card or a table of evidence in it, in the app's one block vocabulary. */}
      {kpi.description && <RichMarkdown content={kpi.description} className="typo-body-lg" />}
      <p className="typo-body">{describeMeasurement(kpi, t, tx)}</p>
      <details className="typo-caption">
        <summary className="cursor-pointer select-none">{t.kpis.show_procedure}</summary>
        <code className="mt-1 block rounded-card bg-surface-1 px-2.5 py-2 typo-code break-all">
          {kpi.measure_config}
        </code>
      </details>
      </div>
    </KpiSection>
  );
}

function HistoryBlock({ kpi, measurements }: { kpi: DevKpi; measurements: ReturnType<typeof useKpiDetail>['measurements'] }) {
  const { t } = useTranslation();
  return (
    <KpiSection
      title={t.kpis.history_title}
      icon={History}
      aside={measurements.length > 0 ? <span className="typo-data">{measurements.length}</span> : undefined}
    >
      {measurements.length === 0 ? (
        <p className="typo-caption">{t.kpis.history_empty}</p>
      ) : (
        <ul className="divide-y divide-primary/10 rounded-card border border-hair">
          {measurements.map((m) => {
            const prov = summarizeEvidence(m.evidence);
            const sourceLabels = t.kpis.measurement_source as Record<string, string>;
            return (
              <li key={m.id} className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="typo-data">
                    <Numeric value={m.value} /> <span className="typo-caption">{kpi.unit}</span>
                  </span>
                  <span className="typo-caption">
                    <RelativeTime timestamp={m.measured_at} />
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1">
                    {(m.env ?? 'production') !== 'production' && (
                      <span className="typo-eyebrow text-role-agent" data-testid="kpi-measurement-env-chip">
                        {(t.kpis.env_labels as Record<string, string>)[m.env] ?? m.env}
                      </span>
                    )}
                    <span className="typo-eyebrow text-ink-3">
                      {sourceLabels[m.source] ?? m.source}
                    </span>
                  </span>
                </div>
                {prov.summary && (
                  prov.full ? (
                    <Tooltip content={prov.full} placement="top">
                      <p className="typo-code text-ink-2 mt-0.5 truncate cursor-help">{prov.summary}</p>
                    </Tooltip>
                  ) : (
                    <p className="typo-code text-ink-2 mt-0.5 truncate">{prov.summary}</p>
                  )
                )}
                {m.note && <p className="typo-caption text-ink-2 mt-0.5">{m.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </KpiSection>
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
  onRecordManual: (value: number) => Promise<boolean>;
  onSetStatus: (status: 'active' | 'paused' | 'archived') => Promise<unknown>;
  onArchive: () => void;
}) {
  const { t, tx } = useTranslation();
  const [manualValue, setManualValue] = useState('');

  return (
    <div className="flex items-center gap-2 flex-wrap px-5 py-3 border-t border-hair bg-surface-1">
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
          <label className="flex flex-col gap-0.5 typo-caption text-ink-2">
            {tx(t.kpis.manual_entry_label, { unit: kpi.unit || '—' })}
            <input
              type="number"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="rounded-input border border-hair bg-background px-2 py-1 typo-data text-foreground w-28"
            />
          </label>
          <AsyncButton
            size="sm"
            variant="secondary"
            disabled={manualValue === ''}
            onClick={async () => {
              // Clear only a value that was stored: a failed write keeps it
              // in the field so the user can retry instead of retyping it.
              if (await onRecordManual(Number(manualValue))) setManualValue('');
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
