/**
 * Every project's lifecycle snapshot, for the Lens portfolio. Read through
 * the page's own snapshot cache (`readLifecycleSnapshot`), so the portfolio
 * paints warm on a remount and every project the reader opens next is
 * already in.
 *
 * Loading pattern v2: the warm copies paint at once; the rest arrive a few at
 * a time (`CONCURRENCY`, each read walks a repo's git) and the portfolio
 * fills in as they land. A project whose read fails is counted and left out,
 * never drawn as empty. A `dev_lifecycle_*` write (`lifecycleRevision`)
 * revalidates; an unchanged reply keeps its object, so nothing re-renders.
 */
import { useEffect, useMemo, useState } from 'react';

import type { DevProject } from '@/lib/bindings/DevProject';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import { silentCatch } from '@/lib/silentCatch';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
import { useSystemStore } from '@/stores/systemStore';

import { peekLifecycleSnapshot, readLifecycleSnapshot } from '../../../journey/useLifecycleSnapshot';
import { buildPortfolio, type Portfolio } from '../model/portfolioModel';

const CONCURRENCY = 4;
const NO_PROJECTS: DevProject[] = [];

export interface UsePortfolio {
  portfolio: Portfolio | null;
  /** Projects known to the app. */
  total: number;
  /** Projects whose snapshot is in. */
  read: number;
  /** Projects whose read failed this round. */
  failed: number;
  /** No project list yet, or none of the snapshots are in. */
  loading: boolean;
}

function warmMap(projects: DevProject[]): Map<string, LifecycleSnapshot> {
  const m = new Map<string, LifecycleSnapshot>();
  for (const p of projects) {
    const s = peekLifecycleSnapshot(p.id);
    if (s) m.set(p.id, s);
  }
  return m;
}

export function usePortfolio(): UsePortfolio {
  const listed = useSystemStore((s) => s.projects) ?? NO_PROJECTS;
  // Keyed by what the portfolio draws, not by the array's identity: a store that hands back a new
  // array with the same projects must not restart every read (it did, in a loop).
  const listKey = listed.map((p) => `${p.id}|${p.name}|${p.github_url ?? ''}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => listed, [listKey]);
  const projectsLoading = useSystemStore((s) => s.projectsLoading);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const revision = useDevToolsLiveStore((s) => s.lifecycleRevision);
  const [snapshots, setSnapshots] = useState(() => warmMap(projects));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (projects.length === 0 && !projectsLoading) void fetchProjects();
    // Once: the list is the app's, kept fresh by its own writers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    const queue = projects.map((p) => p.id);
    const fails = new Set<string>();
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const s = await readLifecycleSnapshot(id, revision);
          if (!live) return;
          setSnapshots((prev) => {
            if (prev.get(id) === s) return prev;
            const next = new Map(prev);
            next.set(id, s);
            return next;
          });
        } catch (err) {
          silentCatch('lifecycle:portfolioRead')(err);
          fails.add(id);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(() => {
      // The same failures as last round keep the same set, so a quiet revision re-renders nothing.
      if (live) setFailed((prev) => (prev.size === fails.size && [...fails].every((id) => prev.has(id)) ? prev : fails));
    });
    return () => { live = false; };
  }, [projects, revision]);

  // `now` is read once per data change, so a re-render never moves "changed N days ago".
  const portfolio = useMemo(
    () => (snapshots.size ? buildPortfolio(projects, snapshots, Date.now()) : null),
    [projects, snapshots],
  );

  return {
    portfolio,
    total: projects.length,
    read: portfolio?.projects.length ?? 0,
    failed: failed.size,
    loading: !portfolio && (projectsLoading || projects.length > 0) && failed.size < projects.length,
  };
}
