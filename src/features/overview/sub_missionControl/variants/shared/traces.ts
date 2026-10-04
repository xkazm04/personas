// A small series per dimension for a drawn trace, where the page has one.
// Values are normalised 0..1 by the caller's figure; null = no trace.

import type { DimId } from './dimensions';
import type { MissionReadings } from './useMissionReadings';

export function traceOf(r: MissionReadings, id: DimId): number[] | null {
  switch (id) {
    case 'outcomes':
      return r.points.length ? r.points.map((p) => (p.runs > 0 ? (p.runs - p.failed) / p.runs : 0)) : null;
    case 'spend':
      return r.points.length ? r.points.map((p) => p.cost) : null;
    case 'agents':
      return r.entries.length ? r.entries.map((e) => e.score / 100) : null;
    case 'queue':
      return r.queue.status === 'ready' ? [r.queue.value.alerts, r.queue.value.reviews, r.queue.value.memory, r.queue.value.reports] : null;
    default:
      return null;
  }
}
