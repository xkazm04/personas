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
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

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
import { adoptReach } from './triageReach';
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

/** More successor options than this and the reason strip stops being one glance
 *  and one keypress. Digits only go to 9 anyway. */
const MAX_SUCCESSORS = 5;

/**
 * Candidate replacements for a practice being deprecated.
 *
 * Same workspace, same topic, not itself — the realistic shape of "we deprecate
 * the old take because THIS is the one we're adopting", which is exactly the
 * moment a harvest review produces two rulings on the same topic in a row.
 *
 * Scoped to the pending set the deck already holds rather than fetching the
 * adopted library: a second query per card to populate an optional field on an
 * optional branch is not a trade this surface should make, and offering the
 * sibling you are about to adopt is the case that actually comes up.
 */
function successorsFor(
  row: WorkspaceKnowledge,
  siblings: readonly WorkspaceKnowledge[],
): { id: string; title: string }[] {
  if (!row.topic) return [];
  return siblings
    .filter((s) => s.id !== row.id && s.topic === row.topic)
    .slice(0, MAX_SUCCESSORS)
    .map((s) => ({ id: s.id, title: s.title }));
}

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
  /**
   * Follow one of an item's {@link TriageItem.links}. NOT a decision: nothing is
   * written and the item stays in the queue, because reading the run that raised
   * a review is how you decide it, not the deciding.
   */
  openLink: (item: TriageItem, linkId: string) => void;
  reload: () => void;
}

export interface UnifiedTriageHosts {
  /** Deep-link to the persona builder for questions this surface can't answer. */
  onOpenBuilder?: (personaId: string) => void;
  /** Deep-link to the execution behind a review. Absent when the host has no route. */
  onOpenRun?: (executionId: string) => void;
}

export function useUnifiedTriage(
  copy: TriageCopy = DEFAULT_TRIAGE_COPY,
  hosts: UnifiedTriageHosts = {},
): UnifiedTriageQueue {
  const { onOpenBuilder, onOpenRun } = hosts;
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
      if (rows.length === 0) continue;
      // Adopting fans the practice out to every APPLICABLE member repo, so the
      // blast radius is a property of the workspace's membership, not of the
      // practice row. Resolved once per workspace rather than per practice.
      const stacks = workspace.projectIds.map((id) => center.projectById.get(id)?.tech_stack ?? null);
      const pending = rows.filter((row) => PENDING_PRACTICE_STATUSES.has(row.status));
      for (const row of pending) {
        out.push(
          practiceToTriage(
            viewFromRow(row),
            workspace.name,
            row.detail_md,
            copy,
            adoptReach(row.applicability, stacks),
            successorsFor(row, pending),
          ),
        );
      }
    }

    return out;
  }, [
    interactions.reviews,
    interactions.questionGroups,
    ideas,
    center.workspaces,
    center.knowledge,
    center.projectById,
    copy,
    projectName,
  ]);

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
      decideKnowledge: (id, verdict, supersededBy) =>
        decideWorkspaceKnowledge(id, verdict, supersededBy),
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

  /**
   * Navigation, never a verdict. Guarded on the item actually declaring the
   * link so a stale keystroke can't open a route the card never offered.
   */
  const openLink = useCallback(
    (item: TriageItem, linkId: string) => {
      if (!item.links?.some((l) => l.id === linkId)) return;
      if (linkId === 'run') {
        const executionId = item.payload?.executionId;
        if (executionId && onOpenRun) onOpenRun(executionId);
      }
    },
    [onOpenRun],
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
    openLink,
    reload,
  };
}
