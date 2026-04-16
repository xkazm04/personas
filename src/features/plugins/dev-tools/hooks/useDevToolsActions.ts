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
export function useDevToolsActions() {
  // Read the store lazily inside each action so callers always see the latest
  // state at call time. Reading `useSystemStore.getState()` once at hook body
  // and closing over that snapshot is a silent bug — the component calling
  // this hook doesn't necessarily subscribe to `ideas`/`tasks`, so without a
  // re-render the closed-over `store` stays frozen at first mount and
  // `batchFromAcceptedIdeas` / `startBatch` / `cancelAllTasks` would operate
  // on empty arrays after any backend-driven state change.
  const s = () => useSystemStore.getState();
  const pid = () => s().activeProjectId ?? '';

  return {
    // Context Map -- convenience wrappers that resolve projectId
    fetchContextMap: async () => {
      const id = pid();
      if (!id) return;
      const store = s();
      await Promise.all([store.fetchContextGroups(id), store.fetchContexts(id)]);
    },
    createContextGroup: (data: { name: string; color: string }) =>
      s().createContextGroup(pid(), data.name, data.color),
    scanCodebase: (rootPath?: string) => {
      const id = pid();
      if (!id) return Promise.resolve();
      return s().scanCodebase(id, rootPath ?? '.');
    },

    // Scanner
    runScan: (agentKeys: string[], contextId?: string) => {
      const store = s();
      store.setScanAgentSelection(agentKeys);
      return store.runScan(pid(), contextId);
    },

    // Triage
    triageIdea: async (id: string, decision: 'accepted' | 'rejected') => {
      const store = s();
      if (decision === 'accepted') await store.acceptIdea(id);
      else await store.rejectIdea(id);
    },
    deleteIdea: (id: string) => s().deleteIdea(id),

    // Tasks
    createTask: (data: { title: string; description?: string; goalId?: string; depth?: string }) =>
      s().createTask(data.title, pid() || undefined, data.description, undefined, data.goalId, data.depth),
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
  } as const;
}
