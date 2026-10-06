// useMonitorData — data layer for the Persona Monitor.
//
// Gathers every feed the Monitor fuses: the persona roster + health, the
// pending human-review queue (local + cloud), unread messages, and live
// process activity. Self-contained — the Monitor can mount this from the
// titlebar without depending on the Overview dashboard pipeline.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import {
  getPendingReviewCountsByPersona,
  listManualReviews,
  listManualReviewsPage,
} from '@/api/overview/reviews';
import { resolveReviewRow, dispatchReviewRowAction, isDecisionConflict } from '@/lib/decisions/rowWrites';
import {
  getUnreadReportCountsByPersona,
  listReports,
  markReportRead,
} from '@/api/overview/reports';
import { severityBucket, type ReviewBadgeCount } from './monitorModel';
import { useMonitorVisible } from './monitorVisibility';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { usePersonaMap, useEnrichedRecords } from '@/hooks/utility/data/usePersonaMap';
import { useReportCreatedListener } from '@/hooks/realtime/useReportCreatedListener';
import { extractMessage } from '@/lib/silentCatch';
import { resolveError } from '@/lib/errors/errorRegistry';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import { createLogger } from '@/lib/log';

const logger = createLogger('persona-monitor');

/** Most recent messages scanned for unread state — unread skews recent. */
const MESSAGE_SCAN_LIMIT = 300;

/**
 * The pending-review working set every surface in the overlay deals from.
 *
 * `list_manual_reviews` takes no limit, so an unbounded poll re-reads and
 * re-shapes EVERY pending row on every tick. This is a working set, not an
 * archive, and the cap is reported ({@link MonitorData.reviewsHasMore}) so a
 * truncated read can never be presented as a finished queue.
 *
 * 100 rather than the command's default 40: a reviewer who opens the deck to
 * clear a backlog should get the whole backlog in one deal on any realistic
 * install, and the cap exists to bound a pathological queue rather than to page
 * a normal one.
 *
 * It lives HERE rather than beside the deck because the Monitor and the Quick
 * Answer popover must bound the read identically: {@link reviewsWarmCache} is
 * keyed by the bound, so two different caps would be two warm caches for the
 * same queue and a surface would paint the other one's rows on open.
 */
export const MONITOR_REVIEW_LIMIT = 100;

/**
 * A review row with the three columns `PersonaManualReview` carries that the
 * shared {@link ManualReviewItem} shape never had a home for.
 *
 * `assignment_id` / `step_id` are the load-bearing pair: a review that has them
 * was emitted by a persona running as a TEAM STEP, and that step is HELD until
 * someone rules on it. Approving such a review resumes work that is currently
 * stopped — a materially different act from approving an advisory review, and
 * for the whole life of this shaper the surfaces downstream had no way to know
 * which one they were looking at.
 */
export interface MonitorReviewItem extends ManualReviewItem {
  /** Resume-loop link (`NULL` for standalone, non-team reviews). */
  assignment_id: string | null;
  step_id: string | null;
  /** Capability attribution, inherited from the originating execution. */
  use_case_id: string | null;
}

/**
 * Shape a raw `PersonaManualReview` row into the item the UI consumes.
 *
 * Three lossy habits are corrected here, all of which showed up as visible
 * defects on the triage deck:
 *
 *  • `review_type` used to be filled with `severity`, so every card printed the
 *    same word under two labels ("Severity: high · Type: high"). The DB has no
 *    review-type column; the honest value is empty, and the adapters render a
 *    type only when there is one.
 *  • `content` used to be `title + '\n' + description`, so the headline was
 *    printed twice — once as the card's `<h2>`, once as the body's first line.
 *    `content` is now the description alone. (`MonitorDrawer` already rendered
 *    title and content as separate elements, so it was double-printing too.)
 *  • The resume-loop and provenance ids were dropped entirely.
 */
export function shapeReview(r: PersonaManualReview): MonitorReviewItem {
  return {
    id: r.id,
    persona_id: r.persona_id,
    execution_id: r.execution_id,
    review_type: '',
    content: r.description ?? '',
    severity: r.severity,
    status: r.status,
    reviewer_notes: r.reviewer_notes,
    context_data: r.context_data,
    suggested_actions: r.suggested_actions,
    title: r.title,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    source: 'local',
    assignment_id: r.assignment_id,
    step_id: r.step_id,
    use_case_id: r.use_case_id,
  };
}

/**
 * Whether two shaped review lists say the same thing.
 *
 * The poll re-shapes every row every 30 seconds, and `raw.map(shapeReview)` is a
 * new array of new objects whether or not SQLite returned anything different.
 * That fresh identity was the head of a chain — `useEnrichedRecords` →
 * `usePendingInteractions` → `useUnifiedTriage.all` → `projectQueue` — so an
 * untouched deck rebuilt, re-sorted and re-adapted its entire queue twice a
 * minute for data that had not changed.
 *
 * Field-by-field over exactly what {@link shapeReview} writes (the two constants
 * it fills in cannot differ). Cheaper than the rebuild it prevents by orders of
 * magnitude, and unlike a `JSON.stringify` compare it allocates nothing.
 */
