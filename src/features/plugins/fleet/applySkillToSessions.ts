// Fan a slash command out to several sessions' PTYs at once.
//
// `SkillLibraryDrawer.onApply` wrote one command into the ONE focused session,
// so a morning of five awaiting agents was five trips through the drawer.
// Broadcast next door had already solved the same shape - bounded fan-out,
// per-item failure capture, retarget the misses - so this is that mechanic
// factored out rather than a second copy of it.
//
// The failed IDS are returned, not a count: "3 of 5" tells the operator that
// something went wrong and nothing about where, which with a fleet of
// interactive agents is the difference between a one-click retry and two
// sessions silently sitting on the old instruction.

import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { writeInput as writeInputApi } from '@/api/fleet/fleet';

/** Matches the broadcast composer's width. One small stdin write per session,
 *  so a handful of lanes already collapses the batch to a few round trips
 *  while a wedged PTY stalls only its own lane. */
export const APPLY_CONCURRENCY = 8;

export interface ApplyResult {
  total: number;
  sent: number;
  /** Session ids the write did not reach — the retry set. */
  failed: string[];
}

/**
 * Write `command` (with the trailing carriage return that submits it) to each
 * session id, at most `APPLY_CONCURRENCY` at a time.
 *
 * Each task swallows its own rejection: `mapWithConcurrency` is a worker pool
 * with fail-fast propagation, so an escaping error would abandon every session
 * still queued behind the wedged one.
 */
export async function applySkillToSessions(
  sessionIds: readonly string[],
  command: string,
  writeInput: (id: string, text: string) => Promise<unknown> = writeInputApi,
): Promise<ApplyResult> {
  const payload = `${command}\r`;
  const outcomes = await mapWithConcurrency(sessionIds, APPLY_CONCURRENCY, async (id) => {
    try {
      await writeInput(id, payload);
      return null;
    } catch (err) {
      silentCatch('features/plugins/fleet/applySkillToSessions')(err);
      return id;
    }
  });
  const failed = outcomes.filter((id): id is string => id !== null);
  return { total: sessionIds.length, sent: sessionIds.length - failed.length, failed };
}
