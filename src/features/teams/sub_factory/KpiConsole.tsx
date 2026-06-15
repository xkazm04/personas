// L4 — KPI detail console (consolidated to the "Console" two-pane layout the
// user picked). Left pane = read (status, hero value, calibration track,
// measurement methodic). Right pane = steer (threshold sliders + rate/pros/cons).
//
// Round-6 wiring:
//   · number↔unit spacing via fmtUnit ("0 errors", "78%")
//   · assessment = rating + Pros + Cons (extended note)
//   · "Measure now" calls the REAL eval engine (dev_tools_evaluate_kpi)
//   · the measurement methodic (measure_config) is shown + editable (adjust)
// Calibration/assessment edits flow up via onEdit; persistence to dev_kpis is
// handled by the caller (FactoryShell) so the same widget works on mock + live.
import { useState } from 'react';
import { Clock, SlidersHorizontal, Activity, Play, Settings2, Loader2 } from 'lucide-react';

import { evaluateKpi } from '@/api/devTools/kpis';
import { STATUS_COLOR, TRAFFIC_COLOR, CATEGORY_LABEL, kpiStatus, progressPct, fmtUnit, type MockKpi, type KpiEdit } from './factoryMock';
import { Sparkline, CalibrationTrack, StatusPill, ThresholdSlider, AssessmentEditor } from './factoryPrimitives';
import { errMsg } from './composeTask';
import { MeasureSetupModal } from './MeasureSetupModal';

function domain(kpi: MockKpi): { min: number; max: number } {
  const vals = [kpi.baseline, kpi.target, kpi.warnAt, kpi.critAt, kpi.current ?? kpi.baseline];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || 1;
  return { min: Math.round((lo - pad) * 100) / 100, max: Math.round((hi + pad) * 100) / 100 };
}

/** Human one-liner describing the measurement methodic (measure_config). */
function describeMethodic(cfg: string | undefined): string {
  if (!cfg) return '(no methodic configured)';
  try {
    const o = JSON.parse(cfg) as Record<string, unknown>;
    if (o.cmd) return `runs \`${o.cmd}\`${o.parse ? ` · parse ${o.parse}` : ''}`;
    if (o.metric) return `orchestrator metric: ${o.metric}`;
    if (o.connector) return `connector ${o.connector}${o.instruction ? `: ${o.instruction}` : ''}`;
    if (o.instruction) return String(o.instruction);
    return cfg;
  } catch {
    return cfg;
  }
}

export function KpiConsole({ kpi, onEdit }: { kpi: MockKpi; onEdit: (patch: KpiEdit) => void }) {
  const st = kpiStatus(kpi);
  const pct = progressPct(kpi);
  const { min, max } = domain(kpi);

  // Measure now — calls the real eval engine.
  const [measuring, setMeasuring] = useState(false);
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);
  const handleMeasure = async () => {
    setMeasuring(true);
    setMeasureMsg(null);
    try {
      const m = await evaluateKpi(kpi.id);
      setMeasureMsg(`Measured ${fmtUnit(m.value, kpi.unit)} — saved`);
    } catch (e) {
      setMeasureMsg(errMsg(e));
    } finally {
      setMeasuring(false);
    }
  };

  // Measurement setup — opens the per-type configuration modal.
  const [showSetup, setShowSetup] = useState(false);

  return (
    <div className="grid lg:grid-cols-2 gap-4" data-testid="factory-kpi-console">
      {/* READ */}
      <div className="rounded-card border border-primary/15 bg-secondary/10 p-5">
        <div className="flex items-center gap-2 mb-2">
          <StatusPill status={st} />
          <span className="ml-auto typo-caption capitalize">{kpi.tier.replace('_', ' ')} · {CATEGORY_LABEL[kpi.category]}</span>
        </div>
        <h2 className="typo-section-title mb-3 leading-tight">{kpi.name}</h2>
        <div className="flex items-end gap-2 mb-4">
          <span className="text-5xl font-bold tabular-nums" style={{ color: STATUS_COLOR[st] }}>{kpi.current ?? '—'}</span>
          <span className="typo-body mb-1.5">{kpi.unit}</span>
          {pct != null && (
            <span className="ml-auto mb-1 text-right leading-none">
              <span className="typo-data-lg tabular-nums" style={{ color: STATUS_COLOR[st] }}>{pct}%</span>
              <span className="block typo-caption">to target</span>
            </span>
          )}
        </div>
        <CalibrationTrack kpi={kpi} height={36} />

        {/* measurement methodic */}
        <div className="mt-5">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="typo-label text-foreground flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Measurement</h3>
            <span className="typo-caption lowercase ml-1">{kpi.measureKind}</span>
            <span className="typo-caption flex items-center gap-1"><Clock className="w-3 h-3" /> {kpi.cadence}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleMeasure}
              disabled={measuring}
              className="typo-caption inline-flex items-center gap-1 rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {measuring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {measuring ? 'Measuring…' : 'Measure now'}
            </button>
          </div>

          {/* methodic: preview + configure */}
          <div className="rounded-interactive border border-primary/10 bg-background/40 p-2.5 mb-2">
            <div className="flex items-start gap-2">
              <span className="typo-caption flex-1 break-words">{describeMethodic(kpi.measureConfig)}</span>
              <button type="button" onClick={() => setShowSetup(true)} className="typo-caption inline-flex items-center gap-1 text-primary hover:underline flex-shrink-0">
                <Settings2 className="w-3 h-3" /> configure
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Sparkline series={kpi.series} color={STATUS_COLOR[st]} width={360} height={34} />
            <span className="typo-caption">last {kpi.lastMeasuredAt}</span>
          </div>
          {measureMsg && <p className="typo-caption mt-1.5" style={{ color: STATUS_COLOR[st] }}>{measureMsg}</p>}
        </div>
      </div>

      {/* STEER */}
      <div className="space-y-4">
        <section className="rounded-card border border-primary/10 bg-secondary/10 p-4">
          <h3 className="typo-label text-foreground mb-3 flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> Calibrate thresholds</h3>
          <div className="space-y-5">
            <ThresholdSlider label="Yellow — at risk" color={TRAFFIC_COLOR.yellow} value={kpi.warnAt} min={min} max={max} unit={kpi.unit} onChange={(v) => onEdit({ warnAt: v })} />
            <ThresholdSlider label="Red — off track" color={TRAFFIC_COLOR.red} value={kpi.critAt} min={min} max={max} unit={kpi.unit} onChange={(v) => onEdit({ critAt: v })} />
          </div>
          <p className="typo-caption mt-3">Yellow nudges the team; red derives a goal. Baseline {fmtUnit(kpi.baseline, kpi.unit)} → target {fmtUnit(kpi.target, kpi.unit)}.</p>
        </section>
        <section className="rounded-card border border-primary/10 bg-secondary/10 p-4">
          <h3 className="typo-label text-foreground mb-3">Assess</h3>
          <AssessmentEditor
            rating={kpi.manualRating}
            pros={kpi.pros}
            cons={kpi.cons}
            onRate={(v) => onEdit({ rating: v })}
            onPros={(v) => onEdit({ pros: v })}
            onCons={(v) => onEdit({ cons: v })}
          />
        </section>
      </div>
      {showSetup && <MeasureSetupModal kpi={kpi} onClose={() => setShowSetup(false)} />}
    </div>
  );
}
