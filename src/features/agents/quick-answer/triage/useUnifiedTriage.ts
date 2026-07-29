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
 *    silently shrinks every time someone says "not now". It is offered a
 *    BOUNDED number of times (`MAX_SKIP_PASSES`), because a skip that
 *    re-presents forever is a deck that can never be cleared.
 *
 * The two parts worth testing live next door and are React-free: `triageQueue`
 * (what the reviewer sees and what the counters say) and `triageDispatch`
 * (which backend a verdict writes to). This file is the wiring.
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
  questionGroupToTriage,
  reviewToTriage,
  type TriageCopy,
} from './triageAdapters';
import { isDeferral, routeDecision, type TriagePorts } from './triageDispatch';
import { projectQueue, withSkip, type SkipLedger } from './triageQueue';
import {
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
  /** Tally of everything still awaiting a decision, before the kind filter —
   *  drives the filter chips. */
  allCounts: TriageCounts;
  loading: boolean;
  activeKinds: Set<TriageKind>;
  toggleKind: (kind: TriageKind) => void;
  /** How many this session has resolved — the progress readout's numerator. */
  decidedCount: number;
  /** Decided + still-pending. Never less than `decidedCount`. */
  sessionTotal: number;
  /** Seen, skipped to exhaustion, and no longer offered this session. */
  deferredCount: number;
  /**
   * How many times each item has been skipped. The deck reads it to know a
   * card is being RE-presented — a card thrown once must have its thrown state
   * reset before it can be thrown again.
   */
  skips: SkipLedger;
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
  const [skips, setSkips] = useState<SkipLedger>(() => new Map<string, number>());
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

    // One card per SESSION, not per question — answering it is one batched
    // `answer_build_question`, which resumes the halted CLI exactly once.
    for (const group of interactions.questionGroups) {
      const card = questionGroupToTriage(
        {
          sessionId: group.sessionId,
          personaId: group.personaId,
          personaName: group.personaName,
          personaColor: group.personaColor,
          questions: group.questions,
        },
        copy,
      );
      if (card) out.push(card);
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

  const projection = useMemo(
    () => projectQueue({ all, resolved, skips, activeKinds }),
    [all, resolved, skips, activeKinds],
  );

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
    setSkips(new Map());
    setReloadGen((g) => g + 1);
    center.refreshKnowledge();
  }, [center]);

  /** Every write a verdict can reach, in one injected bundle — see
   *  `triageDispatch`, which owns the routing itself. */
  const ports = useMemo<TriagePorts>(
    () => ({
      reviewAction: (id, status, notes) => interactions.handleReviewAction(id, status, notes),
      dispatchReviewAction: (id, action) => interactions.handleDispatchAction(id, action),
      createTask: (title, projectId, body, ideaId) =>
        devApi.createTask(title, projectId, body, ideaId),
      acceptIdea: (id) => devApi.acceptIdea(id),
      rejectIdea: (id, reason) => devApi.rejectIdea(id, reason),
      decideKnowledge: (id, verdict) => decideWorkspaceKnowledge(id, verdict),
      refreshKnowledge: () => center.refreshKnowledge(),
      submitAnswers: (sessionId, answers) => interactions.submitQuestionAnswers(sessionId, answers),
      openBuilder: onOpenBuilder,
    }),
    [interactions, center, onOpenBuilder],
  );

  /**
   * Route one verdict to the right backend. Writes resolve optimistically —
   * the row leaves the queue as soon as the write is issued — because a triage
   * surface that pauses after each decision is a triage surface nobody
   * finishes. The safety that makes that honest is the restore below: a
   * rejected write puts the row straight back.
   */
  const decide = useCallback(
    async (decision: TriageDecision) => {
      const { item } = decision;

      // A deferral writes nothing, so it must not resolve anything either.
      if (isDeferral(decision)) {
        setSkips((prev) => withSkip(prev, item.id));
        return;
      }

      // Optimistic: drop it now, restore only if the write actually fails.
      setResolved((prev) => new Set(prev).add(item.id));

      try {
        await routeDecision(decision, ports);
      } catch (error) {
        // Put it back: a failed write must not look like a completed decision.
        setResolved((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        toastCatch('Could not record that decision')(error);
      }
    },
    [ports],
  );

  return {
    items: projection.items,
    allCounts: projection.allCounts,
    loading: interactions.loading || ideasLoading,
    activeKinds,
    toggleKind,
    decidedCount: resolved.size,
    sessionTotal: projection.sessionTotal,
    deferredCount: projection.deferredCount,
    skips,
    decide,
    reload,
  };
}
