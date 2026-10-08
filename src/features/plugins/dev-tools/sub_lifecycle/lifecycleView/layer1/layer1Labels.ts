// i18n + glyph lookups for the Layer-1 health vocabulary (verdicts, metric
// keys). The glyph is half of what keeps the six verdicts apart without
// colour; the other half is the stroke style in `healthModel.VERDICT`.
import { CircleCheck, CircleDashed, Clock, Info, OctagonX, TriangleAlert, type LucideIcon } from 'lucide-react';

import type { Translations } from '@/i18n/en';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleMetricKey } from '@/lib/bindings/LifecycleMetricKey';

type Dl = Translations['plugins']['dev_lifecycle'];

export function healthLabel(dl: Dl, health: LifecycleHealth): string {
  switch (health) {
    case 'green': return dl.lc1_health_green;
    case 'amber': return dl.lc1_health_amber;
    case 'red': return dl.lc1_health_red;
    case 'unmeasured': return dl.lc1_health_unmeasured;
    case 'instructed': return dl.lc1_health_instructed;
    case 'stale': return dl.lc1_health_stale;
  }
}

/** The verdict as a lowercase phrase inside a sentence ("Land is the weakest step: failing."). */
export function healthPhrase(dl: Dl, health: LifecycleHealth): string {
  switch (health) {
    case 'green': return dl.lc2_health_phrase_green;
    case 'amber': return dl.lc2_health_phrase_amber;
    case 'red': return dl.lc2_health_phrase_red;
    case 'unmeasured': return dl.lc2_health_phrase_unmeasured;
    case 'instructed': return dl.lc2_health_phrase_instructed;
    case 'stale': return dl.lc2_health_phrase_stale;
  }
}

export const HEALTH_GLYPH: Record<LifecycleHealth, LucideIcon> = {
  green: CircleCheck,
  amber: TriangleAlert,
  red: OctagonX,
  unmeasured: CircleDashed,
  instructed: Info,
  stale: Clock,
};

export function metricLabel(dl: Dl, key: LifecycleMetricKey): string {
  switch (key) {
    case 'median_ms': return dl.lc1_metric_median_ms;
    case 'pass_rate': return dl.lc1_metric_pass_rate;
    case 'coverage_pct': return dl.lc1_metric_coverage_pct;
    case 'docs_clean_pct': return dl.lc1_metric_docs_clean_pct;
    case 'done_rate': return dl.lc1_metric_done_rate;
  }
}

/** The step's one-line why: the backend's reason, else what a missing row means. */
export function reasonLine(dl: Dl, health: LifecycleHealth, reason: string | null): string {
  if (reason) return reason;
  if (health === 'instructed') return dl.lc1_reason_instructed;
  if (health === 'unmeasured') return dl.lc1_reason_unmeasured;
  return '';
}
