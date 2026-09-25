// L4 steer half: calibrate the thresholds (the two sliders and what the system
// does to THIS KPI at the current lines, D8) and assess the signal (rating,
// pros, cons). Two level-2 Sections on the console's spine.
import { Dot, Section } from '@/features/shared/components/kit';
import { fmtUnit, kpiStatus, type KpiEdit, type KpiStatus, type MockKpi } from './factoryModel';
import { AssessmentEditor, ThresholdSlider } from './factoryPrimitives';
import { KPI_STATUS_MARK } from './factoryTone';
import type { FactoryWords } from './useFactoryWords';

function domain(kpi: MockKpi): { min: number; max: number } {
  const vals = [kpi.baseline, kpi.target, kpi.warnAt, kpi.critAt, kpi.current ?? kpi.baseline];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || 1;
  return { min: Math.round((lo - pad) * 100) / 100, max: Math.round((hi + pad) * 100) / 100 };
}

/** D8: the live calibrated status read aloud, scoped to the lines being dragged. */
function consequence(st: KpiStatus, kpi: MockKpi): string {
  const cur = kpi.current != null ? fmtUnit(kpi.current, kpi.unit) : null;
  return st === 'crit'
    ? `${cur} is past your red line. The system derives a goal to fix this now.`
    : st === 'warn'
      ? `${cur} is in the watch zone. The team gets a nudge, no goal yet.`
      : st === 'met'
        ? `Target met at ${cur}. Nothing to steer.`
        : st === 'unmeasured'
          ? 'Not measured yet. Your lines take effect on the next measurement.'
          : `${cur} is clear of both lines. Nothing triggers.`;
}

export function KpiSteer({ kpi, onEdit, w }: { kpi: MockKpi; onEdit: (patch: KpiEdit) => void; w: FactoryWords }) {
  const st = kpiStatus(kpi);
  const { min, max } = domain(kpi);
  return (
    <>
      <Section level={2} title={w.L.calibrate}>
        <div className="space-y-4">
          <ThresholdSlider label={w.L.yellow} tone="warning" value={kpi.warnAt} min={min} max={max} unit={kpi.unit} onChange={(v) => onEdit({ warnAt: v })} />
          <ThresholdSlider label={w.L.red} tone="error" value={kpi.critAt} min={min} max={max} unit={kpi.unit} onChange={(v) => onEdit({ critAt: v })} />
        </div>
        <div className="k-in" style={{ marginTop: 12 }}>
          <p className="typo-body flex items-center gap-2" role="status"><Dot {...KPI_STATUS_MARK[st]} />{consequence(st, kpi)}</p>
          <p className="typo-caption">{w.baseline} {fmtUnit(kpi.baseline, kpi.unit)} → {w.target.toLowerCase()} {fmtUnit(kpi.target, kpi.unit)}.</p>
        </div>
      </Section>
      <Section level={2} title={w.L.assess}>
        <AssessmentEditor
          rating={kpi.manualRating}
          pros={kpi.pros}
          cons={kpi.cons}
          onRate={(v) => onEdit({ rating: v })}
          onPros={(v) => onEdit({ pros: v })}
          onCons={(v) => onEdit({ cons: v })}
          labels={{ pros: w.L.pros, cons: w.L.cons, prosHint: w.L.prosHint, consHint: w.L.consHint, rated: w.L.rated, unrated: w.L.unrated }}
        />
      </Section>
    </>
  );
}
