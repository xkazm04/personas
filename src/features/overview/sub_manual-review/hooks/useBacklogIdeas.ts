// Pending Dev Tools backlog ideas — the second of the Approvals center's three
// decision kinds. Lifted out of the old `BacklogInboxGroup` so the count can
// feed the mode tabs while the rows render in the backlog panel; the group
// owned its own state, which made the count invisible until you expanded it.
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import type { DevIdea } from '@/lib/bindings/DevIdea';

export interface BacklogInbox {
  ideas: DevIdea[];
  loading: boolean;
  /** Id of the idea currently being accepted/rejected, or null. */
  acting: string | null;
  projectName: Map<string, string>;
  act: (idea: DevIdea, accept: boolean) => void;
}

export function useBacklogIdeas(): BacklogInbox {
  const projects = useSystemStore((s) => s.projects);
  const projectName = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const [ideas, setIdeas] = useState<DevIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIdeas(await devApi.listPendingIdeas(100));
    } catch (err) {
      silentCatch('useBacklogIdeas:load')(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback((idea: DevIdea, accept: boolean) => {
    setActing(idea.id);
    void (async () => {
      try {
        if (accept) await devApi.acceptIdea(idea.id);
        else await devApi.rejectIdea(idea.id);
        // Optimistic removal: the row is gone from the pending queue either
        // way, and re-fetching the whole list to learn that is wasteful.
        setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      } catch (err) {
        silentCatch('useBacklogIdeas:act')(err);
      } finally {
        setActing(null);
      }
    })();
  }, []);

  return { ideas, loading, acting, projectName, act };
}
