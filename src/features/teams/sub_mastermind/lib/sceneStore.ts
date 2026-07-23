// Mastermind scene store — the single spine that feeds the canvas.
//
// WHY: opening Mastermind used to fan out N+1 IPC per project (listScans × N,
// plus skills/evidence × N inside usePassportData) and relied on a 5s fleet
// poll to stay current. This store collapses the per-family fetch to ≤1 IPC
// (batch commands where they exist, bounded concurrency where they don't),
// caches a per-project rollup, and invalidates surgically on the events that
// actually change a project's data — so the canvas opens fast at 30+ projects
// and never goes stale behind a timer.
//
// Families owned here: cross-project RELATIONS (meta) + idea SCANS + live
// monitoring (sentry, wired in "live-operational-state"). Passports/KPI keep
// their own hooks (usePassportData / FactoryDataProvider); fleet lives in the
// system store slice. Each family carries a fetch STATUS so the page can render
// an honest data-health banner (never a silent partial truth).
import { create } from 'zustand';

import {
  getCrossProjectMetadata, listScans,
  type CrossProjectMetadataMap,
} from '@/api/devTools/devTools';
import type { DevScan } from '@/lib/bindings/DevScan';
import { silentCatch } from '@/lib/silentCatch';

/** Per-family fetch lifecycle. `stale` = loaded once but a newer load failed,
 *  so the shown data is real but no longer guaranteed current. */
export type FamilyStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'stale';

/** The data families the scene store fetches. Fleet + KPI are tracked too (for
 *  the health banner) but their data lives in the system/factory stores. */
export type SceneFamily = 'relations' | 'scans' | 'sentry';

/** How many idea-scan rows to pull in the single batched list call. Generous
 *  enough to cover the most-recent scans of every project at realistic counts;
 *  the Ideas dimension only reads each project's freshest row. */
const SCAN_LIMIT = 500;

/** Bound the in-flight count of a per-project fan-out (skills/evidence/sentry)
 *  so opening 30+ projects doesn't launch 30+ simultaneous requests. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

/** Group flat DevScan rows by project id (dropping null-project rows), newest
 *  first per project. Island slug === dev-project id, so callers key by slug. */
export function groupScansByProject(rows: DevScan[]): Map<string, DevScan[]> {
  const m = new Map<string, DevScan[]>();
  for (const r of rows) {
    if (!r.project_id) continue;
    const list = m.get(r.project_id);
    if (list) list.push(r);
    else m.set(r.project_id, [r]);
  }
  for (const list of m.values()) {
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }
  return m;
}

/** Compute the next status after a failed reload: a family that had data goes
 *  `stale` (keep showing it, flag it), a family that never loaded goes `failed`. */
export const failStatus = (prev: FamilyStatus): FamilyStatus =>
  prev === 'loaded' || prev === 'stale' ? 'stale' : 'failed';

interface SceneStore {
  meta: CrossProjectMetadataMap | null;
  metaStatus: FamilyStatus;
  scans: Map<string, DevScan[]>;
  scansStatus: FamilyStatus;

  /** Cross-project relations/similarity map (one IPC). */
  loadMeta: () => Promise<void>;
  /** All idea-scan rows in ONE list call, grouped client-side by project. */
  loadScans: () => Promise<void>;
  /** Re-fetch only one project's scan rows (scoped IPC) and merge them in. */
  invalidateScans: (projectId: string) => Promise<void>;
  /** Retry every family currently in a failed/stale state. */
  retryFailed: () => void;
}

export const useSceneStore = create<SceneStore>((set, get) => ({
  meta: null,
  metaStatus: 'idle',
  scans: new Map(),
  scansStatus: 'idle',

  loadMeta: async () => {
    set({ metaStatus: 'loading' });
    try {
      const meta = await getCrossProjectMetadata();
      set({ meta, metaStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadMeta')(err);
      set((s) => ({ metaStatus: failStatus(s.metaStatus) }));
    }
  },

  loadScans: async () => {
    set({ scansStatus: 'loading' });
    try {
      const rows = await listScans(undefined, SCAN_LIMIT);
      set({ scans: groupScansByProject(rows), scansStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadScans')(err);
      set((s) => ({ scansStatus: failStatus(s.scansStatus) }));
    }
  },

  invalidateScans: async (projectId) => {
    try {
      const rows = await listScans(projectId, 20);
      set((s) => {
        const next = new Map(s.scans);
        next.set(projectId, rows);
        return { scans: next };
      });
    } catch (err) {
      // A single project's refresh failing shouldn't flip the whole family to
      // failed — the rest of the cache is still valid. Log + leave status.
      silentCatch('mastermind sceneStore.invalidateScans')(err);
    }
  },

  retryFailed: () => {
    const s = get();
    if (s.metaStatus === 'failed' || s.metaStatus === 'stale') void s.loadMeta();
    if (s.scansStatus === 'failed' || s.scansStatus === 'stale') void s.loadScans();
  },
}));
