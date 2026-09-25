// L4: a KPI's console, composed from the kit (Gate 5). The caller's FactoryHead
// names the KPI; this is its body. Read: the headline figures (StatStrip, the
// distance to target drawn as 20 units of 5%), the calibration track, the
// honest "over to you" state, and the Measurement section (methodic, last
// reading, Measure now against the real eval engine, Configure). Steer: the
// threshold and assessment sections (KpiSteer).
// Calibration and assessment edits flow up via onEdit; FactoryShell persists them.
import { useState } from 'react';

import { evaluateKpi } from '@/api/devTools/kpis';
import { Dot, KeyValueGrid, KitButton, Section, StatStrip, toneColor, UnitStrip } from '@/features/shared/components/kit';
import { KIND_LABEL, CADENCE_LABEL, kpiStatus, progressPct, fmtUnit, describeMeasureConfig, type MockKpi, type KpiEdit } from './factoryModel';
import { CalibrationTrack, Sparkline } from './factoryPrimitives';
import { KPI_STATUS_MARK } from './factoryTone';
import { errMsg } from './composeTask';
import { MeasureSetupModal } from './MeasureSetupModal';
import { KpiSteer } from './KpiSteer';
import type { FactoryWords } from './useFactoryWords';

export function KpiConsole({ kpi, onEdit, w }: { kpi: MockKpi; onEdit: (patch: KpiEdit) => void; w: FactoryWords }) {
  const st = kpiStatus(kpi);
  const mark = KPI_STATUS_MARK[st];
  const pct = progressPct(kpi);
  const [measuring, setMeasuring] = useState(false);
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const handleMeasure = async () => {
    setMeasuring(true);
    setMeasureMsg(null);
    try {
      const m = await evaluateKpi(kpi.id);
      setMeasureMsg(w.L.measured(fmtUnit(m.value, kpi.unit)));
    } catch (e) {
      setMeasureMsg(errMsg(e));
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <div data-testid="factory-kpi-console">
      <StatStrip
        tiles={[
          { label: w.current, value: kpi.current, unit: kpi.unit || undefined },
          {
            label: w.L.toTarget,
            value: pct == null ? null : `${pct}%`,
            draw: pct == null ? undefined : <UnitStrip size="s" label={w.L.toTarget} segments={[{ n: pct / 5, tone: mark.tone }, { n: 20 - pct / 5, tone: 'neutral', glyph: 'empty' }]} />,
          },
          { label: w.baseline, value: fmtUnit(kpi.baseline, kpi.unit) },
          { label: w.target, value: fmtUnit(kpi.target, kpi.unit) },
        ]}
      />
      <div className="k-in" style={{ margin: '8px 0 20px' }}><CalibrationTrack kpi={kpi} height={28} /></div>
      {/* D9: the derivation looked at this off-track KPI and judged nothing the team can build would move it. */}
      {kpi.skipFresh && (
        <div className="k-in" style={{ marginBottom: 16 }}>
          <p className="typo-body flex items-center gap-2"><Dot tone="human" glyph="hollow" />{w.L.overToYou}</p>
          {kpi.skipRationale && <p className="typo-caption">{kpi.skipRationale}</p>}
        </div>
      )}
      <Section
        level={2}
        title={w.L.measurement}
        meta={`${KIND_LABEL[kpi.measureKind]} · ${CADENCE_LABEL[kpi.cadence]}`}
        actions={
          <>
            <KitButton quiet onClick={() => setShowSetup(true)}>{w.t.common.configure}</KitButton>
            <KitButton onClick={() => { if (!measuring) void handleMeasure(); }} loading={measuring}>{w.t.kpis.measure_now}</KitButton>
          </>
        }
      >
        <KeyValueGrid
          min="200px"
          items={[
            { k: w.L.methodic, v: describeMeasureConfig(kpi.measureConfig, { emptyText: w.L.noMethodic, unparsedFallback: kpi.measureConfig }) },
            { k: w.L.lastMeasured, v: kpi.lastMeasuredAt },
          ]}
        />
        <div className="k-in"><Sparkline series={kpi.series} color={toneColor(mark.tone)} width={360} height={34} /></div>
        {measureMsg && <p className="k-in typo-caption" role="status">{measureMsg}</p>}
      </Section>
      <KpiSteer kpi={kpi} onEdit={onEdit} w={w} />
      {showSetup && <MeasureSetupModal kpi={kpi} onClose={() => setShowSetup(false)} />}
    </div>
  );
}
