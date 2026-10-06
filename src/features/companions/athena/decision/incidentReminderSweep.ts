/**
 * incidentReminderSweep — retire Athena's `incident_blocker` reminders once
 * nothing is blocking any more.
 *
 * The backend mints ONE `incident_blocker` proactive message covering every
 * open high/critical incident (`incident_triggers.rs`). The orb used to consume
 * it (engage / dismiss); now the orb decides the incidents themselves from the
 * Decision Center roster, so nothing would ever retire the reminder and it
 * would sit in Athena's chat (`ProactiveCard`) and her attention bar
 * (`attentionKinds`) after the incidents it points at were long settled. No
 * chat surface filters stale proactive kinds, so the retirement lives here, at
 * the one place that knows an incident verdict just landed.
 *
 * Runs after the orb resolves or dismisses an incident: re-reads the counts
 * (joining the read the roster's `decide` already started), and only when that
 * read ANSWERED and says `blockingIncidents === 0` dismisses every outstanding
 * `incident_blocker` message through `companionDismissProactive`. A failed or
 * still-positive count leaves the reminders alone — a reminder about a real
 * blocker must not be swept because a read failed.
 *
 * Background hygiene: the caller reports a rejection to `silentCatch`; it never
 * fails the decision that triggered it.
 */
import { companionDismissProactive, companionListProactiveMessages } from '@/api/companion';
import {
  getPendingCountsStatus,
  refreshDecisionCounts,
} from '@/features/decision-center/roster/pendingCountsSource';
import { useSystemStore } from '@/stores/systemStore';

import { useAthenaStore } from '../athenaStore';

const REMINDER_KIND = 'incident_blocker';
/** The backend keeps one per window; this bounds a pathological backlog. */
const LIST_LIMIT = 50;

/**
 * Dismiss outstanding `incident_blocker` reminders when no incident blocks.
 * Resolves with how many were dismissed; REJECTS with the first failed dismissal
 * (every dismissal is still attempted).
 */
export async function sweepIncidentReminders(): Promise<number> {
  await refreshDecisionCounts();
  if (getPendingCountsStatus().failed) return 0;
  const pending = useSystemStore.getState().pendingCounts;
  if (!pending || pending.blockingIncidents > 0) return 0;

  const ids = new Set<string>();
  for (const m of await companionListProactiveMessages(true, LIST_LIMIT)) {
    if (m.triggerKind === REMINDER_KIND) ids.add(m.id);
  }
  // Ones already delivered into Athena's store but past the list window.
  for (const m of useAthenaStore.getState().proactive) {
    if (m.triggerKind === REMINDER_KIND) ids.add(m.id);
  }
  if (ids.size === 0) return 0;

  const results = await Promise.allSettled(
    [...ids].map(async (id) => {
      await companionDismissProactive(id);
      useAthenaStore.getState().removeProactive(id);
    }),
  );
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
  return ids.size;
}
