// Auto-ingest finished practice-harvest runs — closes the agent loop so a
// completed harvest lands in the library without a human poke.
//
// This is the harvest twin of the kpi-sim primitive (KpiSimControl.tsx): poll
// the Fleet registry, and when a dispatched session's WORK ends, ingest its
// run. "Ends" means settling out of the active states — for an interactive CLI
// session that is `idle` (the prompt), NOT `exited`: a finished session sits
// idle forever (live-test finding, 2026-07-23). Ingest is idempotent (the
// run-dir `ingested.json` marker), so firing on idle/exit/vanish after an
// active phase is safe.
//
// Difference from kpi-sim: that control owns ONE session; a workspace harvests
// N member projects concurrently, so liveness is tracked per dispatch key and
// each project ingests independently.
import { useCallback, useEffect, useRef } from 'react';

import { listSessions } from '@/api/fleet/fleet';
import { ingestWorkspaceHarvest } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

import { harvestDispatchKey } from './practiceHarvestPrompt';

/** Fleet states that mean the session is still doing work. */
const ACTIVE = new Set(['spawning', 'running', 'awaiting_input']);

const POLL_MS = 5000;

export function useHarvestAutoIngest({
  workspaceId,
  memberProjects,
  onIngested,
}: {
  workspaceId: string;
  memberProjects: DevProject[];
  /** Refresh the library after a successful auto-ingest. */
  onIngested: () => void;
}) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const addToast = useToastStore((s) => s.addToast);

  /** dispatch key → was the session active on the previous poll. */
  const wasLive = useRef<Map<string, boolean>>(new Map());
  /** project ids with an ingest in flight — prevents a double fire. */
  const ingesting = useRef<Set<string>>(new Set());

  /** Mark a just-dispatched project live, so a fast-settling session still
   *  produces a running→gone transition even if the first poll misses it. */
  const markLive = useCallback((projectId: string) => {
    wasLive.current.set(harvestDispatchKey(workspaceId, projectId), true);
  }, [workspaceId]);

  // Keep the identity of the member list stable across renders.
  const memberKey = memberProjects.map((p) => p.id).join(',');

  useEffect(() => {
    if (!workspaceId || memberProjects.length === 0) return;
    let alive = true;

    const autoIngest = (project: DevProject) => {
      if (ingesting.current.has(project.id)) return;
      ingesting.current.add(project.id);
      ingestWorkspaceHarvest(workspaceId, project.id)
        .then((summary) => {
          if (!alive) return;
          addToast(
            tx(tw.harvest_auto_imported, {
              project: project.name,
              inserted: summary.inserted,
              skipped: summary.skipped.length,
            }),
            summary.inserted > 0 ? 'success' : 'warning',
          );
          onIngested();
        })
        // A settled session with no un-ingested run is the normal case on the
        // auto path (an aborted harvest, or one already imported by hand) —
        // stay quiet here; the manual Import reports loudly.
        .catch(silentCatch('workspaces:harvestAutoIngest'))
        .finally(() => { ingesting.current.delete(project.id); });
    };

    const poll = () => {
      listSessions()
        .then((snap) => {
          if (!alive) return;
          for (const project of memberProjects) {
            const key = harvestDispatchKey(workspaceId, project.id);
            const session = snap.sessions.find((s) => s.name === key) ?? null;
            const active = session !== null && ACTIVE.has(String(session.state));
            if (wasLive.current.get(key) && !active) autoIngest(project);
            wasLive.current.set(key, active);
          }
        })
        .catch(silentCatch('workspaces:harvestPoll'));
    };

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, memberKey, addToast, tx, tw, onIngested]);

  return { markLive };
}
