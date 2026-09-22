// Council state for one project, joined with the Fleet sessions running it.
//
// Three sources, one shape:
//  1. `listCouncilSubjects(projectId)` — the DERIVED state per subject, read
//     once per project into a module-scoped warm cache so reopening the
//     popover paints warm instead of re-ghosting.
//  2. `dev-tools://council-changed` — the store moved (ingest door, decide
//     command, tier change). Attached through `createSingletonListener`, which
//     owns the subscription lifecycle AND buffers what lands between mount and
//     the `listen()` promise resolving, so the window before the listener is
//     live is covered rather than silently lost (the snapshot in (1) covers the
//     rest). Never a bare `listen()`.
//  3. The Fleet registry — a live `/council` session in this repo overlays
//     `running`, which is NEVER stored.
//
// A read FAILURE is not an empty list: `error` is non-null and the caller
// surfaces it, because "no subject has been councilled" and "we could not ask"
// are different worlds and only one of them means the glyphs are honest.
import { useCallback, useEffect, useRef, useState } from 'react';

import { listCouncilSubjects, ingestCouncilRuns } from '@/api/devTools/council';
import { listSessions } from '@/api/fleet/fleet';
import { sessionRunsSkill } from '@/features/plugins/dev-tools/sub_skills/launch/useSkillLaunch';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import { createModuleCache, useModuleSubscription } from '@/hooks/utility/data/useModuleSubscription';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { EventName } from '@/lib/eventRegistry';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import { councilFleetKey } from './councilDispatch';

/** Poll cadence for the Fleet snapshot while a council surface is mounted.
 *  Matches `useSkillLaunch`'s: the store's copy is stale unless the Fleet tab
 *  was opened, so the surface asks the registry itself. */
const SESSION_POLL_MS = 5_000;

/** ONE Tauri listener for the whole app however many chips are open. */
const onCouncilChangedEvent = createSingletonListener<{ projectId?: string | null }>(
  EventName.DEV_TOOLS_COUNCIL_CHANGED,
);

/** Warm cache for the per-project subject list. Keyed by project id, so it
 *  names its ceiling rather than growing for the life of the process. */
const councilCache = createModuleCache<string, CouncilSubjectState[]>({
  ttlMs: 60_000,
  maxSize: 12,
});

/** Test hatch: drop every cached project. */
export function resetCouncilCache(): void {
  councilCache.invalidateAll();
}

export interface CouncilStatesResult {
  /** Subject state by `useCaseId`. Absent = the subject has no council row. */
  byUseCaseId: Map<string, CouncilSubjectState>;
  /** Fleet keys with a live `/council` session in this repo. */
  runningKeys: Set<string>;
  /** A fetch is in flight and nothing warm is on screen yet. */
  loading: boolean;
  /** Non-null when the READ failed. Never conflated with an empty list. */
  error: boolean;
  refresh: () => void;
}

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

export function useCouncilStates(
  projectId: string | null,
  projectRoot: string | null,
): CouncilStatesResult {
  const cached = useModuleSubscription(councilCache, projectId ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [runningKeys, setRunningKeys] = useState<Set<string>>(() => new Set(EMPTY_KEYS));
  const prevRunning = useRef<Set<string>>(new Set<string>());

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setError(false);
      return;
    }
    let cancelled = false;
    if (councilCache.get(projectId) === undefined) setLoading(true);
    listCouncilSubjects(projectId)
      .then((rows) => {
        if (cancelled) return;
        councilCache.set(projectId, rows);
        councilCache.notify();
        setError(false);
      })
      .catch((err: unknown) => {
        silentCatch('useCouncilStates:listCouncilSubjects')(err);
        // The popover renders its own translated sentence, so only the FACT of the
        // failure is kept; the raw error went to Sentry through silentCatch above.
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  // The store moved somewhere else in the app — drop the warm copy and refetch.
  const onCouncilChanged = useCallback(() => {
    if (projectId) councilCache.invalidate(projectId);
    refresh();
  }, [projectId, refresh]);
  onCouncilChangedEvent(onCouncilChanged);

  // Fleet liveness: which subjects have a session, and which just lost one.
  useEffect(() => {
    if (!projectId || !projectRoot) {
      setRunningKeys(new Set(EMPTY_KEYS));
      return;
    }
    let alive = true;
    const poll = () => {
      listSessions()
        .then((snap) => {
          if (!alive) return;
          const live = new Set<string>();
          for (const s of snap.sessions) {
            if (!sessionRunsSkill({ args: s.args, cwd: s.cwd, state: String(s.state) }, 'council', projectRoot)) {
              continue;
            }
            if (s.name) live.add(s.name);
          }
          const exited = [...prevRunning.current].filter((k) => !live.has(k));
          prevRunning.current = live;
          setRunningKeys(live);
          if (exited.length > 0) {
            // The ticker sweeps too; this just moves the glyph promptly.
            ingestCouncilRuns(projectId)
              .then(() => onCouncilChanged())
              .catch(toastCatch('council ingest'));
          }
        })
        .catch(silentCatch('useCouncilStates:listSessions'));
    };
    poll();
    const id = window.setInterval(poll, SESSION_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [projectId, projectRoot, onCouncilChanged]);

  const byUseCaseId = new Map<string, CouncilSubjectState>();
  for (const row of cached ?? []) {
    if (row.useCaseId) byUseCaseId.set(row.useCaseId, row);
  }

  return {
    byUseCaseId,
    runningKeys,
    loading: loading && cached === undefined,
    error,
    refresh,
  };
}

/** Is a `/council` session live for this subject? */
export function isCouncilRunning(
  runningKeys: ReadonlySet<string>,
  projectId: string,
  slug: string,
): boolean {
  return runningKeys.has(councilFleetKey(projectId, slug));
}
