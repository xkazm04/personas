/**
 * The side-effect half of turn sidecars: one fire-and-forget write at
 * attach time, one batched read at conversation-load time.
 *
 * Write — `persistTurnSidecar(episodeId)` is called from CompanionPanel
 * right after the store's attach actions have promoted the in-flight
 * channels onto the assistant episode id. It reads them straight back out
 * of the store (single source of truth, no duplicated parsing) and posts
 * them. It NEVER blocks or fails a turn: an error is a `silentCatch`
 * breadcrumb and the session-scoped behaviour is unchanged.
 *
 * Read — `useTurnSidecarHydration()` watches the transcript and batch-
 * fetches sidecars for assistant messages it hasn't looked up yet, then
 * merges them into the store maps the render paths already read.
 *
 * Serialization lives in `turnSidecars.ts` (pure, tested).
 */

import { useEffect, useRef } from 'react';
import {
  companionGetTurnSidecars,
  companionSaveTurnSidecar,
  type CompanionMessage,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from './companionStore';
import { isEmptyHydration, parseSidecars, serializeSidecar } from './turnSidecars';

/**
 * Snapshot the four channels currently attached to `episodeId` and
 * persist them. Fire-and-forget by design — the caller is on the
 * `finished` / `turn-summary` event path and must not await IPC.
 */
export function persistTurnSidecar(episodeId: string): void {
  if (!episodeId) return;
  const s = useCompanionStore.getState();
  const payload = serializeSidecar(episodeId, {
    narration: s.narrationByEpisodeId[episodeId],
    steps: s.stepsByEpisodeId[episodeId],
    summary: s.turnSummaryByEpisodeId[episodeId],
    recall: s.recallByEpisodeId[episodeId],
  });
  if (!payload) return;
  void companionSaveTurnSidecar(payload).catch(silentCatch('companion_save_turn_sidecar'));
}

/**
 * Backend clamp on ids per `companion_get_turn_sidecars` call. Kept in
 * sync with `MAX_BATCH_IDS` in `commands/companion/sidecars.rs` — a
 * full-transcript export can ask for more than one batch holds.
 */
const SIDECAR_BATCH_SIZE = 500;

/** Batch-read sidecars for arbitrarily many episode ids, chunked. */
export async function fetchSidecarsFor(
  episodeIds: string[],
): Promise<Awaited<ReturnType<typeof companionGetTurnSidecars>>> {
  const chunks: string[][] = [];
  for (let i = 0; i < episodeIds.length; i += SIDECAR_BATCH_SIZE) {
    chunks.push(episodeIds.slice(i, i + SIDECAR_BATCH_SIZE));
  }
  const pages = await Promise.all(chunks.map((c) => companionGetTurnSidecars(c)));
  return pages.flat();
}

/**
 * Hydrate persisted sidecars for the visible transcript.
 *
 * Dedupe is by episode id in a ref, not by store contents: an id whose
 * lookup came back empty must not be re-fetched on every render. The ref
 * is intentionally NOT cleared when the conversation changes — episode
 * ids are globally unique, so a cross-thread cache is free and correct.
 */
export function useTurnSidecarHydration(messages: CompanionMessage[]): void {
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const wanted = messages
      .filter((m) => m.role === 'assistant' && m.id && !fetchedRef.current.has(m.id))
      .map((m) => m.id);
    if (wanted.length === 0) return;
    // Mark before the await so a re-render mid-flight doesn't re-request.
    for (const id of wanted) fetchedRef.current.add(id);

    let cancelled = false;
    companionGetTurnSidecars(wanted)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        const hydrated = parseSidecars(rows);
        if (isEmptyHydration(hydrated)) return;
        useCompanionStore.getState().hydrateTurnSidecars(hydrated);
      })
      .catch((e) => {
        // Allow a retry on the next transcript change — a transient IPC
        // failure shouldn't permanently blank these turns' side channels.
        for (const id of wanted) fetchedRef.current.delete(id);
        silentCatch('companion_get_turn_sidecars')(e);
      });

    return () => {
      cancelled = true;
    };
  }, [messages]);
}
