import { useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';

/**
 * Typed accessors for DevToolsSlice actions.
 *
 * Replaces the old `(store as any).methodName` pattern with properly typed
 * selectors so that renames surface as compile-time errors.
 *
 * Convenience wrappers auto-resolve `activeProjectId` from the store for
 * methods that require it, matching the zero-arg signatures the UI expects.
 *
 * Only members a caller destructures live here: thirteen wrappers no caller
 * read (context-map fetch, triage, task batch/cancel, cross-project, diff/test/
 * git-status) were removed on 2026-10-19. Call the store or `devApi` directly
 * rather than re-adding a pass-through nobody reads.
 */
// Read the store lazily inside each action so callers always see the latest
// state at call time. Reading `useSystemStore.getState()` once and closing over
// that snapshot is a silent bug — the closed-over state would freeze at first
// mount and `batchFromAcceptedIdeas` would operate on an empty array after any
// backend-driven change. Hoisted to module scope (stable identity) so the
// useMemo below can keep `[]` deps.
const s = () => useSystemStore.getState();
const pid = () => s().activeProjectId ?? '';

export function useDevToolsActions() {
  // Memoize so every returned action keeps a STABLE identity across renders.
  // The closures read getState() at call time, so there's no render-time state
  // to capture — `[]` is correct. Stability is REQUIRED: a consumer that lists
  // one of these actions in a useEffect dependency array would otherwise re-run
  // that effect every render — the infinite fetch→re-render loop that leaked
  // ContextMapPage's renderer to OOM. This hardens the whole class.
  return useMemo(() => ({
    // Context Map
    createContextGroup: (data: { name: string; color: string }) =>
      s().createContextGroup(pid(), data.name, data.color),
    scanCodebase: (rootPath?: string, deltaMode?: boolean) => {
      const id = pid();
      if (!id) return Promise.resolve();
      return s().scanCodebase(id, rootPath ?? '.', deltaMode);
    },

    // Scanner
    runScan: (agentKeys: string[], opts?: devApi.RunScanOptions) => {
      const store = s();
      store.setScanAgentSelection(agentKeys);
      return store.runScan(pid(), opts);
    },

    // Tasks
    createTask: (data: { title: string; description?: string; goalId?: string; depth?: string; sourceIdeaId?: string }) =>
      s().createTask(data.title, pid() || undefined, data.description, data.sourceIdeaId, data.goalId, data.depth),
    batchFromAcceptedIdeas: async () => {
      const store = s();
      const accepted = store.ideas.filter((i) => i.status === 'accepted');
      if (accepted.length === 0) return;
      await store.batchCreateTasks(
        accepted.map((i) => ({ title: i.title, description: i.description ?? undefined, sourceIdeaId: i.id })),
        pid() || undefined,
      );
    },

    // -- Implementation Pipeline (PR Bridge) --------------------------------

    createBranch: (projectId: string, branchName: string, baseBranch?: string) =>
      devApi.createBranch(projectId, branchName, baseBranch),
    commitChanges: (projectId: string, message: string, stageAll?: boolean) =>
      devApi.commitChanges(projectId, message, stageAll),
    getGitStatus: (projectId: string) => devApi.getGitStatus(projectId),

    // -- Portfolio Intelligence (PortfolioStrip) -----------------------------

    getPortfolioHealth: () => devApi.getPortfolioHealth(),
    getTechRadar: () => devApi.getTechRadar(),
    getRiskMatrix: () => devApi.getRiskMatrix(),
  }) as const, []);
}
