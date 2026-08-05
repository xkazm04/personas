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
 *  • policy proposals — the Self-Tuning Fabric's pending routing/budget diffs.
 *  • evolution promotions — Darwin Mode's pending "this challenger beat the
 *    incumbent, install it?" proposals.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { listPromotionProposals } from '@/api/agents/evolution';
import { policyTuningList } from '@/api/system/policyTuning';
import {
  decideEvolutionProposalRow,
  decidePolicyProposalRow,
  decidePracticeRow,
  isDecisionConflict,
  reopenIdeaRow,
  reopenPracticeRow,
} from '@/lib/decisions/rowWrites';
import { toBacklogIdea } from '@/features/overview/sub_manual-review/components/backlog/backlogModel';
import { useWorkspaceCenter } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { viewFromRow } from '@/features/overview/sub_patterns/libraryModel';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { getActiveTranslations } from '@/i18n/useTranslation';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { EvolutionPromotionProposal } from '@/lib/bindings/EvolutionPromotionProposal';
import type { PolicyProposal } from '@/lib/bindings/PolicyProposal';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

import { usePendingInteractions } from '../usePendingInteractions';
import {
  DEFAULT_TRIAGE_COPY,
  evolutionProposalToTriage,
  ideaToTriage,
  policyProposalToTriage,
  practiceToTriage,
  questionGroupToTriage,
  reviewToTriage,
  type TriageCopy,
} from './triageAdapters';
import {
  isDeferral,
  reversibleStatus,
  routeDecision,
  undoDecision,
  type TriagePorts,
  type UndoableDecision,
} from './triageDispatch';
import {
  markUndone,
  readJournal,
  recordDecision,
  summariseJournal,
  type TriageJournalEntry,
  type TriageSessionSummary,
} from './triageJournal';
import { projectQueue, withoutSkip, withSkip, type SkipLedger } from './triageQueue';
import { adoptReach } from './triageReach';
import { clearTriageSession, loadTriageSession, saveTriageSession } from './triageSession';
import {
  TRIAGE_KINDS,
  type TriageCounts,
  type TriageDecision,
  type TriageItem,
  type TriageKind,
} from './triageTypes';

/** Statuses that still owe a human decision. */
const PENDING_PRACTICE_STATUSES = new Set(['observed', 'proposed']);

/**
 * The same two statuses, pushed into the QUERY rather than applied after it.
 *
 * `useWorkspaceCenter` fetched every status and this hook then discarded
 * everything but these two — in a mature workspace `adopted` is the largest
 * bucket, so most of the payload was read and thrown away on every refresh. The
 * client-side filter below stays as a correctness backstop: this hook must
 * behave identically for a caller that (or a future centre that) hands it
 * unfiltered rows.
 */
const PRACTICE_FETCH_STATUSES = ['observed', 'proposed'] as const;

/** Module constant so the hook argument keeps a stable identity. */
const PRACTICE_CENTER_OPTIONS = { statuses: PRACTICE_FETCH_STATUSES } as const;

/** One page of pending ideas is plenty for a triage session; the queue is a
 *  working set, not an archive. */
const IDEA_PAGE_SIZE = 60;

/** More successor options than this and the reason strip stops being one glance
 *  and one keypress. Digits only go to 9 anyway. */
const MAX_SUCCESSORS = 5;

/**
 * Both proposal ledgers are small by construction — the Fabric supersedes an
 * open proposal rather than stacking a second one for the same cell, and a
 * Darwin cycle rejects the previous pending proposal for a persona when it
 * files a new one. A cap this size exists to bound a pathological ledger, not
 * to page a queue that realistically holds single digits.
 */
const PROPOSAL_PAGE_SIZE = 50;

/**
 * How long the reviewer's LAST act stays takeable-back.
 *
 * Long enough to cover the real case — a mis-flicked card, noticed while reading
 * the next one — and short enough that the offer is never stale. It is not a
 * general "history": exactly one act is undoable, because a deck that lets you
 * walk backwards through a session is a deck you can spend a session walking
 * backwards through.
 */
const UNDO_WINDOW_MS = 30_000;

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

