/**
 * useUnifiedTriage — one queue over every "a human must decide" source, and one
 * place that knows how to write each verdict back.
 *
 * Sources fused here:
 *  • persona manual reviews + build questions — via `usePendingInteractions`,
 *    the popover's existing data layer (local + cloud reviews, live build
 *    sessions), so this surface inherits its polling rather than adding more.
 *  • backlog ideas — the real cross-project keyset query (`dev_tools_triage_ideas`).
 *  • workspace practices — the pending half (observed + proposed) of every
 *    workspace's knowledge library.
 *
 * Two deliberate behaviours worth knowing before you read the code:
 *
 * 1. **Resolved items leave the array; they do not advance an index.** Index
 *    cursors desynchronise the moment anything else mutates the list (a poll
 *    lands, another surface accepts the same row). Removing the row is the only
 *    model that stays correct under concurrent change.
 *
 * 2. **Skip sorts last, it does not hide.** A skipped item stays in the queue
 *    behind everything undecided, so a reviewer who defers ten things still
 *    ends the session having seen them again — instead of a queue that
 *    silently shrinks every time someone says "not now".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { decideWorkspaceKnowledge } from '@/api/devTools/workspaces';
import { toBacklogIdea } from '@/features/overview/sub_manual-review/components/backlog/backlogModel';
import { useWorkspaceCenter } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { viewFromRow } from '@/features/overview/sub_patterns/libraryModel';
import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import type { DevIdea } from '@/lib/bindings/DevIdea';

import { usePendingInteractions } from '../usePendingInteractions';
import {
  DEFAULT_TRIAGE_COPY,
  ideaToTriage,
  practiceToTriage,
  questionToTriage,
  reviewToTriage,
  type TriageCopy,
} from './triageAdapters';
import {
  compareTriage,
  countByKind,
  type TriageCounts,
  type TriageDecision,
  type TriageItem,
  type TriageKind,
} from './triageTypes';

/** Statuses that still owe a human decision. */
const PENDING_PRACTICE_STATUSES = new Set(['observed', 'proposed']);

/** One page of pending ideas is plenty for a triage session; the queue is a
 *  working set, not an archive. */
const IDEA_PAGE_SIZE = 60;

export interface UnifiedTriageQueue {
  /** Undecided first, skipped last, both in weight order. */
  items: TriageItem[];
  counts: TriageCounts;
  /** Tally of every kind before filtering — drives the filter chips. */
  allCounts: TriageCounts;
  loading: boolean;
  busyId: string | null;
  activeKinds: Set<TriageKind>;
  toggleKind: (kind: TriageKind) => void;
  /** How many this session has resolved — the progress denominator's numerator. */
  decidedCount: number;
  sessionTotal: number;
  decide: (decision: TriageDecision) => Promise<void>;
  reload: () => void;
}