function sameReviews(a: readonly MonitorReviewItem[], b: readonly MonitorReviewItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.persona_id !== y.persona_id ||
      x.execution_id !== y.execution_id ||
      x.content !== y.content ||
      x.severity !== y.severity ||
      x.status !== y.status ||
      x.reviewer_notes !== y.reviewer_notes ||
      x.context_data !== y.context_data ||
      x.suggested_actions !== y.suggested_actions ||
      x.title !== y.title ||
      x.created_at !== y.created_at ||
      x.resolved_at !== y.resolved_at ||
      x.assignment_id !== y.assignment_id ||
      x.step_id !== y.step_id ||
      x.use_case_id !== y.use_case_id
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Whether two unread-message lists say the same thing.
 *
 * The messages poll ran `raw.filter((m) => !m.is_read)` every 30 seconds, which
 * allocates a fresh array whether or not anything changed — and that array is a
 * dep of the Monitor's `buildMonitorModel` memo, so an idle fleet re-sorted
 * itself and re-rendered every tile twice a minute for data that had not moved.
 * Same reasoning as {@link sameReviews}, one feed over.
 *
 * `PersonaReport` is flat — every column is a scalar (see the ts-rs binding) —
 * so a field-by-field compare is exact, not a heuristic, and allocates nothing.
 */
function sameReports(a: readonly PersonaReport[], b: readonly PersonaReport[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.persona_id !== y.persona_id ||
      x.execution_id !== y.execution_id ||
      x.title !== y.title ||
      x.content !== y.content ||
      x.content_type !== y.content_type ||
      x.priority !== y.priority ||
      x.is_read !== y.is_read ||
      x.metadata !== y.metadata ||
      x.created_at !== y.created_at ||
      x.read_at !== y.read_at ||
      x.thread_id !== y.thread_id ||
      x.use_case_id !== y.use_case_id
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Which feeds the mounting surface actually RENDERS.
 *
 * This hook fuses four independent feeds and used to start four pollers
 * unconditionally, which was right for the Monitor and wrong for everyone else.
 * The triage deck reaches this hook through `usePendingInteractions`, which does
 * not even return `unreadMessages` — so opening the deck was paying for a
 * `list_reports(300)` query and a `fetchPersonaSummaries()` every 30 seconds
 * for data no pixel on that surface could show.
 *
 * Defaults are ALL ON, so `useMonitorData()` behaves exactly as before and the
 * Monitor — which legitimately needs all four — needs no change.
 */
export interface MonitorFeeds {
  /** Unread persona messages. */
  messages?: boolean;
  /** Persona roster + health summaries, on the dashboard cadence. */
  personaHealth?: boolean;
  /**
   * Keep the pending-review POLL running (local + cloud).
   *
   * The mount-time read always happens — `loading` has to resolve and the warm
   * cache has to be filled whatever the caller renders — so turning this off
   * costs no correctness and leaves no surface empty. What it stops is the
   * repeating 30s `list_manual_reviews` + 15s cloud read for a host that is
   * currently showing something else entirely.
   *
   * The Monitor is the caller this exists for: its four header destinations are
   * peers, and `reviews` feeds only the Activity board (the grid cards, the
   * drawer, the system band). On Timeline / Conversations / Map the queue is
   * re-read twice a minute for a model with no pixels behind it.
   *
   * Turning it back on re-registers the ticker, and `usePolling` fires a ticker
   * immediately on register — so a return to Activity refreshes at once rather
   * than waiting out a cadence, and the retained state means it paints
   * last-known in the meantime instead of re-ghosting.
   */
  reviews?: boolean;
  /**
   * Cap the pending-review read at this many rows (newest first), via the
   * keyset command rather than the unbounded list.
   *
   * OPT-IN, and deliberately not a default. `list_manual_reviews` has no limit
   * at all, so a poll on a busy install re-reads and re-shapes every pending row
   * every 30 seconds. The triage deck opts in (working set of 100). The
   * Persona Monitor Activity board does not list the queue at all — it badges
   * tiles from counts ({@link MonitorFeeds.badgeCounts}) and the drawer fetches
   * one persona's page.
   */
  reviewLimit?: number;
  /**
   * Activity-board path: fetch per-persona pending/unread COUNTS rather than
   * the review and message row dumps. Tiles badge from the maps; the drawer
   * fetches the selected persona's page.
   *
   * COMPOSES WITH {@link MonitorFeeds.reviewLimit} — it used to exclude it.
   * Counts alone is still counts alone; counts PLUS a limit fetches both in
   * one round trip, which is what lets the Activity board (tiles, counts) and
   * the decision rail (rows) share a single engine instead of mounting one
   * each. Messages have no such pairing: nothing inside the overlay reads the
   * unread ROWS, so `badgeCounts` still means counts-only for them.
   */
  badgeCounts?: boolean;
  /**
   * THIS INSTANCE IS A PLACEHOLDER — a shared engine is already serving the
   * surface, so do nothing at all: no mount read, no poller, no event refresh.
   *
   * It exists because of a shape React forces. A hook cannot be called
   * conditionally, so a caller that takes the overlay's shared engine when there
   * is one (`useSharedMonitorData`) and mounts its own when there is not has to
   * mount the second instance EITHER WAY. Every other flag here narrows what an
   * instance fetches; this one says the instance is not the one being read, and
   * is the difference between "the duplicate is quiet" and "the duplicate costs
   * nothing".
   *
   * `loading` is forced false: a dormant instance resolves nothing, and leaving
   * it true would be a ghost that never ends if anyone ever did read it.
   */
  dormant?: boolean;
}

const ALL_FEEDS: Required<Omit<MonitorFeeds, 'reviewLimit'>> = {
  messages: true,
  personaHealth: true,
  reviews: true,
  badgeCounts: false,
  dormant: false,
};

/**
 * Module-scoped warm cache (loading pattern v2, mechanic 4 — precedent:
 * LifecyclePage). The Monitor and the triage deck fully
 * unmount on close, and this hook held its reviews/messages in component
 * state — so every re-open started from `loading: true` with an empty queue
 * and re-ghosted a surface the user saw populated two seconds ago. The last
 * successful fetch lives here instead, keyed by the review read's bound
 * (a capped deck read and the Monitor's unbounded read are different queues
 * and must not warm each other), so a remount paints warm immediately while
 * the mount-time refetch revalidates underneath (law 1: the fetch never hides
 * the rows already rendered).
 */
const reviewsWarmCache = new Map<string, { rows: MonitorReviewItem[]; hasMore: boolean }>();
let messagesWarmCache: PersonaReport[] | null = null;
let reviewCountsWarmCache: Record<string, ReviewBadgeCount> | null = null;
let messageCountsWarmCache: Record<string, number> | null = null;

function reviewsCacheKey(reviewLimit: number | undefined): string {
  return reviewLimit === undefined ? 'all' : `limit:${reviewLimit}`;
}

/**
 * A TICK THAT WOULD RE-READ WHAT WAS JUST READ IS NOT A REFRESH.
 *
 * `usePolling` fires once the moment it registers a ticker, which is right — a
 * feed that has just been enabled should not wait out a cadence. It is wrong
 * twice over in this hook, and both are measured defects rather than theory:
 *
 *  • AT MOUNT the effect below reads reviews, messages and summaries, and then
 *    every `usePolling` registration in the same commit reads the same three
 *    again. Six IPC round trips open the Monitor where three are wanted.
 *  • ON REOPEN every feed is gated on {@link useMonitorVisible}, so showing the
 *    overlay re-enables and therefore re-registers all four at once — a
 *    thundering refresh of feeds that may have been read two seconds before it
 *    was hidden.
 *
 * So eligibility moves one layer up, the same shape `usePolling` already uses
 * for backoff (`nextEligibleAt`): each feed records WHEN IT LAST TRIED, and a
 * ticker that fires inside that window declines. Last-ATTEMPT rather than
 * last-success on purpose — the mount read is still in flight when the ticker
 * registers, and a success stamp would not exist yet to decline against.
 *
 * The slack is what stops the gate halving the cadence. A bucket tick is not
 * phase-locked to this ticker's registration, so the tick that lands one
 * interval later can land a few milliseconds EARLY; without slack it would be
 * declined and the feed would wait a second full interval.
 */
const POLL_DUE_SLACK_MS = 1_000;

function pollIsDue(lastAttemptAt: number, interval: number): boolean {
  return Date.now() - lastAttemptAt >= interval - POLL_DUE_SLACK_MS;
}

/**
 * The health read's verdict, which it does not return.
 *
 * `fetchPersonaSummaries` catches internally and resolves either way, so the
 * only record of a failure is `personaSummariesError` — and it has to be read
 * from the live store AFTER the await, because the value this hook subscribes
 * to is a render behind. Guarded on `getState` because a test may mock the
 * store as a bare selector function; a store with no `getState` means "no
 * failure signal available", which is the behaviour that existed before and
 * can never produce a false backoff.
 */
function readHealthFailure(): unknown {
  const getState = (useAgentStore as { getState?: () => { personaSummariesError?: string | null } })
    .getState;
  const message = typeof getState === 'function' ? getState().personaSummariesError : null;
  return message ? new Error(message) : null;
}

function emptyBadge(): ReviewBadgeCount {
  return { pending: 0, critical: 0, warning: 0, info: 0 };
}

function sameBadgeCounts(
  a: Record<string, ReviewBadgeCount>,
  b: Record<string, ReviewBadgeCount>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) return false;
    if (x.pending !== y.pending || x.critical !== y.critical || x.warning !== y.warning || x.info !== y.info) {
      return false;
    }
  }
  return true;
}

function sameCountMap(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export interface MonitorData {
  personas: ReturnType<typeof useAgentStore.getState>['personas'];
  healthMap: Record<string, PersonaHealth>;
  reviews: MonitorReviewItem[];
  /**
   * Why {@link MonitorData.reviews} is short, when it is short because the read
   * FAILED rather than because nothing is pending.
   *
   * The load used to end at `logger.error` and nothing else, so every surface
   * downstream rendered an unreadable queue and an empty one identically — the
   * triage deck said "nothing is waiting on you" and the channel rail said
   * "nothing is waiting", both on a `list_manual_reviews` that never answered.
   * A held team step is exactly the thing that must not disappear quietly.
   *
   * Null while the last read succeeded. Cleared by the next successful poll, so
   * a transient failure heals itself without the caller doing anything.
   */
  reviewsError: string | null;
  /**
   * Whether the pending-review read was CAPPED and more rows exist behind it.
   *
   * Always false without {@link MonitorFeeds.reviewLimit} — an unbounded read
   * has nothing behind it. A caller that bounds the query owes its user this
   * fact; a shorter list that does not say it is short is the same lie as an
   * empty one that does not say it failed.
   */
  reviewsHasMore: boolean;
  unreadMessages: PersonaReport[];
  /**
   * Per-persona pending-review badge counts. Populated when
   * {@link MonitorFeeds.badgeCounts} is on; empty otherwise. Activity tiles
   * badge from this instead of {@link MonitorData.reviews}.
   */
  reviewBadgeCounts: Record<string, ReviewBadgeCount>;
  /**
   * Per-persona unread-message badge counts. Same contract as
   * {@link MonitorData.reviewBadgeCounts}.
   */
  messageBadgeCounts: Record<string, number>;
  /** Re-read the attention feeds (counts or rows) after a drawer write. */
  refreshAttention: () => Promise<void>;
  /**
   * Why {@link MonitorData.unreadMessages} is short, when it is short because
   * the read FAILED rather than because everything has been read.
   *
   * Same contract as {@link MonitorData.reviewsError}, and it existed for the
   * same reason: `list_reports` failing ended at `logger.error` and nothing
   * else, so a fleet whose messages were unreadable rendered as a fleet with
   * nothing to say. Null while the last read succeeded; cleared by the next
   * successful poll or event refresh.
   *
   * The sentence is RESOLVED through the error registry before it is stored, so
   * a caller that renders it shows the product's copy rather than SQLite's.
   */
  messagesError: string | null;
  /**
   * Why {@link MonitorData.healthMap} is empty or stale.
   *
   * The health read lives in `personaSlice.fetchPersonaSummaries`, whose only
   * record of a failure was a `logger.warn` — so every tile fell back to its
   * idle grey and the board read as a calm fleet. The store now carries the
   * failure and this is the Monitor's window onto it.
   */
  healthError: string | null;
  /**
   * When the fused board last became true — the OLDEST successful read across
   * the feeds this caller renders, in epoch ms, or null before the first one.
   *
   * Oldest rather than newest on purpose: one healthy feed must not stamp a
   * fresh time onto a board whose other half has been failing for ten minutes.
   *
   * NOTE — the polling layer's own `lastRefreshed` is the FALLBACK here, not
   * the source, and cannot be the source: `usePolling` stamps it whenever the
   * fetch fn RESOLVES, and both loaders in this hook catch internally and
   * resolve. For them that timestamp says "we ran", not "we succeeded".
   *
   * That same property USED to make `usePolling`'s exponential backoff
   * structurally unreachable here — a dead backend was re-queried at full
   * cadence forever. It is reachable now, and the fix did not change the
   * loaders: they still catch and resolve, and a thin poll wrapper re-throws
   * what they caught so only the TICKER sees a rejection. See `reviewsFailure`
   * and `pollReviews`. The loaders' own stamps below are therefore still the
   * honest source of "when did this last become true".
   */
  lastRefreshed: number | null;
  activeProcesses: Record<string, ActiveProcess>;
  loading: boolean;
  /** True while ANY review write is in flight. Presentational only — the write
   *  guard is per-review (see `useInFlight`), never this flag. */
  isProcessing: boolean;
  /**
   * The narrow, per-review read of the keyed ledger `isProcessing` aggregates.
   *
   * This is what a control should bind its busy/disabled state to. `intent` is
   * the verdict (`'approved'` / `'rejected'`) or `action:<label>` for a
   * dispatch — the same intent the writer keys on — so only the control that
   * was actually pressed goes busy. Omit it to ask "is anything in flight for
   * this row". Binding a button to `isProcessing` instead is what made
   * approving one review grey out every other row in the Monitor drawer.
   */
  isReviewInFlight: (id: string, intent?: string) => boolean;
  /**
   * Both verdict writers REJECT when the write fails. Callers that show the
   * decision as done before the round-trip (the triage deck resolves
   * optimistically) depend on that rejection to put the row back; swallowing it
   * here is how a card leaves the queue while SQLite still says `pending`.
   */
  handleReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
  /** Phase 4 — choose a suggested action: resolves + dispatches a follow-up run. */
  handleDispatchAction: (id: string, action: string) => Promise<void>;
  handleMarkRead: (id: string) => Promise<void>;
}

/**
 * Per-key in-flight ledger.
 *
 * The previous guard was a single `if (isProcessing) return;` — which meant a
 * second verdict issued while the first was still in flight was **dropped on
 * the floor**: no write, no error, and (for the triage deck) a card that had
 * already left the queue. A reviewer clearing a stack at one card per second
 * hits that window constantly.
 *
 * So the guard is keyed. Different reviews proceed in parallel; a repeat call
 * for the SAME review joins the in-flight promise instead of racing a duplicate
 * write. Either way no caller is ever told "done" without a write having
 * happened.
 *
 * **The key names the INTENT, not just the row** (see `verdictKey` below). It
 * used to be `review:${id}` for both writers, so a *different* verdict on the
 * same row issued inside one round-trip silently inherited the first one's
 * outcome and reported success — approve-then-reject in the same second wrote
 * one approval and told the caller both had landed. Joining is only honest
 * between calls that ask for the same thing; two different verdicts must both
 * reach the backend, where the compare-and-swap decides which one wins and the
 * loser gets a conflict it can surface.
 */
function useInFlight() {
  const inFlight = useRef(new Map<string, Promise<void>>());
  const [busyKeys, setBusyKeys] = useState<readonly string[]>([]);

  const track = useCallback((key: string, run: () => Promise<void>): Promise<void> => {
    const joined = inFlight.current.get(key);
    if (joined) return joined;

    const promise = run().finally(() => {
      inFlight.current.delete(key);
      setBusyKeys((prev) => prev.filter((k) => k !== key));
    });
    inFlight.current.set(key, promise);
    setBusyKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    return promise;
  }, []);

  const isKeyInFlight = useCallback(
    (id: string, intent?: string) =>
      intent === undefined
        ? busyKeys.some((k) => k.startsWith(`review:${id}:`))
        : busyKeys.includes(verdictKey(id, intent)),
    [busyKeys],
  );

  return { track, busy: busyKeys.length > 0, isKeyInFlight };
}

/** In-flight key for one verdict on one row. Two calls join ONLY when they ask
 *  the backend for the same thing. */
function verdictKey(id: string, intent: string): string {
  return `review:${id}:${intent}`;
}

export function useMonitorData(feeds: MonitorFeeds = ALL_FEEDS): MonitorData {
  const dormant = feeds.dormant === true;
  const wantsMessages = (feeds.messages ?? ALL_FEEDS.messages) && !dormant;
  const wantsPersonaHealth = (feeds.personaHealth ?? ALL_FEEDS.personaHealth) && !dormant;
  const wantsReviewPoll = (feeds.reviews ?? ALL_FEEDS.reviews) && !dormant;
  const reviewLimit = feeds.reviewLimit;
  const badgeCounts = feeds.badgeCounts === true;
  /**
   * Whether this instance hydrates {@link MonitorData.reviews} with ROWS.
   *
   * Counts and rows used to be exclusive — `badgeCounts` meant "counts
   * INSTEAD of rows". That was true while the Activity board was the only
   * thing reading the Monitor's engine, and false the moment the decision rail
   * started reading the same one: the rail's triage queue is built from the
   * rows, and a counts-only engine serves it an empty queue while the tiles
   * badge a number. Both now compose, on the same read, in one round trip —
   * ask for counts and name a `reviewLimit` and you get both. Counts alone is
   * still counts alone, so no existing caller changed.
   */
  const wantsReviewRows = !badgeCounts || reviewLimit !== undefined;
  /**
   * IS ANYONE LOOKING? The overlay stopped unmounting on close (see
   * `monitorVisibility.ts`), so "the Monitor is shut" no longer tears these
   * pollers down — it only stops them being painted. Every feed below is gated
   * on this, and the default outside the provider is `true`, so the Quick
   * Answer popover and every test that mounts this hook bare behave exactly as
   * they did.
   */
  const monitorVisible = useMonitorVisible();
  const personas = useAgentStore((s) => s.personas);
  const healthMap = useAgentStore((s) => s.personaHealthMap);
  const fetchPersonaSummaries = useAgentStore((s) => s.fetchPersonaSummaries);
  const healthError = useAgentStore((s) => s.personaSummariesError);
  const healthRefreshedAt = useAgentStore((s) => s.personaSummariesRefreshedAt);
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  const cloudReviews = useOverviewStore((s) => s.cloudReviews);
  const fetchCloudReviews = useOverviewStore((s) => s.fetchCloudReviews);
  const fetchPendingReviewCount = useOverviewStore((s) => s.fetchPendingReviewCount);
  const fetchUnreadReportCount = useOverviewStore((s) => s.fetchUnreadReportCount);
  const isCloudConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);

  // Seed from the warm cache so a re-opened surface paints its last-known rows
  // instead of a ghost; `loading` is true only when there is nothing warm to
  // show (first-ever open), which is the only time a ghost is honest.
  const warm = reviewsWarmCache.get(reviewsCacheKey(reviewLimit));
  const [localReviews, setLocalReviews] = useState<MonitorReviewItem[]>(() => warm?.rows ?? []);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsHasMore, setReviewsHasMore] = useState(() => warm?.hasMore ?? false);
  const [unreadMessages, setUnreadMessages] = useState<PersonaReport[]>(
    () => messagesWarmCache ?? [],
  );
  const [reviewBadgeCounts, setReviewBadgeCounts] = useState<Record<string, ReviewBadgeCount>>(
    () => reviewCountsWarmCache ?? {},
  );
  const [messageBadgeCounts, setMessageBadgeCounts] = useState<Record<string, number>>(
    () => messageCountsWarmCache ?? {},
  );
  const [loading, setLoading] = useState(() => {
    if (dormant) return false;
    if (badgeCounts && reviewCountsWarmCache === null) return true;
    return wantsReviewRows && warm === undefined;
  });
  const [messagesError, setMessagesError] = useState<string | null>(null);
  // Per-feed "last SUCCESSFUL read" stamps. See `MonitorData.lastRefreshed` for
  // why the polling layer's own stamp cannot answer this on its own.
  const [reviewsRefreshedAt, setReviewsRefreshedAt] = useState<number | null>(null);
  const [messagesRefreshedAt, setMessagesRefreshedAt] = useState<number | null>(null);
  const { track, busy: isProcessing, isKeyInFlight: isReviewInFlight } = useInFlight();
  // The app's ONE persona-join helper, already used by ManualReviewList for the
  // same rows. This shaper populated no identity at all, which is why the deck
  // rendered "Persona: —" on every review card while two other surfaces showed
  // the name for the same row.
  const personaMap = usePersonaMap();

  /**
   * A poll that lands after unmount must not set state.
   *
   * This is a GUARD, not an abort: `invokeWithTimeout` documents that Tauri
   * `invoke` has no cancellation, so the Rust side runs to completion whatever
   * we do here. `usePolling`'s dispose kills the ticker, not the request already
   * in flight — closing the deck one tick into a `list_manual_reviews` left that
   * promise resolving into a dead component.
   */
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /**
   * Per-feed eligibility and failure state, on refs rather than in state.
   *
   * Both are read SYNCHRONOUSLY from inside a poll wrapper that runs between
   * renders (exactly like `usePolling`'s own `nextEligibleAtRef`), so a state
   * copy would always be one commit stale at the moment it is consulted.
   *
   * `*Failure` is what makes backoff reachable at all. Every loader in this
   * hook catches internally and RESOLVES — that is the contract its callers
   * depend on, and `MonitorData.reviewsError` is how a failure reaches a
   * surface. But `usePolling` only backs off when the fetch REJECTS, so a dead
   * backend was re-queried at full cadence forever. The loaders still resolve;
   * the POLL WRAPPER re-throws what the loader caught, so the ticker learns
   * about the failure without any caller's success path changing shape.
   */
  const reviewsAttemptedAt = useRef(0);
  const messagesAttemptedAt = useRef(0);
  const healthAttemptedAt = useRef(0);
  const cloudAttemptedAt = useRef(0);
  const reviewsFailure = useRef<unknown>(null);
  const messagesFailure = useRef<unknown>(null);

  const reloadReviews = useCallback(async () => {
    reviewsAttemptedAt.current = Date.now();
    try {
      const [counts, page] = await Promise.all([
        badgeCounts ? getPendingReviewCountsByPersona() : null,
        wantsReviewRows
          ? reviewLimit
            ? listManualReviewsPage({ status: 'pending', limit: reviewLimit })
            : listManualReviews(undefined, 'pending').then((rows) => ({ rows, hasMore: false }))
          : null,
      ]);
      if (mounted.current) {
        if (counts) {
          const next: Record<string, ReviewBadgeCount> = {};
          for (const r of counts) {
            next[r.personaId] = {
              pending: r.pending,
              critical: r.critical,
              warning: r.warning,
              info: r.info,
            };
          }
          setReviewBadgeCounts((prev) => {
            const kept = sameBadgeCounts(prev, next) ? prev : next;
            reviewCountsWarmCache = kept;
            return kept;
          });
        }
        if (page) {
          const shaped = page.rows.map(shapeReview);
          // Keep the array we already have when nothing moved. The rows are equal
          // by value on almost every poll, and the identity is what the whole
          // downstream memo chain keys on — see `sameReviews`.
          setLocalReviews((prev) => {
            const next = sameReviews(prev, shaped) ? prev : shaped;
            reviewsWarmCache.set(reviewsCacheKey(reviewLimit), { rows: next, hasMore: page.hasMore });
            return next;
          });
        }
        // A counts-only read has nothing behind it to report.
        setReviewsHasMore(page ? page.hasMore : false);
        // Clearing on success is what makes the flag self-healing: React bails
        // out of a set to the identical value, so a healthy poll costs nothing.
        setReviewsError(null);
        setReviewsRefreshedAt(Date.now());
      }
      reviewsFailure.current = null;
    } catch (err) {
      logger.error('Failed to load manual reviews', { error: err });
      // The log was the ONLY record. A surface cannot render a breadcrumb, so
      // an unreadable queue looked exactly like an empty one.
      if (mounted.current) setReviewsError(extractMessage(err));
      // Held for the poll wrapper, which re-throws it so the ticker backs off.
      // This loader still RESOLVES: every other caller (the mount read,
      // `refreshAttention`, `refreshAfterWrite`) depends on that.
      reviewsFailure.current = err;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [reviewLimit, badgeCounts, wantsReviewRows]);

  /**
   * Coalescing gate for the messages read.
   *
   * `report-created` arrives in per-frame batches (the singleton listener
   * collects a backend tick's payloads and fans them out in one animation
   * frame), and a persona finishing a fan-out can emit a dozen at once. Without
   * a gate that is a dozen `list_reports(300)` queries for one refresh. A call
   * that lands while a read is open JOINS it and sets a "do it again" flag, so a
   * burst costs at most two reads: the one in flight, and one more that is
   * guaranteed to see everything the burst wrote. Same in-flight discipline the
   * verdict writers use (`useInFlight`), scoped to a single loader.
   */
  const messagesInFlight = useRef<Promise<void> | null>(null);
  const messagesQueued = useRef(false);
  const reloadMessagesRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const loadMessages = useCallback(async () => {
    messagesAttemptedAt.current = Date.now();
    try {
      if (badgeCounts) {
        const raw = await getUnreadReportCountsByPersona();
        if (mounted.current) {
          setMessageBadgeCounts((prev) => {
            const next = sameCountMap(prev, raw) ? prev : raw;
            messageCountsWarmCache = next;
            return next;
          });
          setMessagesError(null);
          setMessagesRefreshedAt(Date.now());
        } else {
          messageCountsWarmCache = raw;
        }
        messagesFailure.current = null;
      } else {
        const raw = await listReports(MESSAGE_SCAN_LIMIT);
        const unread = raw.filter((m) => !m.is_read);
        if (mounted.current) {
          // Keep the array we already have when nothing moved — see `sameReports`.
          // The warm cache is written from INSIDE the updater so it always holds
          // the exact reference the hook is serving; writing `unread` to it
          // regardless would reintroduce the fresh identity on the next remount.
          setUnreadMessages((prev) => {
            const next = sameReports(prev, unread) ? prev : unread;
            messagesWarmCache = next;
            return next;
          });
          setMessagesError(null);
          setMessagesRefreshedAt(Date.now());
        } else {
          messagesWarmCache = unread;
        }
        messagesFailure.current = null;
      }
    } catch (err) {
      logger.error('Failed to load messages', { error: err });
      // The log was the ONLY record, so an unreadable inbox and an empty one
      // rendered identically — every tile idle-grey, "your fleet is calm".
      // RESOLVED, not raw: `error-message-resolution.md` — a string that can
      // reach a surface must be the product's sentence, not the producer's.
      // (`reviewsError` above still stores the raw string; it predates this and
      // is one of that rule's baselined violations, not a shape to copy.)
      if (mounted.current) setMessagesError(resolveError(extractMessage(err)).message);
      // Held for the poll wrapper — see `reviewsFailure`.
      messagesFailure.current = err;
    }
  }, [badgeCounts]);

  const reloadMessages = useCallback((): Promise<void> => {
    const open = messagesInFlight.current;
    if (open) {
      messagesQueued.current = true;
      return open;
    }
    const run = loadMessages().finally(() => {
      messagesInFlight.current = null;
      if (messagesQueued.current) {
        messagesQueued.current = false;
        void reloadMessagesRef.current();
      }
    });
    messagesInFlight.current = run;
    return run;
  }, [loadMessages]);
  reloadMessagesRef.current = reloadMessages;

  /**
   * A NEW MESSAGE LIGHTS THE TILE ON THE EVENT, NOT THE POLL.
   *
   * Rust emits `report-created` the moment a report row lands
   * (`engine/dispatch.rs`), and the app already has ONE singleton listener for
   * it — this layers on that hook rather than opening a second Tauri
   * subscription, so every consumer still shares a single `listen()`.
   *
   * The 30s poll below stays exactly as it was: it is the fallback for anything
   * the event path misses (an event emitted before this subscriber mounted and
   * past the early-buffer cap, a write that reached SQLite by another route).
   *
   * The feed gate lives INSIDE the callback rather than around the hook, for
   * the ordinary reason: a hook cannot be called conditionally. What the gate
   * has to guarantee is that a surface which does not render messages performs
   * no work for one — no read, no state write — and it does. The subscription
   * itself is the shared singleton, so being registered on it costs nothing
   * beyond a `Set` entry, and it is released on unmount with the component.
   */
  const wantsMessagesRef = useRef(wantsMessages);
  wantsMessagesRef.current = wantsMessages;
  const onReportCreated = useCallback(() => {
    if (!wantsMessagesRef.current) return;
    void reloadMessagesRef.current();
  }, []);
  useReportCreatedListener(onReportCreated);

  // Read through a ref: whether the roster is cold is a one-shot question at
  // mount, and putting `personas.length` in the dep list would re-run the whole
  // initial fetch the moment the roster landed.
  const personaCountRef = useRef(personas.length);
  personaCountRef.current = personas.length;

  /**
   * FIRST load only — every later refresh belongs to the pollers.
   *
   * This effect re-runs whenever a feed flag flips, which used to happen once
   * (at mount) because no caller changed its flags after mounting. The Monitor
   * now does, on every switch between Activity and the three channel views, and
   * an unguarded body would have made the gate cost more than it saved: a read
   * on the way OUT for a surface being left, and on the way back IN a duplicate
   * of the read `usePolling` already performs when it re-registers a ticker —
   * six reads per round trip where three are wanted.
   *
   * So the loader identity is the guard, not a boolean: it also re-fires when
   * `reviewLimit` genuinely changes the query, while a mere flag flip does not
   * touch it. Re-enabling a feed still refreshes, through `usePolling`'s
   * fire-on-register, which is the one place that read belongs — and that read
   * is now itself filtered by `pollIsDue`, so re-enabling a feed that was read
   * a second ago costs nothing while a genuinely stale one refreshes at once.
   */
  const ranReviewLoader = useRef<typeof reloadReviews | null>(null);
  const ranMessageLoader = useRef<typeof reloadMessages | null>(null);
  const filledRoster = useRef(false);
  useEffect(() => {
    // A dormant instance is not serving anybody — see `MonitorFeeds.dormant`.
    // It owes no warm cache, no `loading` resolution and no roster, because the
    // shared engine its caller is actually reading owes all three.
    if (dormant) return;
    // Ungated: `loading` has to resolve and the warm cache has to fill even for
    // a host that currently renders something else (a Monitor opened straight
    // into Timeline still owes the Activity board a queue when it lands there).
    if (ranReviewLoader.current !== reloadReviews) {
      ranReviewLoader.current = reloadReviews;
      void reloadReviews();
    }
    if (wantsMessages && ranMessageLoader.current !== reloadMessages) {
      ranMessageLoader.current = reloadMessages;
      void reloadMessages();
    }
    // Even a surface that does not want the health POLL needs a roster: the
    // review cards resolve persona name/colour through it (see `personaMap`
    // above). So a cold store is filled once, and only once.
    if (!filledRoster.current && (wantsPersonaHealth || personaCountRef.current === 0)) {
      filledRoster.current = true;
      healthAttemptedAt.current = Date.now();
      void fetchPersonaSummaries();
    }
  }, [dormant, wantsMessages, wantsPersonaHealth, reloadReviews, reloadMessages, fetchPersonaSummaries]);
  useEffect(() => {
    if (dormant || !isCloudConnected) return;
    cloudAttemptedAt.current = Date.now();
    void fetchCloudReviews();
  }, [dormant, isCloudConnected, fetchCloudReviews]);

  // Reviews/messages aren't event-driven — poll to catch ones created while
  // the Monitor is open. Process activity is already live via the
  // PROCESS_ACTIVITY event bridge.
  //
  // Every ticker below runs on the shared PollingCoordinator, which suspends
  // whole cadence buckets on `visibilitychange` and fires the eligible ones
  // immediately on regain — so a hidden window costs nothing here and a
  // re-shown one is refreshed rather than left stale. The `enabled` flags are
  // the other two axes: what the MOUNTING SURFACE currently renders, and
  // whether that surface is on screen at all (`monitorVisible`). The second one
  // is new and is the price of the overlay no longer unmounting on close — a
  // hidden Monitor's React tree is still alive, so a poll that does not ask
  // whether anyone is looking runs forever behind a blank screen.
  //
  // Named per call site so the shared PollingCoordinator's stats can say which
  // surface is paying for what.
  //
  // WHAT A POLL WRAPPER ADDS, and why it is not in the loader.
  //
  // Two things the loaders deliberately must not do: DECLINE a tick that would
  // re-read what was just read (see `pollIsDue` — a loader called by
  // `refreshAttention` or by a drawer write must always run), and REJECT on
  // failure (see `reviewsFailure` — every direct caller depends on the loader
  // resolving, and `reviewsError` is how a failure reaches a surface). Both
  // belong to the ticker, so both live here.
  const dashboardInterval = POLLING_CONFIG.dashboardRefresh.interval;
  const cloudInterval = POLLING_CONFIG.cloudReviews.interval;

  const pollReviews = useCallback(async () => {
    if (!pollIsDue(reviewsAttemptedAt.current, dashboardInterval)) return;
    await reloadReviews();
    if (reviewsFailure.current) throw reviewsFailure.current;
  }, [reloadReviews, dashboardInterval]);

  const pollMessages = useCallback(async () => {
    if (!pollIsDue(messagesAttemptedAt.current, dashboardInterval)) return;
    await reloadMessages();
    if (messagesFailure.current) throw messagesFailure.current;
  }, [reloadMessages, dashboardInterval]);

  const pollHealth = useCallback(async () => {
    if (!pollIsDue(healthAttemptedAt.current, dashboardInterval)) return;
    healthAttemptedAt.current = Date.now();
    await fetchPersonaSummaries();
    const failure = readHealthFailure();
    if (failure) throw failure;
  }, [fetchPersonaSummaries, dashboardInterval]);

  const pollCloudReviews = useCallback(async () => {
    if (!pollIsDue(cloudAttemptedAt.current, cloudInterval)) return;
    cloudAttemptedAt.current = Date.now();
    await fetchCloudReviews();
  }, [fetchCloudReviews, cloudInterval]);

  const reviewsPoll = usePolling(pollReviews, {
    interval: dashboardInterval,
    enabled: wantsReviewPoll && monitorVisible,
    name: 'monitor:reviews',
  });
  const messagesPoll = usePolling(pollMessages, {
    interval: dashboardInterval,
    enabled: wantsMessages && monitorVisible,
    name: 'monitor:messages',
  });
  const healthPoll = usePolling(pollHealth, {
    interval: dashboardInterval,
    enabled: wantsPersonaHealth && monitorVisible,
    name: 'monitor:personaHealth',
  });
  usePolling(pollCloudReviews, {
    interval: cloudInterval,
    // Cloud rows land in the same queue as the local ones, so they follow the
    // same gate; the connection is still the outer condition.
    enabled: isCloudConnected && wantsReviewPoll && monitorVisible,
    maxBackoff: POLLING_CONFIG.cloudReviews.maxBackoff,
    name: 'monitor:cloudReviews',
  });

  /**
   * The oldest successful read across the feeds this caller renders. A feed's
   * own success stamp wins; the ticker's is the fallback for the one loader
   * this hook does not own (`fetchCloudReviews` is covered by the review feed's
   * stamp, since both fill the same queue).
   */
  const lastRefreshed = useMemo(() => {
    const stamps = [
      reviewsRefreshedAt ?? reviewsPoll.lastRefreshed,
      wantsMessages ? messagesRefreshedAt ?? messagesPoll.lastRefreshed : null,
      wantsPersonaHealth ? healthRefreshedAt ?? healthPoll.lastRefreshed : null,
    ].filter((n): n is number => n !== null);
    return stamps.length > 0 ? Math.min(...stamps) : null;
  }, [
    reviewsRefreshedAt, reviewsPoll.lastRefreshed,
    wantsMessages, messagesRefreshedAt, messagesPoll.lastRefreshed,
    wantsPersonaHealth, healthRefreshedAt, healthPoll.lastRefreshed,
  ]);

  const pendingCloud = useMemo<MonitorReviewItem[]>(
    // Cloud rows come from the cloud worker and have no resume-loop link — they
    // are never a held team step. Normalised to null so one shape flows on.
    () =>
      cloudReviews
        .filter((r) => r.status === 'pending')
        .map((r) => ({ ...r, assignment_id: null, step_id: null, use_case_id: null })),
    [cloudReviews],
  );

  const enrichedLocal = useEnrichedRecords(localReviews, personaMap);
  const enrichedCloud = useEnrichedRecords(pendingCloud, personaMap);

  const reviews = useMemo<MonitorReviewItem[]>(
    () => [...enrichedLocal, ...enrichedCloud],
    [enrichedLocal, enrichedCloud],
  );

  const mergedReviewBadgeCounts = useMemo(() => {
    if (!badgeCounts) return reviewBadgeCounts;
    if (pendingCloud.length === 0) return reviewBadgeCounts;
    const next: Record<string, ReviewBadgeCount> = { ...reviewBadgeCounts };
    for (const r of pendingCloud) {
      const pid = r.persona_id || 'unassigned';
      const cur = next[pid] ?? emptyBadge();
      const bucket = severityBucket(r.severity);
      next[pid] = {
        pending: cur.pending + 1,
        critical: cur.critical + (bucket === 'critical' ? 1 : 0),
        warning: cur.warning + (bucket === 'warning' ? 1 : 0),
        info: cur.info + (bucket === 'info' ? 1 : 0),
      };
    }
    return next;
  }, [badgeCounts, reviewBadgeCounts, pendingCloud]);

  const refreshAttention = useCallback(async () => {
    await reloadReviews();
    if (wantsMessages) await reloadMessages();
  }, [reloadReviews, reloadMessages, wantsMessages]);

  // Read through a ref so the writers keep a stable identity (they are stored in
  // refs by the triage deck's keyboard layer) while still seeing the newest poll.
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;

  /** The row a verdict is about, or an error — never a silent no-op. */
  const requireReview = useCallback((id: string): ManualReviewItem => {
    const review = reviewsRef.current.find((r) => r.id === id);
    if (!review) throw new Error(`Review ${id} is no longer in the pending queue`);
    return review;
  }, []);

  /** Re-read every surface a resolved review appears on. */
  const refreshAfterWrite = useCallback(async () => {
    await reloadReviews();
    if (isCloudConnected) await fetchCloudReviews();
    void fetchPendingReviewCount();
  }, [reloadReviews, isCloudConnected, fetchCloudReviews, fetchPendingReviewCount]);

  /**
   * A LOST compare-and-swap means somebody else's verdict is now the truth, so
   * the queue this hook is serving is stale by definition. Re-read before the
   * error reaches the caller — otherwise the reviewer's next keystroke lands on
   * a card the backend has already resolved and they lose the swap twice. Fired
   * and not awaited: the rejection is what the caller is waiting for.
   */
  const refreshAfterConflict = useCallback(
    (err: unknown) => {
      if (isDecisionConflict(err)) void refreshAfterWrite();
    },
    [refreshAfterWrite],
  );

  // Both writers route through `@/lib/decisions/rowWrites` — the one door for a
  // review row. Local vs cloud lives there, so this hook cannot drift from the
  // five other surfaces that resolve the same rows. It also closed a real hole:
  // the cloud branch used to go through `overviewSlice.respondToCloudReview`,
  // whose catch calls `reportError` — which RETURNS a string and never throws.
  // A failed cloud verdict therefore RESOLVED, so the triage deck's restore
  // never fired: the card left the queue, the counter ticked, no toast, and the
  // row was still `pending`.
  const handleReviewAction = useCallback(
    (id: string, status: ManualReviewStatus, notes?: string) =>
      track(verdictKey(id, status), async () => {
        try {
          await resolveReviewRow(requireReview(id), status, notes);
          await refreshAfterWrite();
        } catch (err) {
          logger.error('Failed to action review', { error: err });
          refreshAfterConflict(err);
          // Rethrow: the caller decides how to surface it. Swallowing here is
          // what let an optimistic queue report a decision that never landed.
          throw err;
        }
      }),
    [track, requireReview, refreshAfterWrite, refreshAfterConflict],
  );

  // Phase 4 — resolve a review by CHOOSING a suggested action, which records the
  // branch AND dispatches a follow-up persona run to carry it out. Cloud reviews
  // have no dispatch path, so the choice is recorded as an approval.
  const handleDispatchAction = useCallback(
    (id: string, action: string) =>
      track(verdictKey(id, `action:${action}`), async () => {
        try {
          await dispatchReviewRowAction(requireReview(id), action);
          await refreshAfterWrite();
        } catch (err) {
          logger.error('Failed to dispatch review action', { error: err });
          refreshAfterConflict(err);
          throw err;
        }
      }),
    [track, requireReview, refreshAfterWrite, refreshAfterConflict],
  );

  const handleMarkRead = useCallback(
    async (id: string) => {
      // Optimistic — drop it from the unread set immediately (and from the warm
      // cache, so a close/re-open inside the poll window doesn't resurrect it).
      setUnreadMessages((prev) => prev.filter((m) => m.id !== id));
      messagesWarmCache = messagesWarmCache?.filter((m) => m.id !== id) ?? null;
      try {
        await markReportRead(id);
        void fetchUnreadReportCount();
      } catch (err) {
        logger.error('Failed to mark message read', { error: err });
        void reloadMessages();
      }
    },
    [fetchUnreadReportCount, reloadMessages],
  );

  // Memoised because this object is the ROOT of the triage deck's prop graph:
  // `usePendingInteractions` spreads it, `useUnifiedTriage` builds its injected
  // port bundle from it, `queue.decide` closes over that bundle, and the deck's
  // three stacked cards take `onCommit` from it. A fresh object here invalidated
  // that whole chain on every keystroke in the answer box.
  return useMemo(
    () => ({
      personas, healthMap, reviews, reviewsError, reviewsHasMore, unreadMessages,
      reviewBadgeCounts: mergedReviewBadgeCounts, messageBadgeCounts, refreshAttention,
      messagesError, healthError, lastRefreshed,
      activeProcesses, loading, isProcessing, isReviewInFlight,
      handleReviewAction, handleDispatchAction, handleMarkRead,
    }),
    [
      personas, healthMap, reviews, reviewsError, reviewsHasMore, unreadMessages,
      mergedReviewBadgeCounts, messageBadgeCounts, refreshAttention,
      messagesError, healthError, lastRefreshed,
      activeProcesses, loading, isProcessing, isReviewInFlight,
      handleReviewAction, handleDispatchAction, handleMarkRead,
    ],
  );
}
