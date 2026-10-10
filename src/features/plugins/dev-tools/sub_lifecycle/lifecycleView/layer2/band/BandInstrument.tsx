// The band's instrument: the step's main rate as the screen's ONE hero figure
// beside its dial (a small ring drawing the share in the verdict's ink), its
// name and n under it, then every other number the step is judged by as a
// tight satellite with its own change since the earlier measure. Nothing
// measured draws a dashed dial and N/A; an instructed step draws a hairline
// and says so. Clustered at the band's right edge, at the height of the step's
// three lines, so the band stays one compact band.
import { stepChange, type MetricDelta } from '../../layer1/delta';
import { isRateKey, VERDICT, type HealthStep, type StepMetric } from '../../layer1/healthModel';
import { metricLabel } from '../../layer1/layer1Labels';
import { ArcGauge } from '../../layer1/parts/ArcGauge';
import { MetricValue, SampleNote } from '../../layer1/parts/MetricValue';
import { DeltaMark } from '../../layer1/rail/DeltaMark';
import { useLifecycleViewModel } from '../../context';
import { BAND, lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';

const DIALLED: ReadonlySet<HealthStep['health']> = new Set(['green', 'amber', 'red', 'stale']);

function Satellite({ metric, delta }: { metric: StepMetric; delta: MetricDelta | null }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={`flex min-w-0 flex-col ${lcSurface('chip')}`} data-testid={`lc2-metric-${metric.key}`}>
      <span className={LT.label}>{metricLabel(dl, metric.key)}</span>
      <span className="flex items-baseline gap-2">
        <MetricValue metric={metric} className={LT.stat} />
        <SampleNote metric={metric} />
        <DeltaMark delta={delta} />
      </span>
    </div>
  );
}

export function BandInstrument({ step }: { step: HealthStep }) {
  const { dl } = useLifecycleViewModel();
  const main = step.metrics.find((m) => isRateKey(m.key)) ?? null;
  const rest = step.metrics.filter((m) => m !== main);
  const change = stepChange(step);
  const deltaOf = (m: StepMetric) => change?.metrics.find((d) => d.key === m.key) ?? null;
  const ink = VERDICT[step.health].ink;
  return (
    <div className="flex items-center gap-5" data-testid="lc2-instrument">
      <div className="flex items-center gap-3" data-testid={main ? `lc2-metric-${main.key}` : undefined}>
        <ArcGauge health={step.health} ratio={DIALLED.has(step.health) ? main?.ratio ?? null : null} size="sm" />
        <div className="flex min-w-0 flex-col">
          {main
            ? <MetricValue metric={main} className={`${LT.hero} ${ink}`} />
            : <span className={LT.stat} data-na={step.health === 'instructed' ? undefined : 'true'}>{step.health === 'instructed' ? dl.lcx2_by_instruction : dl.lc1_na}</span>}
          <span className="flex items-baseline gap-2">
            <span className={LT.label}>{main ? metricLabel(dl, main.key) : dl.lcx2_by_instruction_note}</span>
            {main && <SampleNote metric={main} />}
            {/* Narrow, the meta line has no room for the change: it sits here, by its figure. */}
            {main && <span className={BAND.narrowOnly}><DeltaMark delta={deltaOf(main)} /></span>}
          </span>
        </div>
      </div>
      {rest.length > 0 && (
        <div className="flex items-stretch gap-2">
          {rest.map((m) => <Satellite key={m.key} metric={m} delta={deltaOf(m)} />)}
        </div>
      )}
    </div>
  );
}
