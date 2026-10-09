/**
 * Opening a backlog item from a step's screen. Nothing in the app takes the
 * reader to ONE backlog item by id (the backlog only opens as a list, at
 * Overview > Approvals > Backlog), so an item here opens IN PLACE, in the
 * backlog's own detail modal (`BacklogDetailModal`, the dialog the backlog
 * itself opens, with its accept / reject / build now), read by id. "Open the
 * backlog" goes to the list the way every other surface does.
 *
 * One provider per step screen: the Next panel's links and the related list
 * share it. A read failure, or a decision that did not land, is said on the
 * screen's live line (`RelatedNote`); a decision that did land refetches the
 * step's detail, so the item's new status shows where it was pressed.
 */
import { createContext, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useCategoryLabel } from '@/features/overview/sub_manual-review/components/backlog/backlogLabels';
import { toBacklogIdea, type BacklogIdea } from '@/features/overview/sub_manual-review/components/backlog/backlogModel';
import { resolveError } from '@/lib/errors/errorRegistry';
import { lazyRetry } from '@/lib/lazyRetry';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

export interface RelatedItemApi {
  /** Read the item by id and open it. */
  open: (id: string) => void;
  /** The item being read, for the pressed control's spinner. */
  openingId: string | null;
  /** What the last read or decision came to, when it failed. */
  error: string | null;
  /** The backlog list (Overview > Approvals > Backlog). */
  openBacklog: () => void;
}

const RelatedItemContext = createContext<RelatedItemApi | null>(null);

// The backlog's dialog is its own chunk: a step screen pays for it only when an item opens.
const LazyBacklogDetail = lazyRetry(() => import('@/features/overview/sub_manual-review/components/backlog/BacklogDetailModal')
  .then((m) => ({ default: m.BacklogDetailModal })));

const message = (err: unknown) => resolveError(err instanceof Error ? err.message : String(err)).message;

export function RelatedItemProvider({ onDecided, children }: { onDecided: () => void; children: ReactNode }) {
  const [idea, setIdea] = useState<BacklogIdea | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const categoryLabel = useCategoryLabel();

  const open = useCallback((id: string) => {
    setOpeningId(id);
    setError(null);
    // The dev-tools API is a large module the step screen otherwise never needs: read it on the press.
    import('@/api/devTools/devTools')
      .then(({ getIdea }) => getIdea(id))
      .then((raw) => {
        const projects = useSystemStore.getState().projects;
        // A project that is gone reads as no project, which is what the backlog's own rows say.
        const nameOf = (pid: string | null) => {
          const project = projects.find((p) => p.id === pid);
          return project ? project.name : '';
        };
        setIdea(toBacklogIdea(raw, nameOf));
      })
      .catch((err: unknown) => {
        silentCatch('lifecycle:openRelatedItem')(err);
        setError(message(err));
      })
      .finally(() => setOpeningId(null));
  }, []);

  const decide = useCallback(async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
      onDecided();
    } catch (err) {
      silentCatch('lifecycle:decideRelatedItem')(err);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }, [onDecided]);

  const openBacklog = useCallback(() => {
    const sys = useSystemStore.getState();
    // Seed the mode BEFORE navigating, so the Approvals list reads it on the mount this causes.
    sys.setPendingApprovalsMode('backlog');
    sys.setSidebarSection('overview');
    // The overview store is a large module the step screen otherwise never needs: reach it on the press.
    import('@/stores/overviewStore')
      .then(({ useOverviewStore }) => useOverviewStore.getState().setOverviewTab('manual-review'))
      .catch(silentCatch('lifecycle:openBacklog'));
  }, []);

  const api = useMemo<RelatedItemApi>(() => ({ open, openingId, error, openBacklog }), [open, openingId, error, openBacklog]);
  const seen = idea?.status;
  return (
    <RelatedItemContext.Provider value={api}>
      {children}
      {idea && (
        <Suspense fallback={null}>
          <LazyBacklogDetail
            idea={idea}
            categoryLabel={categoryLabel}
            busy={busy}
            onAccept={(id) => decide(() => useSystemStore.getState().acceptIdea(id, seen))}
            onReject={(id) => decide(() => useSystemStore.getState().rejectIdea(id, undefined, seen))}
            onClose={() => setIdea(null)}
          />
        </Suspense>
      )}
    </RelatedItemContext.Provider>
  );
}

/** The step screen's item opener (throws outside a step screen: a wiring mistake, not a state). */
export function useRelatedItem(): RelatedItemApi {
  const api = useContext(RelatedItemContext);
  if (!api) throw new Error('useRelatedItem must be used inside <RelatedItemProvider>');
  return api;
}
