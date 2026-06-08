import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { FeedFilter } from './types';

/* The combined-stream noise filter. Pure + standalone so it can be unit-tested. */

/** Step kinds that are routine machine churn — hidden in `signal`/`alerts`. */
const ROUTINE_STEPS = new Set(['step_running', 'step_done', 'step_skipped', 'created', 'paused', 'status_done']);
/** Step kinds that demand attention — the only ones kept in `alerts`. */
const ALERT_STEPS = new Set(['step_failed', 'status_awaiting_review', 'qa_changes_requested_rework']);

/** True when an item should be shown under the given filter. */
export function matchesFilter(item: TeamChannelItem, filter: FeedFilter): boolean {
  if (filter === 'all') return true;
  const isAlert = item.kind === 'step' && ALERT_STEPS.has(item.label);
  if (filter === 'alerts') return isAlert || item.kind === 'directive';
  // 'signal' — drop routine step churn, keep everything with human meaning.
  if (item.kind === 'step' && ROUTINE_STEPS.has(item.label)) return false;
  return true;
}
