/**
 * TESTS preset: coverage, then the test commands (the gate body); the step's
 * history strip is in the screen's band.
 *
 * Coverage is the number Tests is judged by. Its ring is the step's instrument
 * at the top of the screen; here it gets its trend over the coverage runs
 * against the two thresholds (the step's own, else the snapshot's rules),
 * drawn large. When coverage was never measured the panel says so plainly -
 * Tests cannot be green without it - and offers to add the coverage command,
 * which opens the commands editor below with a coverage row ready to fill.
 */
import { Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Section } from '@/features/shared/components/kit';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import { formatNumeric } from '@/lib/utils/formatters';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { VERDICT, type HealthStep } from '../layer1/healthModel';
import { ArcGauge } from '../layer1/parts/ArcGauge';
import { MetricValue, SampleNote } from '../layer1/parts/MetricValue';
import { RHYTHM, lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { thresholdsFor } from '../system/rules';
import { GLYPH } from '../system/scales';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { GateBody } from './GatePreset';
import { coverageTrend } from './gateModel';
import { Sparkline } from './parts/Sparkline';
import type { PresetData } from './presetData';
import { useCommandsEditor, type CommandsEditorState } from './useCommandsEditor';

function coverageHealth(value: number, green: number, amber: number): LifecycleHealth {
  return value >= green ? 'green' : value >= amber ? 'amber' : 'red';
}

function NotMeasured({ editor }: { editor: CommandsEditorState }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={`flex flex-wrap items-center gap-6 ${lcSurface('panel', 'border-2 border-dashed border-foreground/45')}`} data-testid="lc2-coverage-na">
      <ArcGauge health="unmeasured" ratio={null} size="md">
        <span className={LT.stat} data-na="true">{dl.lc1_na}</span>
      </ArcGauge>
      <div className={`min-w-0 flex-1 ${RHYTHM.tight}`}>
        <p className={LT.title}>{dl.lc2_coverage_na_title}</p>
        <p className={LT.row}>{dl.lc2_coverage_na_body}</p>
        <Button variant="accent" tone="info" size="sm" icon={<Plus className={GLYPH.sm} />} onClick={() => editor.open('coverage')} data-testid="lc2-coverage-add">
          {dl.lc2_coverage_add}
        </Button>
      </div>
    </div>
  );
}

function CoveragePanel({ step, node, data, editor }: { step: HealthStep; node: JourneyNode; data: PresetData; editor: CommandsEditorState }) {
  const { dl, tx } = useLifecycleViewModel();
  const { coverageGreenPct: green, amberFloorPct: amber } = thresholdsFor(useSnapshotRules(), node.view.step.params);
  const metric = step.metrics.find((m) => m.key === 'coverage_pct') ?? null;
  const trend = coverageTrend(data.detail?.runs ?? []);
  const caption = tx(dl.lc2_coverage_thresholds, { green, amber });
  // The ring is drawn once, in the step's instrument above; this panel adds what the ring cannot say: where it is going.
  // Zoom to the band the readings and both thresholds live in, so a few points of movement show.
  const floor = Math.max(0, Math.min(amber, ...trend) - 10);
  const ceiling = Math.min(100, Math.max(green, ...trend) + 10);
  return (
    <Section title={dl.lc2_coverage_title} level={2} desc={caption}>
      {!metric || metric.value == null ? <NotMeasured editor={editor} /> : (
        <div className={`flex flex-wrap items-center ${RHYTHM.inlineWide}`} data-testid="lc2-coverage">
          <div className="flex flex-col gap-1">
            <span className={LT.label}>{dl.lc2_coverage_now}</span>
            <MetricValue metric={metric} className={`${LT.stat} ${VERDICT[coverageHealth(metric.value, green, amber)].ink}`} />
            <SampleNote metric={metric} />
          </div>
          <div className={`min-w-0 ${RHYTHM.tight}`}>
            <span className={LT.label}>{dl.lc2_coverage_trend}</span>
            {trend.length > 0 ? (
              <>
                <Sparkline
                  points={trend.map((v) => ({ value: v, tone: v >= green ? 'success' : v >= amber ? 'warning' : 'error' }))}
                  min={floor}
                  max={ceiling}
                  refs={[
                    { value: green, tone: 'success', label: formatNumeric(green, 'percent', { precision: 0 }) },
                    { value: amber, tone: 'warning', label: formatNumeric(amber, 'percent', { precision: 0 }) },
                  ]}
                  width={480}
                  height={120}
                  testId="lc2-coverage-trend"
                />
                <p className={LT.meta}>{tx(dl.lc2_coverage_runs, { count: trend.length })}</p>
              </>
            ) : (
              <p className={LT.row}>{dl.lc2_coverage_no_trend}</p>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

export function TestsPreset({ step, node, data }: { step: HealthStep; node: JourneyNode; data: PresetData }) {
  const editor = useCommandsEditor(node.view.step, data.detail?.runs ?? []);
  return (
    <>
      <CoveragePanel step={step} node={node} data={data} editor={editor} />
      <GateBody node={node} data={data} editor={editor} />
    </>
  );
}
