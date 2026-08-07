/**
 * Token-delta coalescing for `--include-partial-messages` streams.
 *
 * Claude's CLI emits a `text_delta` per token. Writing each one straight into
 * Zustand would mean hundreds of store notifications a second; instead deltas
 * accumulate per conversation and land in ONE write per conversation per
 * animation frame.
 *
 * Keyed by conversation id because turns stream concurrently across threads. A
 * conversation joins `sawDeltas` the moment a delta arrives for its turn; once
 * present, the trailing whole `assistant` message for that turn is ignored — it
 * duplicates what the deltas already appended.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useCompanionStore } from '../companionStore';

export interface AthenaChatDeltas {
  /** Buffer a delta and schedule a flush. */
  push: (conversationId: string, delta: string) => void;
  /** Land everything buffered now (turn end, error, or before a refetch). */
  flush: () => void;
  /** True once this conversation's turn has produced at least one delta. */
  sawDeltas: (conversationId: string) => boolean;
  /** New turn (or turn over) — drop this conversation's bookkeeping. */
  reset: (conversationId: string) => void;
}

export function useAthenaChatDeltas(): AthenaChatDeltas {
  const sawDeltasRef = useRef<Set<string>>(new Set());
  const buffersRef = useRef<Map<string, string>>(new Map());
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (buffersRef.current.size === 0) return;
    const { appendLiveText } = useCompanionStore.getState();
    for (const [conversationId, chunk] of buffersRef.current) {
      if (chunk) appendLiveText(conversationId, chunk);
    }
    buffersRef.current.clear();
  }, []);

  const push = useCallback(
    (conversationId: string, delta: string) => {
      sawDeltasRef.current.add(conversationId);
      buffersRef.current.set(
        conversationId,
        (buffersRef.current.get(conversationId) ?? '') + delta,
      );
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const sawDeltas = useCallback(
    (conversationId: string) => sawDeltasRef.current.has(conversationId),
    [],
  );

  const reset = useCallback((conversationId: string) => {
    sawDeltasRef.current.delete(conversationId);
    buffersRef.current.delete(conversationId);
  }, []);

  // Stable identity: the stream listener lists this object in its dependency
  // array, and a fresh object every render would re-subscribe the Tauri event
  // on each one.
  return useMemo(
    () => ({ push, flush, sawDeltas, reset }),
    [push, flush, sawDeltas, reset],
  );
}
