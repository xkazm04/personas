import type { DeskForecast } from '../deskForecast';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import type { RailNext } from '../parts/NoteLifecycleRail';

/** Everything a row needs to know about one goal that is not on the goal itself.
 *  Assembled once for the whole desk by `QuestLogOverview`, never per row. */
export interface GoalSignals {
  /** Unread entries from an agent or Athena. The operator's own comments are
   *  born read, so any unread count means somebody is waiting on a reading. */
  unread: number;
  /** An agent or Athena is on this goal right now; ISO start of the work. */
  workingSince: string | null;
  /** Whole days past the milestone's target date, or 0. */
  lateDays: number;
  /** On the rail the operator is currently looking down. Off-rail rows dim in
   *  place — the rail is a lens, not a filter. */
  onRail: boolean;
}

export const NO_SIGNALS: GoalSignals = Object.freeze({ unread: 0, workingSince: null, lateDays: 0, onRail: true });

/** What the second row needs, assembled by the desk for the selected goal only. */
export interface RowDetail {
  summary?: NotePlanSummary;
  forecast?: DeskForecast;
  onAdvance: (next: RailNext) => Promise<void>;
}
