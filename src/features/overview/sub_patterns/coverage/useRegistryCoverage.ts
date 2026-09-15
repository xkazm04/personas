// Data hook for the Coverage lane (registry-coverage-ui R2).
//
// Registry resolution: coverage is REGISTRY-grain (plan D7) — the first
// paired registry with a working copy, by id, not a per-workspace picker.
// When several registries are paired the lane shows the first and names it.
//
// Loading doctrine (loading-v2 law 4): a module-scoped warm cache keyed by
// registry id means a remount paints warm instead of re-ghosting; a failed
// refresh KEEPS the warm copy and surfaces the error beside it — failure is
// not emptiness.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { getRegistryCoverage } from '@/api/devTools/registryCoverage';
import {
  registryLinkSnapshot,
  subscribeRegistryLinks,
  type Registry,
} from '@/features/plugins/dev-tools/sub_workspaces/registry/registryLinkStore';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { RegistryCoverage } from '@/lib/bindings/RegistryCoverage';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { buildTileView, type TileView } from './coverageModel';

export interface CoverageData {
  coverage: RegistryCoverage;
  tiles: TileView[];
}

export interface RegistryCoverageState {
  /** The registry shown, or null when none is paired with a working copy. */
  registry: Registry | null;
  /** Other paired registries NOT shown (the "showing X" note renders when > 0). */
  othersCount: number;
  data: CoverageData | null;
  loading: boolean;
  /** Last refresh failure. Non-null with `data` present = stale-but-warm. */
  error: string | null;
  refetch: () => void;
}

/** Warm cache keyed by registry id — survives lane unmount/remount so a
 *  navigation back paints the last known coverage instantly.
 *  `createModuleCache` gives it a `maxSize` eviction door rather than a bare
 *  `Map` (see docs/concepts/golden-paths/shared-fetch-cache.md §12 item 10). */
const warmCache = createModuleCache<string, CoverageData>({ maxSize: 32 });

export function useRegistryCoverage(): RegistryCoverageState {
  const snapshot = useSyncExternalStore(
    subscribeRegistryLinks,
    registryLinkSnapshot,
    registryLinkSnapshot,
  );

  const paired = useMemo(
    () =>
      Object.values(snapshot.registries)
        .filter((r) => r.state === 'paired' && r.clonePath.trim().length > 0)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [snapshot],
  );
  const registry = paired[0] ?? null;
  const othersCount = Math.max(0, paired.length - 1);

  const projects = useSystemStore((s) => s.projects);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  useEffect(() => {
    if (projects.length === 0) void fetchProjects();
  }, [projects.length, fetchProjects]);

  const registryId = registry?.id ?? null;
  const clonePath = registry?.clonePath ?? null;

  const [data, setData] = useState<CoverageData | null>(() =>
    registryId ? (warmCache.get(registryId) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);

  const refetch = useCallback(() => setGen((g) => g + 1), []);

  useEffect(() => {
    if (!registryId || !clonePath) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let live = true;
    // Paint warm immediately on registry switch; the fetch below refreshes it.
    setData(warmCache.get(registryId) ?? null);
    setLoading(true);
    setError(null);

    const load = async () => {
      const coverage = await getRegistryCoverage(
        clonePath,
        projects.map((p) => ({ id: p.id, name: p.name, rootPath: p.root_path })),
      );

      // The registry reader carries every dimension. The app-DB joins that
      // used to merge harvest coverage and practice adoption in here were
      // retired with the in-app Workspace Knowledge library.
      return { coverage, tiles: coverage.tiles.map(buildTileView) };
    };

    load()
      .then((next) => {
        warmCache.set(registryId, next);
        if (live) {
          setData(next);
          setError(null);
        }
      })
      .catch((err) => {
        silentCatch('registryCoverage:fetch')(err);
        if (live) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [registryId, clonePath, projects, gen]);

  return { registry, othersCount, data, loading, error, refetch };
}
