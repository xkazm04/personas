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
 *  • goal acceptance — goals a team has finished and parked in
 *    `awaiting_acceptance`, waiting for a human to sign them off.
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
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
import { extractMessage, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { getActiveTranslations } from '@/i18n/useTranslation';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { EvolutionPromotionProposal } from '@/lib/bindings/EvolutionPromotionProposal';
import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';
import type { PolicyProposal } from '@/lib/bindings/PolicyProposal';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

import { usePendingInteractions } from '../usePendingInteractions';
import {
  DEFAULT_TRIAGE_COPY,
  evolutionProposalToTriage,
  goalToTriage,
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

/**
 * The seven queues this deck fuses, named so a failure can say WHICH one.
 *
 * `question` is absent deliberately: build questions are read out of the agent
 * store, which the event bridge keeps live — there is no fetch here that can
 * fail, so there is no failure to report.
 */
export type TriageSource = 'reviews' | 'ideas' | 'practices' | 'policy' | 'evolution' | 'goals';

/** One source that did not answer, and what it said. */
export interface TriageSourceFailure {
  source: TriageSource;
  /** The raw message. Shown in the failed ending's detail line, not the headline. */
  message: string;
}

export interface TriageBacklog {
  /** Ideas this session has pulled into the deck. */
  loaded: number;
  /** Ideas pending in SQLite, whatever the deck happens to hold. */
  pending: number;
  /** Whether another IDEA page exists. Drives the top bar's `n / N` chip. */
  hasMore: boolean;
  /**
   * Ideas still pending behind the working set. EXACT — the keyset page is the
   * one source that reports its own total, so this is the only number the deck
   * is allowed to print.
   */
  remaining: number;
  /**
   * Sources whose fixed-limit query came back FULL.
   *
   * A query that asks for 50 and gets 50 has told you nothing about what is
   * behind it. There is no count to print, but "we may have shown you a slice"
   * is still the truth, and a deck that answers it with "nothing is waiting on
   * you" is the exact lie this field exists to stop.
   */
  capped: readonly TriageSource[];
  /**
   * Anything at all sits behind the working set — a further idea page, or a
   * capped source. `remaining` may be 0 while this is true.
   */
  more: boolean;
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
  /**
   * Index of the card being decided. NOT always 0 — see `triageQueue#cursorId`.
   *
   * Read it wherever you would have written `items[0]`: the deck deals
   * `items[cursor]`, stacks `items[cursor + 1..]` behind it for depth, and the
   * rail marks `cursor` as current.
   */
  cursor: number;
  /** Tally of everything still awaiting a decision, before the kind filter —
   *  drives the filter chips. */
  allCounts: TriageCounts;
  loading: boolean;
  /**
   * Sources that did not answer this load — empty when everything read cleanly.
   *
   * The deck used to have no such field at all: every source ended in a
   * `.catch(toastCatch(…))`, so a total outage settled `loading:false` with an
   * empty array and rendered "Deck cleared — nothing is waiting on you", and a
   * partial outage was silently a smaller queue. A triage surface that
   * under-reports work is worse than one that is merely broken, because the
   * reviewer stops looking.
   */
  failures: readonly TriageSourceFailure[];
  activeKinds: Set<TriageKind>;
  toggleKind: (kind: TriageKind) => void;
  /**
   * Put every kind back in play — the filtered ending's own action.
   *
   * The filtered ending used to render no button at all, so a reviewer who had
   * switched a kind off and reached the end of the rest was shown a dead end
   * describing a queue they could not get back to.
   */
  showAllKinds: () => void;
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
   * Move the deck's read head to this item — what the queue rail's rows do.
   *
   * Moves the CURSOR, never the item: nothing is reordered, renumbered or
   * written, and the deck carries on from that position rather than returning
   * to the front. See `triageQueue#cursorId`.
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
   *
   * `capped` extends the same honesty to the sources that have no `hasMore` to
   * report: they are read at a fixed limit, and a full page means the deck is
   * holding a slice it cannot size.
   */
  backlog: TriageBacklog;
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
  /**
   * Deep-link to a project's goals board — the goal card's "open the board"
   * branch. Absent when the host has no route, in which case the branch reports
   * that rather than resolving the card for free (see `triageDispatch`).
   */
  onOpenGoalBoard?: (projectId: string) => void;
}

/**
 * Module-scoped warm cache — what the four self-owned sources held when the
 * deck last rendered, so a REOPEN paints the queue instantly instead of
 * re-ghosting over data the app read seconds ago.
 *
 * `QuickAnswerPopover` unmounts whenever the header overlay changes, so every
 * reopen used to be a full cold load: four fetch effects from zero, ghost cards
 * over an empty stack, and the reviewer's queue arriving in pieces — for rows
 * that had not changed since they closed the deck to go check something. This
 * is the same posture as the overview's module-scoped list caches (a view that
 * fully unmounts on nav-away keeps its last fetch so a remount paints warm):
 * the state initialisers below seed from it, the fetch effects still run on
 * mount and REVALIDATE, and the effect that maintains it writes every change
 * back. Stale-while-revalidate, not a TTL cache — a card resolved elsewhere
 * while the deck was closed is replaced by the first revalidation, and a
 * verdict raced against it lands in the same compare-and-swap conflict path a
 * mid-session race always did.
 *
 * The idea revalidation deliberately restarts from the FIRST page (`ideaFetch`
 * has no persisted cursor): the cache exists to kill the reopen ghost, not to
 * preserve a paged working set whose later pages may have shifted under it.
 *
 * The two borrowed sources (reviews via `usePendingInteractions`, practices via
 * `useWorkspaceCenter`) still cold-load — their hooks own that state — but with
 * the owned four seeded the stack is non-empty on first paint, which is what
 * gates the ghost.
 */
interface TriageWarmCache {
  ideas: DevIdea[];
  ideaPage: { loaded: number; pending: number; hasMore: boolean };
  ideaCursor: string | null;
  policyProposals: PolicyProposal[];
  promotions: EvolutionPromotionProposal[];
  goals: PendingAcceptanceGoal[];
}

let warmCache: TriageWarmCache | null = null;

/**
 * Test hatch — module state must be resettable or every test inherits the last
 * one's queue (the exact leak `resetJournalCache` / `resetTriageSessionCache`
 * exist to stop in this module's two siblings). Production never calls it: the
 * cache outliving the deck is the feature.
 */
export function resetTriageWarmCache(): void {
  warmCache = null;
}

export function useUnifiedTriage(
  copy: TriageCopy = DEFAULT_TRIAGE_COPY,
  hosts: UnifiedTriageHosts = {},
): UnifiedTriageQueue {
  const { onOpenBuilder, onOpenRun, onOpenGoalBoard } = hosts;
  // The two BORROWED sources, deferred. Their hooks own their fetch state, so
  // this hook cannot mark those landings as transitions the way it does for the
  // four sources it owns below — `useDeferredValue` is the consumer-side
  // equivalent: when a poll or the cold load replaces `reviews`/`knowledge`,
  // the urgent re-render keeps the previous value (every memo under it holds)
  // and the tree that actually mounts three markdown cards and the queue rail
  // is built at deferred priority, off the urgent frame. On MOUNT the deferred
  // value IS the current value, so a warm reopen pays no extra render and never
  // shows a stale frame. The one-frame lag on later updates is nothing this
  // surface can notice: both sources are already 15–30s polls, and every write
  // is id-addressed with a compare-and-swap conflict path behind it.
  const liveInteractions = usePendingInteractions();
  const interactions = useDeferredValue(liveInteractions);
  const liveCenter = useWorkspaceCenter(PRACTICE_CENTER_OPTIONS);
  const center = useDeferredValue(liveCenter);
  const projects = useSystemStore((s) => s.projects);
  // Promotion proposals carry a persona id and nothing human-readable; the
  // roster the app already holds is what turns it into a name and a colour.
  const personas = useAgentStore((s) => s.personas);
  // Idea verdicts go through the slice, not the API: see the port bundle below.
  const acceptIdeaViaStore = useSystemStore((s) => s.acceptIdea);
  const rejectIdeaViaStore = useSystemStore((s) => s.rejectIdea);
  // Goal verdicts, for the same reason: the slice owns the row write AND the
  // pending-acceptance count refresh, and bypassing it is how a verdict here
  // fails to show up somewhere else. Both rethrow on a failed write, so the
  // deck's restore path can fire.
  const acceptGoalViaStore = useSystemStore((s) => s.acceptGoal);
  const rejectGoalViaStore = useSystemStore((s) => s.rejectGoal);
  // The title-bar badge counts exactly what this deck deals, and it is polled
  // on a 30s bucket — so without a nudge here, clearing a card leaves the
  // number it is meant to be clearing standing for up to half a minute.
  const refreshPendingCounts = useSystemStore((s) => s.refreshPendingCounts);

  // Seeded from the warm cache so a reopen deals cards on first paint; the
  // fetch effects below still run and revalidate. `loading` starts false when
  // warm — the deck is showing real rows, not waiting on anything it knows of.
  const [ideas, setIdeas] = useState<DevIdea[]>(() => warmCache?.ideas ?? []);
  const [ideasLoading, setIdeasLoading] = useState(!warmCache);
  /**
   * Which page to fetch. `cursor` undefined = start over (a reload); set = append
   * the next page. `gen` makes a repeat request with the SAME cursor a distinct
   * state, so "load more" twice in a row is two fetches rather than one.
   */
  const [ideaFetch, setIdeaFetch] = useState<{ cursor?: string; gen: number }>({ gen: 0 });
  const [ideaPage, setIdeaPage] = useState(
    () => warmCache?.ideaPage ?? { loaded: 0, pending: 0, hasMore: false },
  );
  const cursorRef = useRef<string | null>(warmCache?.ideaCursor ?? null);

  /**
   * Which sources failed, and which came back full.
   *
   * Both are keyed records rather than a boolean per source so a seventh queue
   * costs one entry, not two more `useState`s and two more memo deps — and both
   * are written through the helpers below, which BAIL OUT when nothing changed.
   * That matters more than it looks: these are set from inside a 30s poll, and a
   * fresh object per poll would re-run the whole projection for no news.
   */
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<TriageSource, string>>>({});
  const [cappedSources, setCappedSources] = useState<readonly TriageSource[]>([]);

  const noteFailure = useCallback((source: TriageSource, message: string | null) => {
    setSourceErrors((prev) => {
      if ((prev[source] ?? null) === message) return prev;
      const next = { ...prev };
      if (message) next[source] = message;
      else delete next[source];
      return next;
    });
  }, []);

  const noteCapped = useCallback((source: TriageSource, capped: boolean) => {
    setCappedSources((prev) => {
      if (prev.includes(source) === capped) return prev;
      return capped ? [...prev, source] : prev.filter((s) => s !== source);
    });
  }, []);

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
   * WHERE the reviewer is in the queue — the id of the card being dealt.
   *
   * An ID and never an index: the polls replace `items` wholesale every 15–30s,
   * and a remembered number would come to mean a different card without anything
   * announcing it. `null` means "the front", which is where a session starts and
   * where the cursor lands again whenever the card it named leaves the queue.
   *
   * Deliberately NOT persisted with the session: a position is "I am working
   * here right now", which stops meaning anything the moment the deck is closed.
   */
  const [cursorId, setCursorId] = useState<string | null>(null);
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

  /**
   * One write, and never on mount.
   *
   * This used to be THREE effects — skips, kinds, resolved — each a
   * read-modify-write that re-serialises the whole record (drafts included: up
   * to `MAX_DRAFTS × MAX_DRAFT_CHARS`). All three fire on mount, where the
   * values are precisely what was just READ out of storage, so opening the deck
   * cost three full `JSON.stringify` passes to write back byte-identical state.
   * And `reload()` changes all three in one commit, which cost three more.
   *
   * Coalescing loses nothing: `saveTriageSession` still MERGES, so this half of
   * the record still cannot clobber the drafts `useDeckControls` owns, and the
   * effect still only runs when one of the three actually changed.
   *
   * `startedAt` rides along because skipping the mount write removed the thing
   * that used to stamp it — see `TriageSessionPatch.startedAt`.
   */
  const sessionWritten = useRef(false);
  useEffect(() => {
    if (!sessionWritten.current) {
      sessionWritten.current = true;
      return;
    }
    saveTriageSession({ skips, kinds: activeKinds, resolved, startedAt: sessionStart });
  }, [skips, activeKinds, resolved, sessionStart]);

  /**
   * The two proposal ledgers, and the generation counter that re-reads them.
   *
   * Separate from `ideaFetch.gen` on purpose: `loadMore()` bumps that counter to
   * deal the next PAGE of ideas, and re-querying two unrelated ledgers because
   * the reviewer asked for more backlog is work nobody asked for.
   */
  const [policyProposals, setPolicyProposals] = useState<PolicyProposal[]>(
    () => warmCache?.policyProposals ?? [],
  );
  const [promotions, setPromotions] = useState<EvolutionPromotionProposal[]>(
    () => warmCache?.promotions ?? [],
  );
  const [proposalsLoading, setProposalsLoading] = useState(!warmCache);
  const [promotionsLoading, setPromotionsLoading] = useState(!warmCache);
  const [proposalGen, setProposalGen] = useState(0);

  /**
   * Goals parked in `awaiting_acceptance`, and their own generation counter.
   *
   * A third counter rather than a third user of `proposalGen`: a goal verdict
   * invalidates the goal ledger and nothing else, and re-querying two unrelated
   * proposal subsystems because somebody signed off a finished goal is work
   * nobody asked for — the same reason `proposalGen` is separate from
   * `ideaFetch.gen`.
   */
  const [goals, setGoals] = useState<PendingAcceptanceGoal[]>(() => warmCache?.goals ?? []);
  const [goalsLoading, setGoalsLoading] = useState(!warmCache);
  const [goalGen, setGoalGen] = useState(0);

  // Keep the warm cache current. Every path that changes one of these goes
  // through a setState, so one effect covers the initial load, every poll and
  // every optimistic removal — and the seeded first render writes back the
  // values it was seeded FROM, which is a no-op by value.
  useEffect(() => {
    warmCache = {
      ideas,
      ideaPage,
      ideaCursor: cursorRef.current,
      policyProposals,
      promotions,
      goals,
    };
  }, [ideas, ideaPage, policyProposals, promotions, goals]);

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
        // The landing is a TRANSITION, and the loading flip rides INSIDE it.
        // A cold open otherwise commits the whole dealt deck — three markdown
        // parses, the queue rail, the action bar — in one urgent frame the
        // moment this settles, blocking the overlay's own entrance animation.
        // As a transition the ghost stack stays up (urgent tree unchanged)
        // while React builds the data tree interruptibly. `setIdeasLoading`
        // must be in the SAME transition as the data: flipped urgently it
        // would land first, and `loading:false` over a still-empty stack
        // renders the CLEARED ending for a frame — the exact lie DeckFailed
        // exists to stop, told by a scheduler race.
        startTransition(() => {
          noteFailure('ideas', null);
          setIdeas((prev) => {
            const next = appending ? [...prev, ...page.ideas] : page.ideas;
            // `counts` is scoped to the non-status filters, so `pending` is the
            // whole pending backlog rather than this page's slice.
            setIdeaPage({
              loaded: next.length,
              pending: page.counts.pending,
              hasMore: page.hasMore,
            });
            return next;
          });
          setIdeasLoading(false);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          startTransition(() => {
            noteFailure('ideas', extractMessage(error));
            setIdeasLoading(false);
          });
        }
        toastCatch('Could not load backlog ideas')(error);
      });
    return () => {
      cancelled = true;
    };
  }, [ideaFetch, noteFailure]);

  // The two proposal ledgers, fetched independently rather than in one
  // `Promise.all`: they are unrelated subsystems, and one being unavailable must
  // not take the other's queue out of the deck with it.
  useEffect(() => {
    let cancelled = false;
    setProposalsLoading(true);
    void policyTuningList(true, PROPOSAL_PAGE_SIZE)
      .then((rows) => {
        if (cancelled) return;
        // Transition, loading flip inside it — see the ideas effect above for
        // why the pair must land together.
        startTransition(() => {
          setPolicyProposals(rows);
          noteFailure('policy', null);
          // A fixed-limit query that returns exactly its limit is a slice, and
          // this ledger is small BY CONSTRUCTION rather than by guarantee.
          noteCapped('policy', rows.length >= PROPOSAL_PAGE_SIZE);
          setProposalsLoading(false);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          startTransition(() => {
            noteFailure('policy', extractMessage(error));
            setProposalsLoading(false);
          });
        }
        toastCatch('Could not load tuning proposals')(error);
      });
    return () => {
      cancelled = true;
    };
  }, [proposalGen, noteFailure, noteCapped]);

  useEffect(() => {
    let cancelled = false;
    setPromotionsLoading(true);
    void listPromotionProposals({ status: 'pending', limit: PROPOSAL_PAGE_SIZE })
      .then((rows) => {
        if (cancelled) return;
        startTransition(() => {
          setPromotions(rows);
          noteFailure('evolution', null);
          noteCapped('evolution', rows.length >= PROPOSAL_PAGE_SIZE);
          setPromotionsLoading(false);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          startTransition(() => {
            noteFailure('evolution', extractMessage(error));
            setPromotionsLoading(false);
          });
        }
        toastCatch('Could not load promotion proposals')(error);
      });
    return () => {
      cancelled = true;
    };
  }, [proposalGen, noteFailure, noteCapped]);

  // Goals get their own effect for the same reason the two proposal ledgers do:
  // an install whose goals command errors must still be dealt its reviews, its
  // ideas and its practices. One `Promise.all` over unrelated subsystems is how
  // one unavailable source takes the whole queue down with it.
  useEffect(() => {
    let cancelled = false;
    setGoalsLoading(true);
    void devApi
      .listPendingAcceptance()
      .then((rows) => {
        if (cancelled) return;
        startTransition(() => {
          setGoals(rows);
          noteFailure('goals', null);
          setGoalsLoading(false);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          startTransition(() => {
            noteFailure('goals', extractMessage(error));
            setGoalsLoading(false);
          });
        }
        toastCatch('Could not load goals awaiting acceptance')(error);
      });
    return () => {
      cancelled = true;
    };
  }, [goalGen, noteFailure]);

  // The two sources this hook does NOT own the fetch for report their failure
  // as a value rather than a rejection, so they are mirrored into the same
  // ledger instead of being a second thing the deck has to ask about.
  useEffect(() => {
    noteFailure('reviews', interactions.reviewsError);
  }, [interactions.reviewsError, noteFailure]);
  useEffect(() => {
    noteFailure('practices', center.knowledgeError);
  }, [center.knowledgeError, noteFailure]);
  // The review read is bounded (see `usePendingInteractions`), so it joins the
  // capped set the same way the two fixed-limit ledgers do.
  useEffect(() => {
    noteCapped('reviews', interactions.reviewsHasMore);
  }, [interactions.reviewsHasMore, noteCapped]);

  const failures = useMemo<readonly TriageSourceFailure[]>(
    () =>
      (Object.entries(sourceErrors) as [TriageSource, string][]).map(([source, message]) => ({
        source,
        message,
      })),
    [sourceErrors],
  );

  const backlog = useMemo<TriageBacklog>(() => {
    // Only ideas can name a number. Everything else contributes "there may be
    // more", which is why `more` is not derived from `remaining`.
    const remaining = ideaPage.hasMore ? Math.max(0, ideaPage.pending - ideaPage.loaded) : 0;
    return {
      ...ideaPage,
      remaining,
      capped: cappedSources,
      more: ideaPage.hasMore || cappedSources.length > 0,
    };
  }, [ideaPage, cappedSources]);

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

    // "Accept all N from this KPI" is the bulk affordance the goals board was
    // built around, and the adapter is store-free — it cannot go and ask which
    // other goals sit on the same KPI. So the grouping happens once here and
    // each card is handed its KPI-mates' ids. Goals with no KPI have no batch:
    // there is nothing for them to be batched WITH.
    const goalIdsByKpi = new Map<string, string[]>();
    for (const goal of goals) {
      if (!goal.kpi_id) continue;
      const bucket = goalIdsByKpi.get(goal.kpi_id);
      if (bucket) bucket.push(goal.goal_id);
      else goalIdsByKpi.set(goal.kpi_id, [goal.goal_id]);
    }
    for (const goal of goals) {
      out.push(goalToTriage(goal, goal.kpi_id ? goalIdsByKpi.get(goal.kpi_id) ?? [] : [], copy));
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
    goals,
    personaById,
    copy,
    projectName,
  ]);

  const projection = useMemo(
    () => projectQueue({ all, resolved, skips, activeKinds, cursorId }),
    [all, resolved, skips, activeKinds, cursorId],
  );

  /**
   * The latest projection, for `advanceCursor` to read WITHOUT depending on it.
   *
   * `decide` is the root of the memo chain this whole surface rests on
   * (`TriageCard`'s doc spells out what one unstable callback costs: three
   * markdown re-renders per keystroke). Taking `projection` as a dependency
   * would re-create `decide` on every poll, so the successor is read through a
   * ref at call time instead — which is also when it is actually true.
   */
  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  /**
   * Hand the read head to whatever will occupy this card's slot next.
   *
   * The whole point of the cursor: a card decided at position 18 must leave the
   * deck reading position 18, not send it back to the front. `items[cursor + 1]`
   * is the card that slides up into the slot — the same one for a verdict (the
   * row leaves) and for a skip (the row sorts to the tail).
   *
   * `undefined` at the end of the queue collapses to `null`, which the
   * projection reads as "the front": clear the tail you jumped to, and the deck
   * wraps to whatever is still waiting at the top.
   *
   * The equality guard matters. Only the card UNDER the cursor moves it; a
   * verdict that lands on anything else (an undo replay, a stale in-flight
   * commit) leaves the reviewer's position exactly where they put it.
   */
  const advanceCursor = useCallback((leavingId: string) => {
    setCursorId((current) => {
      if (current !== leavingId) return current;
      const { items, cursor } = projectionRef.current;
      return items[cursor + 1]?.id ?? null;
    });
  }, []);

  /**
   * When the card currently on top BECAME the card on top.
   *
   * Time-per-decision is the one number that tells a slow queue apart from a
   * slow reviewer, and it is measured here rather than in the deck because the
   * queue is what decides which card is presented — the deck just renders
   * `items[cursor]`. A card that has been re-presented after a skip starts its
   * clock again, which is right: it is being read again.
   */
  const topId = projection.items[projection.cursor]?.id ?? null;
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

  // Not `TRIAGE_KINDS.forEach(toggleKind)`: toggling refuses to switch the LAST
  // kind off, so replaying it over an already-full set would leave six on and
  // one off. One assignment, no ordering to reason about.
  const showAllKinds = useCallback(() => setActiveKinds(new Set(TRIAGE_KINDS)), []);

  const focusItem = useCallback((id: string) => setCursorId(id), []);

  const reload = useCallback(() => {
    setResolved(new Set());
    setSkips(new Map());
    setCursorId(null);
    // "Show me the world again" ENDS the session: a reviewer who asks for a
    // clean slate must not get last hour's deferrals back with it. The journal
    // survives (it is the record of what happened, not working state) but the
    // summary's window moves, so the next readout is about the new sitting.
    clearTriageSession();
    setSessionStart(Date.now());
    setUndo(null);
    setIdeaFetch((f) => ({ gen: f.gen + 1 }));
    setProposalGen((g) => g + 1);
    setGoalGen((g) => g + 1);
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
    setGoalGen((g) => g + 1);
    center.refreshKnowledge();
    // Whatever moved these sources moved the title-bar badge with them — a
    // verdict lost to someone else, or an undo that put a row back.
    void refreshPendingCounts();
  }, [center, refreshPendingCounts]);

  /** Re-read only the two proposal ledgers — what a proposal verdict invalidates. */
  const refreshProposals = useCallback(() => setProposalGen((g) => g + 1), []);

  /** Re-read only the goal ledger — what a goal verdict invalidates. */
  const refreshGoals = useCallback(() => setGoalGen((g) => g + 1), []);

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
      // Each goal write re-reads the goal ledger, the way a proposal verdict
      // re-reads the proposal ones. The store refreshes the pending COUNT, not
      // the rows this hook holds — and `accept-kpi-batch` signs off SIBLINGS the
      // deck is still holding cards for, so without the re-read those cards stay
      // in the queue and the next verdict on one of them writes into a goal that
      // is already signed off. A rejected write throws before it gets here,
      // which is what leaves the restore path free to put the card back.
      acceptGoal: async (id) => {
        await acceptGoalViaStore(id);
        refreshGoals();
      },
      rejectGoal: async (id, comment) => {
        await rejectGoalViaStore(id, comment);
        refreshGoals();
      },
      reopenIdea: (id, seenStatus) => reopenIdeaRow(id, { seenStatus }),
      reopenPractice: (id, seenStatus) => reopenPracticeRow(id, { seenStatus }),
      openBuilder: onOpenBuilder,
      openGoalBoard: onOpenGoalBoard,
    }),
    [
      interactions,
      center,
      onOpenBuilder,
      onOpenGoalBoard,
      acceptIdeaViaStore,
      rejectIdeaViaStore,
      acceptGoalViaStore,
      rejectGoalViaStore,
      refreshProposals,
      refreshGoals,
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

      // Move the read head BEFORE the card leaves, while the successor is still
      // computable from the current order. Both branches below remove this card
      // from the slot — a verdict drops it, a skip sorts it to the tail — and
      // either way the deck must go on from here rather than from the front.
      advanceCursor(item.id);

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
        // The row is gone from a queue the title-bar badge counts, so the badge
        // owes an update NOW rather than on its next 30s tick — a reviewer who
        // clears the deck and watches the number sit there reads it as broken.
        // Deliberately not awaited: a badge is never worth blocking the next
        // card on, and the refresh swallows its own failures.
        void refreshPendingCounts();
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
        // And put the reviewer back ON it — the cursor moved on optimistically
        // with the card, so without this the restored row reappears at its
        // sorted place behind a read head that has already walked past it.
        setResolved((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setCursorId(item.id);
        arm(null);
        toastCatch('Could not record that decision')(error);
      }
    },
    [
      ports,
      refreshSources,
      refreshPendingCounts,
      journal,
      arm,
      actLabel,
      sayConflict,
      advanceCursor,
    ],
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
      // An undo is "deal me that one again", so it takes the read head back with
      // it. Without this the restored card returns to its sorted position — which
      // for an un-skip is the middle of the queue — and is not re-presented at
      // all until the cursor happens to reach it.
      setCursorId(slot.itemId);
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
      // Same as the skip branch: the card comes back, and so does the reviewer.
      setCursorId(itemId);
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
      cursor: projection.cursor,
      allCounts: projection.allCounts,
      loading:
        interactions.loading ||
        ideasLoading ||
        proposalsLoading ||
        promotionsLoading ||
        goalsLoading,
      failures,
      activeKinds,
      toggleKind,
      showAllKinds,
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
      goalsLoading,
      failures,
      activeKinds,
      toggleKind,
      showAllKinds,
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
