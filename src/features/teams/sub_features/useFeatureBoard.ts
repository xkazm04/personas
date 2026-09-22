// The Features page's one read.
//
// `getFeatureBoard(projectId)` returns the whole page in one payload, so this
// hook is a warm cache and a subscription and nothing else. Three properties it
// must keep:
//
//  1. A read FAILURE is not an empty board. `error` holds the raw value and the
//     surface resolves it at render through the error registry - the sentence a
//     person reads is never the one a producer emitted (census
//     `unresolved-error-as-inline-copy`).
//  2. A remount paints WARM. The page is a lazy route and fully unmounts on
//     nav-away, so the last board per project lives in a module cache that
//     names its ceiling.
//  3. `dev-tools://council-changed` invalidates. An ingest, a decision or a
//     tier change anywhere in the app moves this board.
import { useCallback, useEffect, useState } from 'react';

import { getFeatureBoard } from '@/api/devTools/features';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import type { FeatureBoard } from '@/lib/bindings/FeatureBoard';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';

/** ONE Tauri listener for the whole app, however many surfaces are mounted. */
const onCouncilChangedEvent = createSingletonListener<{ projectId?: string | null }>(
  EventName.DEV_TOOLS_COUNCIL_CHANGED,
);

/** Warm cache keyed by project id, so it names its ceiling rather than growing
 *  for the life of the process. */
const boardCache = createModuleCache<string, FeatureBoard>({ ttlMs: 60_000, maxSize: 8 });

/** Test hatch: drop every cached board. */
export function resetFeatureBoardCache(): void {
  boardCache.invalidateAll();
}

export interface FeatureBoardResult {
  board: FeatureBoard | null;
  /** A fetch is in flight and nothing warm is on screen yet. */
  loading: boolean;
  /** The raw failure VALUE, resolved at render. Never a pre-baked sentence. */
  error: unknown;
  refresh: () => void;
}

/**
 * @param projectId the project to read, or null while none is active.
 * @param fixtureBoard a DEV fixture board that REPLACES the read entirely.
 *   When present nothing is fetched and no failure can occur, which is what
 *   makes the fixture usable beside a store that cannot answer.
 */
export function useFeatureBoard(
  projectId: string | null,
  fixtureBoard: FeatureBoard | null,
): FeatureBoardResult {
  const cached = useModuleSubscription(boardCache, projectId ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (fixtureBoard) {
      setError(null);
      setLoading(false);
      return;
    }
    if (!projectId) {
      setError(null);
      return;
    }
    let cancelled = false;
    if (boardCache.get(projectId) === undefined) setLoading(true);
    getFeatureBoard(projectId)
      .then((board) => {
        if (cancelled) return;
        boardCache.set(projectId, board);
        boardCache.notify();
        setError(null);
      })
      .catch((err: unknown) => {
        // Sentry gets the raw error here; the surface resolves the SAME value
        // into a translated sentence at render.
        silentCatch('useFeatureBoard:getFeatureBoard')(err);
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce, fixtureBoard]);

  const onCouncilChanged = useCallback(() => {
    if (projectId) boardCache.invalidate(projectId);
    refresh();
  }, [projectId, refresh]);
  onCouncilChangedEvent(onCouncilChanged);

  if (fixtureBoard) {
    return { board: fixtureBoard, loading: false, error: null, refresh };
  }
  return {
    board: cached ?? null,
    loading: loading && cached === undefined,
    error,
    refresh,
  };
}
