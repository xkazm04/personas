/**
 * Header actions that touch both the store and the backend.
 *
 * Kept out of the header component because each one has a rationale longer
 * than its body: they exist to keep the Zustand mirror and the server-side
 * settings row from drifting apart.
 */

import {
  companionCancelAutonomy,
  companionListRecentMessages,
  companionResetConversation,
  companionSetAutonomousMode,
  companionSetDevMode,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';

/**
 * The "make this go away" button. Clears every UI channel immediately so the
 * wipe feels instant, then wipes the SQL transcript AND the CLI session pointer
 * server-side — so the next send sees an empty transcript and (if identity.md
 * is still placeholder-shaped) re-enters onboarding mode.
 */
export async function resetConversation(): Promise<void> {
  const store = useCompanionStore.getState();
  store.setMessages([]);
  store.setApprovals([]);
  store.setQuickReplies([]);
  store.setChatCards([]);
  store.setPendingPlayback(null);
  // Reset must clear the prior turn's error chip too — without this a timeout
  // from a stuck CLI lingers across sessions.
  store.setSendError(null);
  store.clearAllRecall();
  store.clearAllTurnSummaries();
  store.clearAllConnectorJobs();
  store.clearAllSteps();
  store.clearAllNarration();
  const conversationId = store.activeConversationId;
  try {
    await companionResetConversation(true, conversationId);
  } catch (err: unknown) {
    // Refetch so the UI reflects whatever actually stuck on the backend.
    companionListRecentMessages(50, conversationId)
      .then((msgs) => useCompanionStore.getState().setMessages(msgs))
      .catch(silentCatch('companion_list_recent_messages'));
    silentCatch('companion_reset_conversation')(err);
  }
}

/**
 * Flip autonomous mode. Persisted server-side because the backend proactive
 * scheduler decides whether to spawn self-initiated reasoning turns and cannot
 * see the Zustand flag.
 */
export function setAutonomousMode(next: boolean): void {
  useSystemStore.getState().setCompanionAutonomousMode(next);
  companionSetAutonomousMode(next).catch(silentCatch('companion_set_autonomous_mode'));
  if (!next) {
    // Switching OFF drops any scheduled continuation, so a tick that was about
    // to fire can't sneak through after the user explicitly opted out.
    companionCancelAutonomy().catch(silentCatch('companion_cancel_autonomy'));
  }
}

/** Flip dev mode. The prompt assembler and `dev_improve` read the settings row. */
export function setDevMode(next: boolean): void {
  useSystemStore.getState().setCompanionDevMode(next);
  companionSetDevMode(next).catch(silentCatch('companion_set_dev_mode'));
}