export function useUnifiedTriage(
  copy: TriageCopy = DEFAULT_TRIAGE_COPY,
  onOpenBuilder?: (personaId: string) => void,
): UnifiedTriageQueue {
  const interactions = usePendingInteractions();
  const center = useWorkspaceCenter();
  const projects = useSystemStore((s) => s.projects);

  const [ideas, setIdeas] = useState<DevIdea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(true);
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeKinds, setActiveKinds] = useState<Set<TriageKind>>(
    () => new Set<TriageKind>(['review', 'idea', 'practice', 'question']),
  );
  const [reloadGen, setReloadGen] = useState(0);

  const projectName = useCallback(
    (projectId: string | null) =>
      projectId ? projects.find((p) => p.id === projectId)?.name ?? '' : '',
    [projects],
  );

  // Ideas are the one source with no existing hook to borrow, so this owns the
  // fetch. Guarded by a generation counter rather than a ref so `reload()` is
  // a plain state bump.
  useEffect(() => {
    let cancelled = false;
    setIdeasLoading(true);
    void devApi
      .triageIdeas(undefined, IDEA_PAGE_SIZE, undefined, { status: 'pending' })
      .then((page) => {
        if (!cancelled) setIdeas(page.ideas);
      })
      .catch(toastCatch('Could not load backlog ideas'))
      .finally(() => {
        if (!cancelled) setIdeasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadGen]);

  /** Everything, before resolution/skip/kind filtering. */
  const all = useMemo<TriageItem[]>(() => {
    const out: TriageItem[] = [];

    for (const review of interactions.reviews) {
      out.push(reviewToTriage(review, copy));
    }

    for (const group of interactions.questionGroups) {
      for (const question of group.questions) {
        out.push(
          questionToTriage(
            question,
            {
              sessionId: group.sessionId,
              personaId: group.personaId,
              personaName: group.personaName,
              personaColor: group.personaColor,
            },
            copy,
          ),
        );
      }
    }

    for (const idea of ideas) {
      out.push(ideaToTriage(toBacklogIdea(idea, projectName), copy));
    }

    for (const workspace of center.workspaces) {
      const rows = center.knowledge[workspace.id] ?? [];
      for (const row of rows) {
        if (!PENDING_PRACTICE_STATUSES.has(row.status)) continue;
        out.push(practiceToTriage(viewFromRow(row), workspace.name, row.detail_md, copy));
      }
    }

    return out;
  }, [interactions.reviews, interactions.questionGroups, ideas, center.workspaces, center.knowledge, copy, projectName]);

  const allCounts = useMemo(() => countByKind(all), [all]);

  const items = useMemo(() => {
    const live = all.filter((i) => !resolved.has(i.id) && activeKinds.has(i.kind));
    // Skipped sort last — deferred, never dropped.
    return live.sort((a, b) => {
      const aSkip = skipped.has(a.id) ? 1 : 0;
      const bSkip = skipped.has(b.id) ? 1 : 0;
      return aSkip - bSkip || compareTriage(a, b);
    });
  }, [all, resolved, skipped, activeKinds]);

  const counts = useMemo(() => countByKind(items), [items]);

  const toggleKind = useCallback((kind: TriageKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      // Never let the last filter be switched off — an empty queue reads as
      // "you're done" when it actually means "you filtered everything out".
      if (next.has(kind) && next.size > 1) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    setResolved(new Set());
    setSkipped(new Set());
    setReloadGen((g) => g + 1);
    center.refreshKnowledge();
  }, [center]);

  /**
   * Route one verdict to the right backend. Every branch resolves optimistically
   * — the row leaves the queue as soon as the write is issued — because a
   * triage surface that pauses after each decision is a triage surface nobody
   * finishes.
   */
  const decide = useCallback(
    async (decision: TriageDecision) => {
      const { item, verdict, branchId, answer, reason } = decision;

      if (verdict === 'skip') {
        setSkipped((prev) => new Set(prev).add(item.id));
        return;
      }

      setBusyId(item.id);
      // Optimistic: drop it now, restore only if the write actually fails.
      setResolved((prev) => new Set(prev).add(item.id));

      try {
        switch (item.kind) {
          case 'review':
            if (branchId) await interactions.handleDispatchAction(item.sourceId, branchId);
            else if (verdict === 'accept') await interactions.handleReviewAction(item.sourceId, 'approved');
            else await interactions.handleReviewAction(item.sourceId, 'rejected', reason);
            break;

          case 'idea':
            if (branchId === 'build') {
              await devApi.createTask(
                item.title,
                item.payload?.projectId ?? undefined,
                item.body,
                item.sourceId,
              );
              await devApi.acceptIdea(item.sourceId);
            } else if (verdict === 'accept') {
              await devApi.acceptIdea(item.sourceId);
            } else {
              await devApi.rejectIdea(item.sourceId, reason);
            }
            break;

          case 'practice':
            await decideWorkspaceKnowledge(
              item.sourceId,
              branchId === 'deprecate' ? 'deprecate' : verdict === 'accept' ? 'adopt' : 'reject',
            );
            center.refreshKnowledge();
            break;

          case 'question': {
            // The session is the write target; `sourceId` is the cell key the
            // answer is filed under.
            const sessionId = item.payload?.sessionId ?? '';
            if (branchId === 'builder') {
              const personaId = item.payload?.personaId;
              if (onOpenBuilder && personaId) onOpenBuilder(personaId);
            } else if (verdict === 'accept' && answer && sessionId) {
              await interactions.submitQuestionAnswers(sessionId, { [item.sourceId]: answer });
            }
            break;
          }
        }
      } catch (error) {
        // Put it back: a failed write must not look like a completed decision.
        setResolved((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        toastCatch('Could not record that decision')(error);
      } finally {
        setBusyId(null);
      }
    },
    [interactions, center, onOpenBuilder],
  );

  return {
    items,
    counts,
    allCounts,
    loading: interactions.loading || ideasLoading,
    busyId,
    activeKinds,
    toggleKind,
    decidedCount: resolved.size,
    sessionTotal: all.length,
    decide,
    reload,
  };
}
