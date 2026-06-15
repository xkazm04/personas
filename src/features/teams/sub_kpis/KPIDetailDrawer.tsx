// KPI detail drawer (P5: the KPI's STORY) — a time-series chart with the
// target line, a today marker, and GOAL-EVENT annotations (vertical markers
// where a derived goal landed) so cause-and-effect is visible: "goal shipped
// here, the line moved (or didn't)". Below it: how the KPI is measured in
// plain language (procedure behind a disclosure), Measure-now, manual entry
// for manual KPIs, the history list, pause/resume + archive.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Cable, Pause, Play, X } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiBinding } from '@/lib/bindings/DevKpiBinding';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import { listKpiBindings } from '@/api/devTools/kpis';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { paceDescriptor } from './kpiMath';
import { categoryMeta, cadenceMeta, kindMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';
import { ComposedByBadge, KPIConnectWizard } from './KPIConnectWizard';
import { KpiSteeringPanel } from './KpiSteeringPanel';

export function KPIDetailDrawer({ kpi, onClose }: { kpi: DevKpi; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const measurements = useSystemStore((s) => s.kpiMeasurements);
  const goals = useSystemStore((s) => s.goals);
  const fetchKpiMeasurements = useSystemStore((s) => s.fetchKpiMeasurements);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const recordKpiMeasurement = useSystemStore((s) => s.recordKpiMeasurement);
  const evaluateKpi = useSystemStore((s) => s.evaluateKpi);
  const updateKpi = useSystemStore((s) => s.updateKpi);

  const [manualValue, setManualValue] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [bindings, setBindings] = useState<DevKpiBinding[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);

  const refreshBindings = useCallback(() => {
    listKpiBindings(kpi.id).then(setBindings).catch(() => setBindings([]));
  }, [kpi.id]);

  useEffect(() => {
    void fetchKpiMeasurements(kpi.id);
    void fetchGoals(kpi.project_id);
    refreshBindings();
  }, [kpi.id, kpi.project_id, fetchKpiMeasurements, fetchGoals, refreshBindings]);

  const linkedGoals = useMemo(
    () => goals.filter((g) => g.kpi_id === kpi.id),
    [goals, kpi.id],
  );

  const d = paceDescriptor(kpi);
  const cat = categoryMeta(kpi.category);
  const kind = kindMeta(kpi.measure_kind);
  const cad = cadenceMeta(kpi.cadence);

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
            {cat.label(t)} · {kind.label(t)} · {cad.label(t)}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<X className="w-4 h-4" />}
          onClick={onClose}
          aria-label={t.common.close}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="rounded-card border border-primary/15 bg-secondary/20 p-3 space-y-2">
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
            {d.track === 'met'
              ? t.kpis.track_met
              : d.track === 'off-track'
                ? t.kpis.track_off
                : d.track === 'unmeasured'
                  ? t.kpis.track_unmeasured
                  : t.kpis.track_on}
            {kpi.target_date
              ? ` · ${tx(t.kpis.due_by, { date: kpi.target_date.slice(0, 10) })}`
              : ''}
          </p>
          <KpiStoryChart kpi={kpi} measurements={measurements} linkedGoals={linkedGoals} />
          {linkedGoals.length > 0 && (
            <p className="typo-caption text-foreground">
              {tx(t.kpis.linked_goals_hint, { count: linkedGoals.length })}
            </p>
          )}
        </div>

        {/* What the system is doing about this KPI — in-flight goals + the
            outcome trace of shipped ones (cockpit direction D3). */}
        <KpiSteeringPanel kpi={kpi} linkedGoals={linkedGoals} measurements={measurements} />

        {kpi.description && <p className="typo-body text-foreground">{kpi.description}</p>}
        <p className="typo-body text-foreground opacity-90">{describeMeasurement(kpi, t, tx)}</p>
        <details className="typo-caption text-foreground opacity-70">
          <summary className="cursor-pointer select-none">{t.kpis.show_procedure}</summary>
          <code className="block mt-1 font-mono break-all">{kpi.measure_config}</code>
        </details>

        <KpiSourceSection
          kpi={kpi}
          bindings={bindings}
          onConnect={() => setConnectOpen(true)}
        />

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

        {kpi.measure_kind === 'manual' && (
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
            <AsyncButton
              size="sm"
              variant="secondary"
              onClick={submitManual}
              disabled={manualValue === ''}
              data-testid="kpi-manual-record"
            >
              {t.kpis.record_button}
            </AsyncButton>
          </div>
        )}

        <div>
          <h3 className="typo-overline text-foreground mb-1.5">{t.kpis.history_title}</h3>
          {measurements.length === 0 ? (
            <p className="typo-caption text-foreground opacity-80">{t.kpis.history_empty}</p>
          ) : (
            <ul className="space-y-1">
              {measurements.map((m) => (
                <li key={m.id} className="flex items-center gap-2 typo-body text-foreground">
                  <span className="tabular-nums">
                    <Numeric value={m.value} /> {kpi.unit}
                  </span>
                  <span className="typo-caption text-foreground opacity-80">
                    <RelativeTime timestamp={m.measured_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 p-4 border-t border-primary/10">
        {kpi.status === 'paused' ? (
          <AsyncButton
            size="sm"
            variant="secondary"
            icon={<Play className="w-3.5 h-3.5" />}
            onClick={() => updateKpi(kpi.id, { status: 'active' })}
          >
            {t.kpis.resume_button}
          </AsyncButton>
        ) : (
          <AsyncButton
            size="sm"
            variant="secondary"
            icon={<Pause className="w-3.5 h-3.5" />}
            onClick={() => updateKpi(kpi.id, { status: 'paused' })}
          >
            {t.kpis.pause_button}
          </AsyncButton>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={<Archive className="w-3.5 h-3.5" />}
          onClick={() => setConfirmArchive(true)}
          data-testid="kpi-archive"
        >
          {t.kpis.archive_button}
        </Button>
      </div>

      {connectOpen && (
        <KPIConnectWizard
          kpi={kpi}
          onClose={() => setConnectOpen(false)}
          onActivated={() => {
            refreshBindings();
            void fetchKpiMeasurements(kpi.id);
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

// =============================================================================
// Data source — the KPI's active binding (or the invitation to create one)
// =============================================================================

function KpiSourceSection({
  kpi,
  bindings,
  onConnect,
}: {
  kpi: DevKpi;
  bindings: DevKpiBinding[];
  onConnect: () => void;
}) {
  const { t, tx } = useTranslation();
  const active = bindings.find((b) => b.status === 'active') ?? null;
  const degraded = !active ? bindings.find((b) => b.status === 'degraded') ?? null : null;
  const connectable =
    kpi.metric_type != null ||
    kpi.needed_connector != null ||
    kpi.measure_kind === 'connector' ||
    kpi.measure_kind === 'manual';

  if (!active && !degraded && !connectable) return null;

  return (
    <div data-testid="kpi-source-section">
      <h3 className="typo-overline text-foreground mb-1.5">{t.kpis.source_section_title}</h3>
      {degraded && (
        <div className="rounded-card border border-status-error/25 bg-status-error/10 p-3 mb-2 space-y-2">
          <p className="typo-body text-foreground">
            {tx(t.kpis.source_degraded_banner, { service: degraded.service_type })}
          </p>
          <Button size="sm" variant="secondary" icon={<Cable className="w-3.5 h-3.5" />} onClick={onConnect}>
            {t.kpis.source_reconnect}
          </Button>
        </div>
      )}
      {active ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="typo-body text-foreground font-medium">{active.service_type}</span>
          <ComposedByBadge composedBy={active.composed_by} />
          {active.verified_at && (
            <span className="typo-caption text-foreground opacity-80">
              {t.kpis.source_verified} <RelativeTime timestamp={active.verified_at} />
            </span>
          )}
          <button
            type="button"
            onClick={onConnect}
            className="typo-caption text-primary rounded-card px-1.5 py-1 hover:bg-secondary/40 transition-colors focus-ring"
            data-testid="kpi-change-source"
          >
            {t.kpis.source_change}
          </button>
        </div>
      ) : (
        !degraded && (
          <div className="flex items-center gap-2 flex-wrap">
            {kpi.measure_kind === 'manual' && (
              <p className="typo-caption text-foreground opacity-80">{t.kpis.source_none_hint}</p>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<Cable className="w-3.5 h-3.5" />}
              onClick={onConnect}
              data-testid="kpi-connect-source"
            >
              {t.kpis.source_connect}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

// =============================================================================
// The story chart — time series + target line + today marker + goal markers
// =============================================================================

const W = 360;
const H = 96;
const PAD = 8;

function ts(s: string): number {
  return new Date(s.replace(' ', 'T')).getTime();
}

function KpiStoryChart({
  kpi,
  measurements,
  linkedGoals,
}: {
  kpi: DevKpi;
  measurements: DevKpiMeasurement[];
  linkedGoals: DevGoal[];
}) {
  const { t, tx } = useTranslation();

  const model = useMemo(() => {
    const points = [...measurements]
      .map((m) => ({ t: ts(m.measured_at), v: m.value }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return null;

    const goalEvents = linkedGoals
      .map((g) => ({
        t: ts(g.completed_at ?? g.created_at),
        done: g.completed_at != null,
        title: g.title,
      }))
      .filter((e) => Number.isFinite(e.t));

    const now = Date.now();
    const tMin = Math.min(first.t, ...goalEvents.map((e) => e.t));
    const tMax = Math.max(now, last.t);
    const tSpan = Math.max(tMax - tMin, 1);

    const values = points.map((p) => p.v);
    const vCandidates = [...values];
    if (kpi.target_value != null) vCandidates.push(kpi.target_value);
    if (kpi.baseline_value != null) vCandidates.push(kpi.baseline_value);
    const vMin = Math.min(...vCandidates);
    const vMax = Math.max(...vCandidates);
    const vSpan = vMax - vMin || 1;

    const x = (time: number) => PAD + ((time - tMin) / tSpan) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - vMin) / vSpan) * (H - 2 * PAD);

    return {
      line: points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '),
      lastPoint: { x: x(last.t), y: y(last.v) },
      targetY: kpi.target_value != null ? y(kpi.target_value) : null,
      todayX: x(now),
      goalMarks: goalEvents.map((e) => ({ x: x(e.t), done: e.done, title: e.title })),
    };
  }, [measurements, linkedGoals, kpi.target_value, kpi.baseline_value]);

  if (!model) {
    return <p className="typo-caption text-foreground opacity-80">{t.kpis.chart_no_data}</p>;
  }

  return (
    <div data-testid="kpi-story-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.kpis.chart_aria}>
        {/* target line */}
        {model.targetY != null && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={model.targetY}
            y2={model.targetY}
            stroke="var(--success)"
            strokeDasharray="4 3"
            strokeWidth="1"
            opacity="0.7"
          />
        )}
        {/* today marker */}
        <line
          x1={model.todayX}
          x2={model.todayX}
          y1={PAD}
          y2={H - PAD}
          stroke="var(--primary)"
          strokeWidth="1"
          opacity="0.35"
        />
        {/* goal-event markers */}
        {model.goalMarks.map((g, i) => (
          <line
            key={i}
            x1={g.x}
            x2={g.x}
            y1={PAD}
            y2={H - PAD}
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeDasharray={g.done ? undefined : '3 3'}
            opacity="0.8"
          />
        ))}
        {/* the measurement line */}
        <polyline
          points={model.line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
        />
        <circle cx={model.lastPoint.x} cy={model.lastPoint.y} r="2.5" fill="var(--primary)" />
      </svg>
      {model.goalMarks.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {model.goalMarks.map((g, i) => (
            <Tooltip key={i} content={g.title}>
              <span className="typo-caption text-foreground opacity-80 truncate max-w-[10rem]">
                ▎{g.done ? t.kpis.goal_marker_done : t.kpis.goal_marker_open}: {g.title}
              </span>
            </Tooltip>
          ))}
        </div>
      )}
      <p className="typo-caption text-foreground opacity-70 mt-0.5">
        {model.targetY != null ? tx(t.kpis.chart_legend, { target: kpi.target_value ?? 0, unit: kpi.unit || '' }) : ''}
      </p>
    </div>
  );
}
