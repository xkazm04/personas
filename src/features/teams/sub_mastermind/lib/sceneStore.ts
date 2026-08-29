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
  getCrossProjectMetadata, listAllGoals, listScans, listTasks,
  type CrossProjectMetadataMap,
} from '@/api/devTools/devTools';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { DevScan } from '@/lib/bindings/DevScan';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';

import { loadMonitoringSummaries, type MonitoringSummary } from './liveState';

/** Per-family fetch lifecycle. `stale` = loaded once but a newer load failed,
 *  so the shown data is real but no longer guaranteed current. */
export type FamilyStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'stale';

/** The data families the scene store fetches. Fleet + KPI are tracked too (for
 *  the health banner) but their data lives in the system/factory stores. */
export type SceneFamily = 'relations' | 'scans' | 'sentry' | 'goals' | 'llmSpend' | 'runners';

/** Dev-runner task statuses that count as WORK IN FLIGHT. A queued task has
 *  been handed to the engine and will run without anyone touching it, so it is
 *  as live as a running one; `failed`/`completed`/`cancelled` are history and
 *  must never inflate a "what is happening right now" count. */
export const LIVE_TASK_STATUSES: ReadonlySet<string> = new Set(['running', 'queued']);

/** How many idea-scan rows to pull in the single batched list call. Generous
 *  enough to cover the most-recent scans of every project at realistic counts;
 *  the Ideas dimension only reads each project's freshest row. */
const SCAN_LIMIT = 500;

/** Re-exported for `ProjectsLayer.tsx` and this module's own test file, which
 *  import `mapWithConcurrency` from here — the canonical implementation now
 *  lives in `@/lib/concurrency` (hoisted out of here and `usePassportData.ts`,
 *  which had an independent copy of the exact same limiter). Import
 *  `@/lib/concurrency` directly in new code. */
export { mapWithConcurrency };

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
  /** Live monitoring rollup per project id — only projects with a bound,
   *  supported monitoring credential appear. Absent key = honestly unknown. */
  sentry: Map<string, MonitoringSummary>;
  sentryStatus: FamilyStatus;
  /** All dev goals grouped by project id (one batched IPC). */
  goals: Map<string, DevGoal[]>;
  goalsStatus: FamilyStatus;

  /** In-flight dev-runner tasks grouped by project id (one batched IPC).
   *  The canvas's THIRD live-process lane, alongside Fleet sessions and
   *  personas — a queued/running task is the engine working on this repo
   *  with no terminal attached, which the map had no way to show. */
  runners: Map<string, DevTask[]>;
  runnersStatus: FamilyStatus;
  /** 30d LLM spend per project id — only wired projects appear (see llmSpend.ts). */
  llmSpend: Map<string, number | null>;
  llmSpendStatus: FamilyStatus;

  /** Cross-project relations/similarity map (one IPC). */
  loadMeta: () => Promise<void>;
  /** All idea-scan rows in ONE list call, grouped client-side by project. */
  loadScans: () => Promise<void>;
  /** Re-fetch only one project's scan rows (scoped IPC) and merge them in. */
  invalidateScans: (projectId: string) => Promise<void>;
  /** Fetch live monitoring stats for the given projects (bounded concurrency).
   *  Throttled to MONITOR_MIN_INTERVAL unless `force`; retryFailed reuses the
   *  last inputs. */
  loadSentry: (projects: readonly DevProject[], credentials: readonly PersonaCredential[], force?: boolean) => Promise<void>;
  /** All goals across all projects in one batched IPC, grouped by project. */
  loadGoals: () => Promise<void>;
  /** All in-flight dev-runner tasks in one batched IPC, grouped by project. */
  loadRunners: () => Promise<void>;
  /** 30d LLM spend for every wired project (bounded concurrency, throttled). */
  loadLlmSpend: (projects: readonly DevProject[], credentials: readonly PersonaCredential[], force?: boolean) => Promise<void>;
  /** Retry every family currently in a failed/stale state. */
  retryFailed: () => void;
}

/** Minimum gap between live-monitoring refreshes — sentry rides the scene
 *  store's invalidation cycle but never hammers the remote API. */
const MONITOR_MIN_INTERVAL = 60_000;
let lastSentryAt = 0;
let lastSentryInputs: { projects: readonly DevProject[]; credentials: readonly PersonaCredential[] } | null = null;

/** LLM spend is a remote trace-API sum — refresh sparingly (5 min). */
const LLM_SPEND_MIN_INTERVAL = 300_000;
let lastLlmSpendAt = 0;
let lastLlmSpendInputs: { projects: readonly DevProject[]; credentials: readonly PersonaCredential[] } | null = null;

/** One latest-wins token per FAMILY — the slot a response competes for is the
 *  family, keyed exactly like the status machine it protects. A single global
 *  token would make every family's fetch a canceller of every other. Responses
 *  arrive in an order the canvas did not choose (retryFailed racing an event
 *  invalidation, a `force: true` refresh jumping the throttle), and a superseded
 *  answer landing second is INERT, not an error. */
const guards: Record<SceneFamily, ReturnType<typeof createLatestWins>> = {
  relations: createLatestWins(),
  scans: createLatestWins(),
  sentry: createLatestWins(),
  goals: createLatestWins(),
  llmSpend: createLatestWins(),
  runners: createLatestWins(),
};

