import { useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import * as devApi from '@/api/devTools/devTools';
export type { PortfolioHealthSummary, TechRadarEntry, RiskMatrixEntry, TestRunResult, GitOperationResult } from '@/api/devTools/devTools';

/**
 * Typed accessors for DevToolsSlice actions.
 *
 * Replaces the old `(store as any).methodName` pattern with properly typed
 * selectors so that renames surface as compile-time errors.
 *
 * Convenience wrappers auto-resolve `activeProjectId` from the store for
 * methods that require it, matching the zero-arg signatures the UI expects.
 */
// Read the store lazily inside each action so callers always see the latest
// state at call time. Reading `useSystemStore.getState()` once and closing over
// that snapshot is a silent bug — the closed-over state would freeze at first
// mount and `batchFromAcceptedIdeas` / `startBatch` / `cancelAllTasks` would
// operate on empty arrays after any backend-driven change. Hoisted to module
// scope (stable identity) so the useMemo below can keep `[]` deps.
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
    // Context Map -- convenience wrappers that resolve projectId
    fetchContextMap: async () => {
      const id = pid();
      if (!id) return;
      const store = s();
      await Promise.all([store.fetchContextGroups(id), store.fetchContexts(id)]);
    },
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

    // Triage
    triageIdea: async (id: string, decision: 'accepted' | 'rejected') => {
      const store = s();
      if (decision === 'accepted') await store.acceptIdea(id);
      else await store.rejectIdea(id);
    },
    deleteIdea: (id: string) => s().deleteIdea(id),

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
    startBatch: async () => {
      const store = s();
      const pending = store.tasks.filter((t) => t.status === 'queued' || t.status === 'pending');
      if (pending.length === 0) return;
      await store.startBatch(pending.map((t) => t.id));
    },
    cancelAllTasks: async () => {
      const store = s();
      const active = store.tasks.filter((t) => t.status === 'running');
      await Promise.all(active.map((t) => devApi.cancelTaskExecution(t.id)));
      const queued = store.tasks.filter((t) => t.status === 'queued' || t.status === 'pending');
      await Promise.all(queued.map((t) => store.cancelTask(t.id)));
    },

    // -- Cross-Project (Codebases) ------------------------------------------

    getCrossProjectMap: () => devApi.getCrossProjectMap(),
    searchAcrossProjects: (query: string, filePattern?: string) =>
      devApi.searchAcrossProjects(query, filePattern),
    createIdeaBatch: (ideas: Parameters<typeof devApi.createIdeaBatch>[0]) =>
      devApi.createIdeaBatch(ideas),
    getDependencyGraph: () => devApi.getDependencyGraph(),
    getProjectSummary: (projectId: string) => devApi.getProjectSummary(projectId),

    // -- Implementation Pipeline (Direction 3) ------------------------------

    createBranch: (projectId: string, branchName: string, baseBranch?: string) =>
      devApi.createBranch(projectId, branchName, baseBranch),
    applyDiff: (projectId: string, diffContent: string) =>
      devApi.applyDiff(projectId, diffContent),
    runTests: (projectId: string, testCommand?: string) =>
      devApi.runTests(projectId, testCommand),
    getGitStatus: (projectId: string) => devApi.getGitStatus(projectId),
    commitChanges: (projectId: string, message: string, stageAll?: boolean) =>
      devApi.commitChanges(projectId, message, stageAll),

    // -- Portfolio Intelligence (Direction 5) --------------------------------

    getPortfolioHealth: () => devApi.getPortfolioHealth(),
    getTechRadar: () => devApi.getTechRadar(),
    getRiskMatrix: () => devApi.getRiskMatrix(),
  }) as const, []);
}
