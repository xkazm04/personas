/**
 * TESTS preset: coverage first, then the test commands (the gate body).
 *
 * Coverage is the number Tests is judged by. Its ring is the step's
 * instrument at the top of the screen; here it gets its trend over the
 * coverage runs against the two thresholds, drawn large. When coverage was never measured the panel says so plainly - Tests
 * cannot be green without it - and offers to add the coverage command, which
 * opens the commands editor below with a coverage row ready to fill.
 */
import { CircleDashed, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Section } from '@/features/shared/components/kit';
import { formatNumeric } from '@/lib/utils/formatters';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import { VERDICT, type HealthStep } from '../layer1/healthModel';
import { MetricValue, SampleNote } from '../layer1/parts/MetricValue';
import { GateBody, type PresetData } from './GatePreset';
import { coverageTrend } from './gateModel';
import { AMBER_FLOOR_PCT, DEFAULT_COVERAGE_GREEN_PCT } from './healthRules';
import { Sparkline } from './parts/Sparkline';
import { useCommandsEditor, type CommandsEditorState } from './useCommandsEditor';

const AMBER_FLOOR = AMBER_FLOOR_PCT;

function coverageHealth(value: number, green: number): LifecycleHealth {
  return value >= green ? 'green' : value >= AMBER_FLOOR ? 'amber' : 'red';
}

function NotMeasured({ editor }: { editor: CommandsEditorState }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-modal border-2 border-dashed border-foreground/45 px-6 py-5" data-testid="lc2-coverage-na">
      <span className="flex flex-col items-center gap-1">
        <CircleDashed className="h-14 w-14 text-foreground" aria-hidden />
        <span className="typo-data-lg text-foreground" data-na="true">{dl.lc1_na}</span>
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="typo-heading text-foreground">{dl.lc2_coverage_na_title}</p>
        <p className="typo-body text-foreground">{dl.lc2_coverage_na_body}</p>
        <Button variant="accent" tone="info" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => editor.open('coverage')} data-testid="lc2-coverage-add">
          {dl.lc2_coverage_add}
        </Button>
      </div>
    </div>
  );
}

function CoveragePanel({ step, node, data, editor }: { step: HealthStep; node: JourneyNode; data: PresetData; editor: CommandsEditorState }) {
  const { dl, tx } = useLifecycleViewModel();
  const metric = step.metrics.find((m) => m.key === 'coverage_pct') ?? null;
  const green = node.view.step.params.coverageGreenPct ?? DEFAULT_COVERAGE_GREEN_PCT;
  const trend = coverageTrend(data.detail?.runs ?? []);
  const caption = tx(dl.lc2_coverage_thresholds, { green, amber: AMBER_FLOOR });
  // The ring is drawn once, in the step's instrument above; this panel adds what the ring cannot say: where it is going.
  // Zoom to the band the readings and both thresholds live in, so a few points of movement show.
  const floor = Math.max(0, Math.min(AMBER_FLOOR, ...trend) - 10);
  const ceiling = Math.min(100, Math.max(green, ...trend) + 10);
  return (
    <Section title={dl.lc2_coverage_title} level={2} desc={caption}>
      {!metric || metric.value == null ? <NotMeasured editor={editor} /> : (
        <div className="flex flex-wrap items-center gap-x-12 gap-y-4" data-testid="lc2-coverage">
          <div className="flex flex-col gap-1">
            <span className="typo-label text-foreground">{dl.lc2_coverage_now}</span>
            <MetricValue metric={metric} className={`typo-data-lg ${VERDICT[coverageHealth(metric.value, green)].ink}`} />
            <SampleNote metric={metric} />
          </div>
          <div className="min-w-0 space-y-2">
            <span className="typo-label text-foreground">{dl.lc2_coverage_trend}</span>
            {trend.length > 0 ? (
              <>
                <Sparkline
                  points={trend.map((v) => ({ value: v, tone: v >= green ? 'success' : v >= AMBER_FLOOR ? 'warning' : 'error' }))}
                  min={floor}
                  max={ceiling}
                  refs={[
                    { value: green, tone: 'success', label: formatNumeric(green, 'percent', { precision: 0 }) },
                    { value: AMBER_FLOOR, tone: 'warning', label: formatNumeric(AMBER_FLOOR, 'percent', { precision: 0 }) },
                  ]}
                  width={480}
                  height={120}
                  testId="lc2-coverage-trend"
                />
                <p className="typo-caption">{tx(dl.lc2_coverage_runs, { count: trend.length })}</p>
              </>
            ) : (
              <p className="typo-body text-foreground">{dl.lc2_coverage_no_trend}</p>
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