export const useSceneStore = create<SceneStore>((set, get) => ({
  meta: null,
  metaStatus: 'idle',
  scans: new Map(),
  scansStatus: 'idle',
  sentry: new Map(),
  sentryStatus: 'idle',
  goals: new Map(),
  goalsStatus: 'idle',
  runners: new Map(),
  runnersStatus: 'idle',
  llmSpend: new Map(),
  llmSpendStatus: 'idle',

  loadMeta: async () => {
    const token = guards.relations.next();
    set({ metaStatus: 'loading' });
    try {
      const meta = await getCrossProjectMetadata();
      if (!guards.relations.isCurrent(token)) return;
      set({ meta, metaStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadMeta')(err);
      if (!guards.relations.isCurrent(token)) return;
      set((s) => ({ metaStatus: failStatus(s.metaStatus) }));
    }
  },

  loadScans: async () => {
    const token = guards.scans.next();
    set({ scansStatus: 'loading' });
    try {
      const rows = await listScans(undefined, SCAN_LIMIT);
      if (!guards.scans.isCurrent(token)) return;
      set({ scans: groupScansByProject(rows), scansStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadScans')(err);
      if (!guards.scans.isCurrent(token)) return;
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

  loadSentry: async (projects, credentials, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentryAt < MONITOR_MIN_INTERVAL && get().sentryStatus === 'loaded') return;
    lastSentryAt = now;
    lastSentryInputs = { projects, credentials };
    const token = guards.sentry.next();
    set({ sentryStatus: 'loading' });
    try {
      const map = await loadMonitoringSummaries(projects, credentials);
      if (!guards.sentry.isCurrent(token)) return;
      set({ sentry: map, sentryStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadSentry')(err);
      if (!guards.sentry.isCurrent(token)) return;
      set((s) => ({ sentryStatus: failStatus(s.sentryStatus) }));
    }
  },

  loadGoals: async () => {
    const token = guards.goals.next();
    set({ goalsStatus: 'loading' });
    try {
      const rows = await listAllGoals();
      const m = new Map<string, DevGoal[]>();
      for (const g of rows) {
        const list = m.get(g.project_id);
        if (list) list.push(g);
        else m.set(g.project_id, [g]);
      }
      if (!guards.goals.isCurrent(token)) return;
      set({ goals: m, goalsStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadGoals')(err);
      if (!guards.goals.isCurrent(token)) return;
      set((s) => ({ goalsStatus: failStatus(s.goalsStatus) }));
    }
  },

  loadRunners: async () => {
    const token = guards.runners.next();
    set({ runnersStatus: 'loading' });
    try {
      // One unfiltered list call, filtered + grouped here: `dev_tools_list_tasks`
      // takes a single status, and the canvas needs two (running AND queued).
      // Asking twice would double the IPC to save a client-side filter.
      const rows = await listTasks();
      const m = new Map<string, DevTask[]>();
      for (const task of rows) {
        if (!task.project_id || !LIVE_TASK_STATUSES.has(task.status)) continue;
        const list = m.get(task.project_id);
        if (list) list.push(task);
        else m.set(task.project_id, [task]);
      }
      if (!guards.runners.isCurrent(token)) return;
      set({ runners: m, runnersStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadRunners')(err);
      if (!guards.runners.isCurrent(token)) return;
      set((s) => ({ runnersStatus: failStatus(s.runnersStatus) }));
    }
  },

  loadLlmSpend: async (projects, credentials, force = false) => {
    const now = Date.now();
    if (!force && now - lastLlmSpendAt < LLM_SPEND_MIN_INTERVAL && get().llmSpendStatus === 'loaded') return;
    lastLlmSpendAt = now;
    lastLlmSpendInputs = { projects, credentials };
    const token = guards.llmSpend.next();
    set({ llmSpendStatus: 'loading' });
    try {
      // Late import keeps the tracing adapters out of the canvas's first chunk.
      const { loadLlmSpendMap } = await import('./llmSpend');
      const map = await loadLlmSpendMap(projects, credentials);
      if (!guards.llmSpend.isCurrent(token)) return;
      set({ llmSpend: map, llmSpendStatus: 'loaded' });
    } catch (err) {
      silentCatch('mastermind sceneStore.loadLlmSpend')(err);
      if (!guards.llmSpend.isCurrent(token)) return;
      set((s) => ({ llmSpendStatus: failStatus(s.llmSpendStatus) }));
    }
  },

  retryFailed: () => {
    const s = get();
    if (s.metaStatus === 'failed' || s.metaStatus === 'stale') void s.loadMeta();
    if (s.scansStatus === 'failed' || s.scansStatus === 'stale') void s.loadScans();
    if (s.goalsStatus === 'failed' || s.goalsStatus === 'stale') void s.loadGoals();
    if (s.runnersStatus === 'failed' || s.runnersStatus === 'stale') void s.loadRunners();
    if ((s.sentryStatus === 'failed' || s.sentryStatus === 'stale') && lastSentryInputs) {
      void s.loadSentry(lastSentryInputs.projects, lastSentryInputs.credentials, true);
    }
    if ((s.llmSpendStatus === 'failed' || s.llmSpendStatus === 'stale') && lastLlmSpendInputs) {
      void s.loadLlmSpend(lastLlmSpendInputs.projects, lastLlmSpendInputs.credentials, true);
    }
  },
}));
