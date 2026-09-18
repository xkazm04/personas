// queueBoardTypes — the props every queue board variant takes.
//
// Kept apart from `QueueBoard` (which imports the variants) so a variant can
// import its props without closing a cycle.

import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { QueueModel } from './useQueueModel';
import type { QueueActions } from './useQueueActions';
import type { LocalOrder } from './useLocalOrder';

export interface QueueBoardProps {
  model: QueueModel;
  /** The queued rows as painted (optimistic) plus the reorder verbs. */
  order: LocalOrder;
  actions: QueueActions;
  /** Every registry row, for the lanes that read past the live set (Parked / Done). */
  sessions: readonly FleetSession[];
  teams: readonly PersonaTeam[];
  reducedMotion: boolean;
  focusKey: string | null;
  onOpenSession: (session: FleetSession) => void;
  onRecapSession: (session: FleetSession) => void;
}
