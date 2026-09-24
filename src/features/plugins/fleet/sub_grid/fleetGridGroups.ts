import {
  Hourglass,
  Loader2,
  CheckCircle2,
  Clock,
  Ban,
  Flag,
  Sparkle,
  Moon,
  ListOrdered,
} from 'lucide-react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetLabelKey } from '../FleetStatusDots';

// Visual order + label + icon for the per-state group headers in the Sessions
// list. Attention-grabbing first; terminal states last. The colour is not
// here: a group head reads its state's colour from FLEET_STATE_META
// (fleetStateTone.ts), the palette the summary pills above it already use.
interface FleetGroupMeta {
  id: FleetSessionState;
  /** plugins.fleet key for the group header label. */
  labelKey: FleetLabelKey;
  icon: typeof Hourglass;
}

export const GROUP_ORDER = [
  { id: 'awaiting_input', labelKey: 'state_awaiting_input', icon: Hourglass },
  { id: 'running',        labelKey: 'state_working',        icon: Loader2 },
  { id: 'queued',         labelKey: 'state_queued',         icon: ListOrdered },
  { id: 'spawning',       labelKey: 'state_spawning',       icon: Sparkle },
  { id: 'idle',           labelKey: 'state_idle',           icon: CheckCircle2 },
  { id: 'stale',          labelKey: 'state_stale',          icon: Clock },
  { id: 'finished',       labelKey: 'state_finished',       icon: Flag },
  { id: 'hibernated',     labelKey: 'state_hibernated',     icon: Moon },
  { id: 'exited',         labelKey: 'state_exited',         icon: Ban },
] as const satisfies ReadonlyArray<FleetGroupMeta>;

export type FleetGroup = (typeof GROUP_ORDER)[number];

// One authority per vocabulary: the grid is a consumer of FleetSessionState,
// so a state added to the binding without a row above must be a compile
// error here rather than a group that silently never renders (a `finished`
// session was unreachable on this page while the summary pill counted it).
type _StatesWithoutAGroup = Exclude<FleetSessionState, FleetGroup['id']>;
const _groupOrderIsExhaustive: _StatesWithoutAGroup extends never ? true : never = true;
void _groupOrderIsExhaustive;
