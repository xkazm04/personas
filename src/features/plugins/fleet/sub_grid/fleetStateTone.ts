import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FLEET_STATE_META } from '../fleetStateMeta';

/**
 * The text colour `FLEET_STATE_META` gives a lifecycle state. The Sessions
 * group heads, the hibernated panel and the Settings cards that name a state
 * (auto-hibernate, stale cutoffs) read it here, so a state wears one colour
 * wherever it is shown instead of a second palette step picked per call site.
 */
export function stateText(state: FleetSessionState): string {
  return FLEET_STATE_META.find((m) => m.id === state)?.text ?? 'text-foreground';
}
