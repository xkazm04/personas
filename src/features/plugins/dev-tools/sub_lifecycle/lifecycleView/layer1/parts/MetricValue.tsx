// One metric, honestly: a formatted figure, or N/A when the value is unknown.
// `null` is never rendered as 0. N/A takes the caller's type role (an empty
// slot would read as a layout gap) and is letters, so it never reads as a figure.
import { Numeric } from '@/features/shared/components/display/Numeric';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { isRateKey, type StepMetric } from '../healthModel';

/** `className` is a type role from `system/lcType` (and, at most, a status ink). */
export function MetricValue({ metric, className = '' }: { metric: StepMetric; className?: string }) {
  const { dl } = useLifecycleViewModel();
  if (metric.value == null) {
    return <span className={className} data-na="true">{dl.lc1_na}</span>;
  }
  return metric.key === 'median_ms'
    ? <Numeric value={metric.value} unit="ms" className={className} />
    : <Numeric value={metric.value} unit="percent" precision={0} className={className} />;
}

/** "n = 12", shown only beside a known rate: a rate over 3 samples is not a rate over 300. */
export function SampleNote({ metric }: { metric: StepMetric }) {
  const { dl, tx } = useLifecycleViewModel();
  if (metric.value == null || !isRateKey(metric.key)) return null;
  return <span className={LT.metaNum}>{tx(dl.lc1_samples, { count: metric.samples })}</span>;
}
