import { useSystemStore } from '@/stores/systemStore';

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
  const store = useSystemStore.getState();
  const pid = () => store.activeProjectId ?? '';

  return {
    // Context Map — convenience wrappers that resolve projectId
    fetchContextMap: async () => {
      const id = pid();
      if (!id) return;
      await Promise.all([store.fetchContextGroups(id), store.fetchContexts(id)]);
    },
    createContextGroup: (data: { name: string; color: string }) =>
      store.createContextGroup(pid(), data.name, data.color),
    scanCodebase: (rootPath?: string) =>
      store.scanCodebase(pid(), rootPath ?? '.'),

    // Scanner
    runScan: (agentKeys: string[]) => {
      store.setScanAgentSelection(agentKeys);
      return store.runScan(pid());
    },

    // Triage
    triageIdea: async (id: string, decision: 'accepted' | 'rejected') => {
      if (decision === 'accepted') await store.acceptIdea(id);
      else await store.rejectIdea(id);
    },
    deleteIdea: store.deleteIdea,

    // Tasks
    createTask: (data: { title: string; description?: string; goalId?: string }) =>
      store.createTask(data.title, pid() || undefined, data.description, undefined, data.goalId),
    batchFromAcceptedIdeas: async () => {
      const accepted = store.ideas.filter((i) => i.status === 'accepted');
      if (accepted.length === 0) return;
      await store.batchCreateTasks(
        accepted.map((i) => ({ title: i.title, description: i.description ?? undefined, sourceIdeaId: i.id })),
        pid() || undefined,
      );
    },
    startBatch: async () => {
      const pending = store.tasks.filter((t) => t.status === 'pending');
      if (pending.length === 0) return;
      await store.startBatch(pending.map((t) => t.id));
    },
    cancelAllTasks: async () => {
      const active = store.tasks.filter((t) => t.status === 'running' || t.status === 'pending');
      await Promise.all(active.map((t) => store.cancelTask(t.id)));
    },
  } as const;
}
