/**
 * TESTS preset: coverage, then the test commands (the gate body); the step's
 * history strip is in the screen's band.
 *
 * Coverage is the number Tests is judged by. Its ring is the step's instrument
 * at the top of the screen; here it gets the latest reading large with how far
 * it is from green and how it moved, beside its chart over the coverage runs
 * (`gate/CoverageChart`: the three zones, the two thresholds from the step's
 * params or the snapshot's rules, each run a point to peek or open). When
 * coverage was never measured the panel says so plainly - Tests cannot be
 * green without it - and offers to add the coverage command, which opens the
 * commands editor below with a coverage row ready to fill.
 */
import { Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
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
import { CoverageChart } from './gate/CoverageChart';
import { coverageChange, coveragePoints, coverageZone } from './gate/coverageModel';
import { GateBody } from './GatePreset';
import type { PresetData } from './presetData';
import { useCommandsEditor, type CommandsEditorState } from './useCommandsEditor';

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

interface CoverageProps {
  step: HealthStep;
  node: JourneyNode;
  data: PresetData;
  editor: CommandsEditorState;
  onOpen: (run: LifecycleRun) => void;
  measureId: string | null;
}

function CoveragePanel({ step, node, data, editor, onOpen, measureId }: CoverageProps) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const { coverageGreenPct: green, amberFloorPct: amber } = thresholdsFor(useSnapshotRules(), node.view.step.params);
  const metric = step.metrics.find((m) => m.key === 'coverage_pct') ?? null;
  const points = coveragePoints(data.detail?.runs ?? []);
  const change = coverageChange(points);
  const marked = measureId ? points.find((p) => p.run.measureId === measureId)?.run.id ?? null : null;
  const fmt = (v: number) => formatNumeric(v, 'plain', { precision: 0, language });
  return (
    <Section title={dl.lc2_coverage_title} level={2} desc={tx(dl.lc2_coverage_thresholds, { green, amber })}>
      {!metric || metric.value == null ? <NotMeasured editor={editor} /> : (
        <div className="grid grid-cols-1 items-center gap-x-8 gap-y-4 md:grid-cols-[12rem_minmax(0,1fr)]" data-testid="lc2-coverage">
          <div className={`flex flex-col gap-1 ${lcSurface('card')}`}>
            <span className={LT.label}>{dl.lc2_coverage_now}</span>
            <MetricValue metric={metric} className={`${LT.stat} ${VERDICT[coverageZone(metric.value, green, amber)].ink}`} />
            <span className={LT.row} data-testid="lc6-cov-to-green">
              {metric.value >= green ? dl.lcx6_cov_at_green : tx(dl.lcx6_cov_to_green, { points: fmt(green - metric.value) })}
            </span>
            {change != null && (
              <span className={`${LT.delta} ${change > 0 ? 'text-status-success' : change < 0 ? 'text-status-error' : ''}`} data-testid="lc6-cov-change">
                {tx(dl.lcx6_cov_over_runs, { change: `${change > 0 ? '+' : ''}${fmt(change)}` })}
              </span>
            )}
            <SampleNote metric={metric} />
          </div>
          <div className={`min-w-0 ${RHYTHM.tight}`}>
            {points.length > 0 ? (
              <>
                <CoverageChart points={points} green={green} amber={amber} markRunId={marked} onOpen={onOpen} />
                <p className={LT.meta}>{tx(dl.lc2_coverage_runs, { count: points.length })}</p>
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
    <GateBody
      node={node}
      data={data}
      editor={editor}
      lead={(onOpen, measureId) => <CoveragePanel step={step} node={node} data={data} editor={editor} onOpen={onOpen} measureId={measureId} />}
    />
  );
}