export interface IdeaBacklog {
  /** Ideas this session has pulled into the deck. */
  loaded: number;
  /** Ideas pending in SQLite, whatever the deck happens to hold. */
  pending: number;
  /** Whether another page exists. Drives "you cleared the batch, not the queue". */
  hasMore: boolean;
}

/**
 * The one act the reviewer can still take back.
 *
 * Two shapes because a deferral and a verdict fail differently: a skip wrote
 * nothing, so undoing it is local and infallible; a verdict wrote a row, so
 * undoing it is another compare-and-swap that can lose.
 */
export type TriageUndo =
  | { type: 'skip'; itemId: string; label: string; at: number }
  | { type: 'verdict'; record: UndoableDecision; label: string; at: number };

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
  /**
   * Deal a specific item next — what the queue rail's rows do.
   *
   * A pin on the projection, never a write and never a verdict: the item keeps
   * its place in the ledger and every other card keeps the order it had.
   */
  focusItem: (id: string) => void;
  /**
   * The TRUE size of the backlog behind the capped working set.
   *
   * `triageIdeas` returns a keyset page plus `counts`, and this hook used to keep
   * `page.ideas` and drop `cursor`, `hasMore` and `counts` on the floor. With 400
   * ideas pending, the deck dealt 60 and its cleared state was word-for-word the
   * one it shows when there is genuinely nothing left — the single most
   * misleading thing this surface could say.
   */
  backlog: IdeaBacklog;
  /** Pull the next page of ideas into the working set. No-op when there is none. */
  loadMore: () => void;
  /**
   * What this sitting has actually done — throughput, accept rate per kind,
   * typical time per card. Read from the decision journal, scoped to the
   * session, so it survives closing the deck exactly as the session does.
   */
  summary: TriageSessionSummary;
  /**
   * The last act, while it is still takeable-back. Null when there is nothing
   * to undo, when the window has passed, or when the row type has no reverse
   * door — see `triageDispatch#reversibleStatus`.
   */
  undo: TriageUndo | null;
  /** Take the last act back. No-op when {@link undo} is null. */
  undoLast: () => Promise<void>;
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
  const center = useWorkspaceCenter(PRACTICE_CENTER_OPTIONS);
  const projects = useSystemStore((s) => s.projects);
  // Promotion proposals carry a persona id and nothing human-readable; the
  // roster the app already holds is what turns it into a name and a colour.
  const personas = useAgentStore((s) => s.personas);
  // Idea verdicts go through the slice, not the API: see the port bundle below.
  const acceptIdeaViaStore = useSystemStore((s) => s.acceptIdea);
  const rejectIdeaViaStore = useSystemStore((s) => s.rejectIdea);

  const [ideas, setIdeas] = useState<DevIdea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(true);
  /**
   * Which page to fetch. `cursor` undefined = start over (a reload); set = append
   * the next page. `gen` makes a repeat request with the SAME cursor a distinct
   * state, so "load more" twice in a row is two fetches rather than one.
   */
  const [ideaFetch, setIdeaFetch] = useState<{ cursor?: string; gen: number }>({ gen: 0 });
  const [backlog, setBacklog] = useState<IdeaBacklog>({ loaded: 0, pending: 0, hasMore: false });
  const cursorRef = useRef<string | null>(null);

  /**
   * The session as it stood when the deck last closed.
   *
   * Read ONCE, synchronously, in the initialisers below — `QuickAnswerPopover`
   * unmounts whenever the header overlay changes, so every reopen is a fresh
   * mount and an effect-based rehydrate would paint the forgotten queue first.
   */
  const [restored] = useState(loadTriageSession);

  const [sessionStart, setSessionStart] = useState(() => restored.startedAt);
  const [resolved, setResolved] = useState<Set<string>>(() => restored.resolved);
  const [skips, setSkips] = useState<SkipLedger>(() => restored.skips);
  const [activeKinds, setActiveKinds] = useState<Set<TriageKind>>(
    () => restored.kinds ?? new Set(TRIAGE_KINDS),
  );
  /**
   * The card the reviewer jumped to from the queue rail, if any.
   *
   * Deliberately NOT persisted with the session: a jump is "deal me this one
   * next", which stops meaning anything the moment the deck is closed.
   */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /**
   * The journal, held as state so the summary recomputes when it is written.
   *
   * The entries themselves rather than a version counter: `readJournal()`
   * returns a NEW array on every write, so the array IS the version, and a
   * counter would be a second thing to keep in step with the first.
   */
  const [journalEntries, setJournalEntries] = useState<TriageJournalEntry[]>(readJournal);
  const [undo, setUndo] = useState<TriageUndo | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // Three independent writes rather than one: the hooks that own these pieces
  // change them at completely different rates (a filter chip is rare, a skip is
  // per-card), and `saveTriageSession` merges, so none of them can clobber the
  // drafts `useDeckControls` persists into the same record.
  useEffect(() => {
    saveTriageSession({ skips });
  }, [skips]);
  useEffect(() => {
    saveTriageSession({ kinds: activeKinds });
  }, [activeKinds]);
  useEffect(() => {
    saveTriageSession({ resolved });
  }, [resolved]);

  /**
   * The two proposal ledgers, and the generation counter that re-reads them.
   *
   * Separate from `ideaFetch.gen` on purpose: `loadMore()` bumps that counter to
   * deal the next PAGE of ideas, and re-querying two unrelated ledgers because
   * the reviewer asked for more backlog is work nobody asked for.
   */
  const [policyProposals, setPolicyProposals] = useState<PolicyProposal[]>([]);
  const [promotions, setPromotions] = useState<EvolutionPromotionProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);
  const [promotionsLoading, setPromotionsLoading] = useState(true);
  const [proposalGen, setProposalGen] = useState(0);

  const projectName = useCallback(
    (projectId: string | null) =>
      projectId ? projects.find((p) => p.id === projectId)?.name ?? '' : '',
    [projects],
  );

  // Ideas are the one source with no existing hook to borrow, so this owns the
  // fetch. Guarded by a generation counter rather than a ref so `reload()` and
  // `loadMore()` are plain state bumps.
  useEffect(() => {
    let cancelled = false;
    const appending = !!ideaFetch.cursor;
    setIdeasLoading(true);
    void devApi
      .triageIdeas(undefined, IDEA_PAGE_SIZE, ideaFetch.cursor, { status: 'pending' })
      .then((page) => {
        if (cancelled) return;
        cursorRef.current = page.cursor;
        setIdeas((prev) => {
          const next = appending ? [...prev, ...page.ideas] : page.ideas;
          // `counts` is scoped to the non-status filters, so `pending` is the
          // whole pending backlog rather than this page's slice.
          setBacklog({ loaded: next.length, pending: page.counts.pending, hasMore: page.hasMore });
          return next;
        });
      })
      .catch(toastCatch('Could not load backlog ideas'))
      .finally(() => {
        if (!cancelled) setIdeasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ideaFetch]);

  // The two proposal ledgers, fetched independently rather than in one
  // `Promise.all`: they are unrelated subsystems, and one being unavailable must
  // not take the other's queue out of the deck with it.
  useEffect(() => {
    let cancelled = false;
    setProposalsLoading(true);
    void policyTuningList(true, PROPOSAL_PAGE_SIZE)
      .then((rows) => {
        if (!cancelled) setPolicyProposals(rows);
      })
      .catch(toastCatch('Could not load tuning proposals'))
      .finally(() => {
        if (!cancelled) setProposalsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposalGen]);

  useEffect(() => {
    let cancelled = false;
    setPromotionsLoading(true);
    void listPromotionProposals({ status: 'pending', limit: PROPOSAL_PAGE_SIZE })
      .then((rows) => {
        if (!cancelled) setPromotions(rows);
      })
      .catch(toastCatch('Could not load promotion proposals'))
      .finally(() => {
        if (!cancelled) setPromotionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposalGen]);

  const personaById = useMemo(
    () => new Map(personas.map((p) => [p.id, p])),
    [personas],
  );

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

    for (const proposal of policyProposals) {
      // `policyTuningList(true, …)` already asks for pending only; the guard
      // keeps the deck honest for a backend that starts returning history.
      if (proposal.status !== 'pending') continue;
      out.push(policyProposalToTriage(proposal, copy));
    }

    for (const promotion of promotions) {
      if (promotion.status !== 'pending') continue;
      const persona = personaById.get(promotion.personaId);
      out.push(
        evolutionProposalToTriage(
          promotion,
          persona?.name || promotion.personaId,
          persona?.color ?? null,
          copy,
        ),
      );
    }

    return out;
  }, [
    interactions.reviews,
    interactions.questionGroups,
    ideas,
    center.workspaces,
    center.knowledge,
    center.projectById,
    policyProposals,
    promotions,
    personaById,
    copy,
    projectName,
  ]);

  const projection = useMemo(
    () => projectQueue({ all, resolved, skips, activeKinds, focused: focusedId }),
    [all, resolved, skips, activeKinds, focusedId],
  );

  /**
   * When the card currently on top BECAME the card on top.
   *
   * Time-per-decision is the one number that tells a slow queue apart from a
   * slow reviewer, and it is measured here rather than in the deck because the
   * queue is what decides which card is presented — the deck just renders
   * `items[0]`. A card that has been re-presented after a skip starts its clock
   * again, which is right: it is being read again.
   */
  const topId = projection.items[0]?.id ?? null;
  const topSinceRef = useRef<{ id: string | null; at: number }>({ id: null, at: Date.now() });
  if (topSinceRef.current.id !== topId) topSinceRef.current = { id: topId, at: Date.now() };

  const dwellFor = useCallback((item: TriageItem): number | undefined => {
    const { id, at } = topSinceRef.current;
    return id === item.id ? Date.now() - at : undefined;
  }, []);

  /** Journal a decision and let the summary know it has something new to say. */
  const journal = useCallback(
    (decision: TriageDecision, conflicted?: boolean) => {
      recordDecision({
        item: decision.item,
        verdict: decision.verdict,
        branchId: decision.branchId,
        reason: decision.reason,
        dwellMs: dwellFor(decision.item),
        conflicted,
      });
      setJournalEntries(readJournal());
    },
    [dwellFor],
  );

  /**
   * Offer this act back for a bounded window.
   *
   * The timer is what makes the offer honest: an undo button that sits there
   * forever invites a reviewer to take back a verdict from twenty cards ago,
   * whose side effects (a decision memory, an adoption fan-out, a queued task)
   * have long since been acted on by something else.
   */
  const arm = useCallback((next: TriageUndo | null) => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndo(next);
    if (!next) return;
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null;
      setUndo((current) => (current === next ? null : current));
    }, UNDO_WINDOW_MS);
  }, []);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  /** What the act was CALLED, in the item's own words — the undo button's label. */
  const actLabel = useCallback((decision: TriageDecision): string => {
    const branch = decision.branchId
      ? decision.item.branches.find((b) => b.id === decision.branchId)
      : undefined;
    return branch?.label ?? decision.item.verdictLabels[decision.verdict];
  }, []);

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

  const focusItem = useCallback((id: string) => setFocusedId(id), []);

  const reload = useCallback(() => {
    setResolved(new Set());
    setSkips(new Map());
    setFocusedId(null);
    // "Show me the world again" ENDS the session: a reviewer who asks for a
    // clean slate must not get last hour's deferrals back with it. The journal
    // survives (it is the record of what happened, not working state) but the
    // summary's window moves, so the next readout is about the new sitting.
    clearTriageSession();
    setSessionStart(Date.now());
    setUndo(null);
    setIdeaFetch((f) => ({ gen: f.gen + 1 }));
    setProposalGen((g) => g + 1);
    center.refreshKnowledge();
  }, [center]);

  /**
   * Deal the next page instead of starting over.
   *
   * Distinct from `reload` on purpose: reload forgets what this session decided
   * (it is "show me the world again"), while this keeps the session's progress
   * and extends the working set — which is what someone who just cleared 60 of
   * 400 actually wants.
   */
  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    setIdeaFetch((f) => ({ cursor, gen: f.gen + 1 }));
  }, []);

  /**
   * Re-read the sources WITHOUT forgetting what this session decided.
   *
   * Distinct from `reload`, which also clears `resolved`/`skips` — that is the
   * right shape for "show me the world again" and the wrong one for reacting to
   * somebody else's verdict landing mid-session: throwing away the reviewer's
   * own progress because a card they never touched was decided elsewhere is a
   * worse outcome than the conflict itself.
   */
  const refreshSources = useCallback(() => {
    setIdeaFetch((f) => ({ gen: f.gen + 1 }));
    setProposalGen((g) => g + 1);
    center.refreshKnowledge();
  }, [center]);

  /** Re-read only the two proposal ledgers — what a proposal verdict invalidates. */
  const refreshProposals = useCallback(() => setProposalGen((g) => g + 1), []);

  /** Every write a verdict can reach, in one injected bundle — see
   *  `triageDispatch`, which owns the routing itself. */
  const ports = useMemo<TriagePorts>(
    () => ({
      reviewAction: (id, status, notes) => interactions.handleReviewAction(id, status, notes),
      dispatchReviewAction: (id, action) => interactions.handleDispatchAction(id, action),
      createTask: (title, projectId, body, ideaId) =>
        devApi.createTask(title, projectId, body, ideaId),
      // Through the STORE, not `devApi` directly. The deck used to call the API
      // and bypass `devToolsTriageSlice` entirely, so accepting an idea here
      // never reached Approvals' Backlog tab: its rows and facet counts still
      // showed the item as pending until someone refetched. The slice is the one
      // door for an idea verdict; it writes the row, shifts the counts and
      // rejects on failure so the restore below can fire.
      acceptIdea: (id, seenStatus) => acceptIdeaViaStore(id, seenStatus),
      rejectIdea: (id, reason, seenStatus) => rejectIdeaViaStore(id, reason, seenStatus),
      decideKnowledge: (id, verdict, supersededBy, seenStatus) =>
        decidePracticeRow(id, verdict, { supersededBy, seenStatus }),
      refreshKnowledge: () => center.refreshKnowledge(),
      submitAnswers: (sessionId, answers) => interactions.submitQuestionAnswers(sessionId, answers),
      // Both proposal ledgers go through `rowWrites` for the same reason the
      // other three do: it is the module that owns the expectation contract and
      // the conflict wording, and a queue that wrote proposals directly through
      // `@/api` would be the sixteenth call site with its own error handling.
      applyPolicy: (id, seenStatus) => decidePolicyProposalRow(id, 'apply', { seenStatus }),
      declinePolicy: (id, reason, seenStatus) =>
        decidePolicyProposalRow(id, 'decline', { reason, seenStatus }),
      decideEvolution: (id, approve, note, seenStatus) =>
        decideEvolutionProposalRow(id, approve ? 'approve' : 'reject', {
          reason: note,
          seenStatus,
        }),
      refreshProposals,
      reopenIdea: (id, seenStatus) => reopenIdeaRow(id, { seenStatus }),
      reopenPractice: (id, seenStatus) => reopenPracticeRow(id, { seenStatus }),
      openBuilder: onOpenBuilder,
    }),
    [
      interactions,
      center,
      onOpenBuilder,
      acceptIdeaViaStore,
      rejectIdeaViaStore,
      refreshProposals,
    ],
  );

  /**
   * The toast every lost swap raises, from wherever it was lost.
   *
   * Shared between `decide` and `undoLast` deliberately: an undo that loses is
   * not a special failure with special copy — it is the same event, and telling
   * the reviewer so in different words would make them think it was.
   */
  const sayConflict = useCallback(() => {
    const t = getActiveTranslations();
    useToastStore.getState().addToast(t.error_registry.decision_conflict_message, 'warning', 4000);
  }, []);

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

      // A deferral writes nothing, so it must not resolve anything either. It
      // IS journalled: "I looked at this and could not judge it" is the most
      // informative thing a reviewer does, and a session readout that counts
      // only verdicts describes a session that did not happen.
      if (isDeferral(decision)) {
        setSkips((prev) => withSkip(prev, item.id));
        journal(decision);
        arm({ type: 'skip', itemId: item.id, label: item.verdictLabels.skip, at: Date.now() });
        return;
      }

      // Optimistic: drop it now, restore only if the write actually fails.
      setResolved((prev) => new Set(prev).add(item.id));

      try {
        await routeDecision(decision, ports);
        journal(decision);
        // Only rows with a reverse door are offered back. Anything else clears
        // the slot rather than leaving the previous card's offer standing over
        // a decision that has since been made — see `reversibleStatus`.
        const producedStatus = reversibleStatus(decision);
        arm(
          producedStatus
            ? {
                type: 'verdict',
                record: { decision, producedStatus, at: Date.now() },
                label: actLabel(decision),
                at: Date.now(),
              }
            : null,
        );
      } catch (error) {
        // A LOST COMPARE-AND-SWAP is not a failed write — the row IS decided,
        // just not by this reviewer (Athena's Night Shift resolves approvals
        // unattended, so this is routine rather than exotic). Putting the card
        // back would be a lie and would re-offer a decision that can never land.
        // Say what happened, keep it resolved, and re-read so the rest of the
        // queue reflects whoever won.
        if (isDecisionConflict(error)) {
          // Journalled as spent-and-lost: it is throughput the reviewer paid
          // for and did not get, and a session full of these means something
          // else is working the same queue.
          journal(decision, true);
          arm(null);
          sayConflict();
          refreshSources();
          return;
        }
        // Put it back: a failed write must not look like a completed decision.
        setResolved((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        arm(null);
        toastCatch('Could not record that decision')(error);
      }
    },
    [ports, refreshSources, journal, arm, actLabel, sayConflict],
  );

  /**
   * Take the last act back.
   *
   * The verdict branch is the interesting one: it is a WRITE, against the status
   * the reviewer's own verdict produced, and it loses the swap in exactly the
   * same way and with exactly the same message as any other verdict that arrives
   * second. That is not a limitation worked around — it is the point. An undo
   * that could overwrite whoever decided the row in the meantime would be a
   * worse bug than the mis-flick it exists to fix.
   *
   * On a lost undo the card stays resolved: the row IS decided, just not by this
   * reviewer, and the sources are re-read so the queue reflects the winner.
   */
  const undoLast = useCallback(async () => {
    const slot = undo;
    if (!slot) return;

    if (slot.type === 'skip') {
      // A deferral wrote nothing, so taking it back cannot fail and cannot lose.
      setSkips((prev) => withoutSkip(prev, slot.itemId));
      markUndone(slot.itemId);
      setJournalEntries(readJournal());
      arm(null);
      return;
    }

    const itemId = slot.record.decision.item.id;
    try {
      await undoDecision(slot.record, ports);
      setResolved((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      markUndone(itemId);
      setJournalEntries(readJournal());
      arm(null);
      // The row's true status is whatever the reopen wrote; re-read rather than
      // reconstruct it, so the card comes back with the facts it now has.
      refreshSources();
    } catch (error) {
      arm(null);
      if (isDecisionConflict(error)) {
        sayConflict();
        refreshSources();
        return;
      }
      toastCatch('Could not undo that decision')(error);
    }
  }, [undo, ports, arm, refreshSources, sayConflict]);

  /** What this sitting has done. Recomputed whenever the journal is written. */
  const summary = useMemo(
    () => summariseJournal(journalEntries, sessionStart),
    [journalEntries, sessionStart],
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

  // Memoised for the same reason as its three inputs: the deck's stacked cards
  // are memoised components whose `onCommit` closes over `queue`, so a fresh
  // queue object per render re-rendered (and re-parsed the markdown of) every
  // card on every keystroke in the answer box.
  return useMemo(
    () => ({
      items: projection.items,
      allCounts: projection.allCounts,
      loading: interactions.loading || ideasLoading || proposalsLoading || promotionsLoading,
      activeKinds,
      toggleKind,
      decidedCount: resolved.size,
      sessionTotal: projection.sessionTotal,
      deferredCount: projection.deferredCount,
      skips,
      focusItem,
      backlog,
      loadMore,
      summary,
      undo,
      undoLast,
      decide,
      openLink,
      reload,
    }),
    [
      projection,
      interactions.loading,
      ideasLoading,
      proposalsLoading,
      promotionsLoading,
      activeKinds,
      toggleKind,
      resolved.size,
      skips,
      focusItem,
      backlog,
      summary,
      undo,
      undoLast,
      loadMore,
      decide,
      openLink,
      reload,
    ],
  );
}
