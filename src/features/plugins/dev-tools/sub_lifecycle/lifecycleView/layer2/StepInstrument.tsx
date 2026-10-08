// The step's instrument: its icon at the centre of the ring that draws its
// main rate - the screen's ONE hero figure - and every other number it is
// judged by as a satellite card around it (median time, pass rate,
// coverage...). Nothing measured draws a dashed ring and N/A; an instructed
// step draws a hairline and says so.
import { stepGlyph } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { isRateKey, type HealthStep, type StepMetric, VERDICT } from '../layer1/healthModel';
import { metricLabel } from '../layer1/layer1Labels';
import { ArcGauge } from '../layer1/parts/ArcGauge';
import { MetricValue, SampleNote } from '../layer1/parts/MetricValue';
import { lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';

const MEASURED: ReadonlySet<HealthStep['health']> = new Set(['green', 'amber', 'red', 'stale']);

function Satellite({ step, metric }: { step: HealthStep; metric: StepMetric }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className={`flex min-w-[10rem] items-center gap-3 ${lcSurface('card')}`} data-testid={`lc2-metric-${metric.key}`}>
      {/* A satellite's ring speaks the step's verdict, so a step that is not measured as a whole draws none
          rather than an empty dashed ring beside a real figure. */}
      {isRateKey(metric.key) && MEASURED.has(step.health) && <ArcGauge health={step.health} ratio={metric.ratio} size="sm" />}
      <div className="flex min-w-0 flex-col">
        <span className={LT.label}>{metricLabel(dl, metric.key)}</span>
        <MetricValue metric={metric} className={LT.stat} />
        <SampleNote metric={metric} />
      </div>
    </div>
  );
}

export function StepInstrument({ step }: { step: HealthStep }) {
  const { dl } = useLifecycleViewModel();
  const Glyph = stepGlyph(step.node.id);
  const main = step.metrics.find((m) => isRateKey(m.key)) ?? null;
  const rest = step.metrics.filter((m) => m !== main);
  const ink = VERDICT[step.health].ink;
  return (
    <div className="flex flex-wrap items-center justify-center gap-5" data-testid="lc2-instrument">
      <div className="flex flex-col items-center gap-1" data-testid={main ? `lc2-metric-${main.key}` : undefined}>
        <ArcGauge health={step.health} ratio={main?.ratio ?? null} size="lg">
          <span className="flex flex-col items-center">
            <Glyph className={`${GLYPH.xl} ${ink}`} aria-hidden />
            {main
              ? <MetricValue metric={main} className={LT.hero} />
              : <span className={LT.label}>{step.health === 'instructed' ? dl.lc1_health_instructed : dl.lc1_na}</span>}
          </span>
        </ArcGauge>
        {main && <span className={LT.label}>{metricLabel(dl, main.key)}</span>}
        {main && <SampleNote metric={main} />}
      </div>
      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          {rest.map((m) => <Satellite key={m.key} step={step} metric={m} />)}
        </div>
      )}
    </div>
  );
}
