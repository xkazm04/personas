/**
 * Her pulse, as one app-wide subscription.
 *
 * ## Why this file exists rather than a `listen()` per surface
 *
 * Two surfaces react to the same event and they react to it DIFFERENTLY: the
 * console re-reads the operator's lane, the page re-reads the projection. A
 * `listen()` in each would open two native subscriptions for one name, each
 * with its own attach race and its own teardown, and a lazy route that unmounts
 * would leave whichever one lost the race attached. `createSingletonListener`
 * owns exactly that - one native listener however many callers, ref-counted,
 * per-frame coalesced, with a test reset - and it is the same primitive
 * `companionsStatusStore` uses for `companions://status-changed`.
 *
 * ## THERE IS NO TIMER HERE, AND THAT IS THE POINT
 *
 * The operator's standing instruction:
 *
 * > "Changing states of queue items will be dynamically reflected in the UI,
 * > ideally listening events from Curator about success or another state. I
 * > would avoid polling."
 *
 * So there is no repeating timer anywhere under `src/features/companions/curator/`,
 * and the acceptance grep for one is meant to keep coming back empty - which is
 * also why this comment does not spell the identifier it greps for. A mount read
 * is still a read (the first paint happens before any event has fired and has to
 * come from somewhere), but nothing after it is on a clock.
 */
import { CURATOR_PULSE_EVENT } from '@/api/curator';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import type { CuratorPulsePayload } from '@/lib/bindings/CuratorPulsePayload';

/** ONE Tauri listener for the whole app, however many surfaces are mounted. */
export const useCuratorPulse = createSingletonListener<CuratorPulsePayload>(CURATOR_PULSE_EVENT);

/**
 * The kinds her loop sends, mirrored from `personas_core::events::curator_pulse`.
 *
 * Mirrored rather than imported because the Rust module is a set of `pub const`
 * strings, which ts-rs does not export - only types cross. The two lists are
 * four words long and each consumer below falls back safely on a kind it does
 * not know, so a drift costs a missed refresh, never a crash.
 */
export const CuratorPulseKind = {
  /** A worker started. */
  DISPATCHED: 'dispatched',
  /** A worker ended and its row was settled - landed, declined or failed. */
  SETTLED: 'settled',
  /** A brake bit, or the reason she is stopped changed. */
  HALTED: 'halted',
  /** The brake that was on is off. */
  RESUMED: 'resumed',
  /** A reconcile pass completed, superseding the standing plan run. */
  SLEPT: 'slept',
  /** The operator moved her switch. */
  SWITCHED: 'switched',
} as const;

/**
 * Kinds that move the OPERATOR'S LANE, so the console re-reads it.
 *
 * A dispatch takes a request from `queued` to `dispatched`; a settle takes it
 * to `landed` / `declined` / `failed`. Nothing else in the vocabulary touches a
 * `curator_request` row, so nothing else earns the read.
 */
export const LANE_MOVED: ReadonlySet<string> = new Set([
  CuratorPulseKind.DISPATCHED,
  CuratorPulseKind.SETTLED,
]);

/**
 * Kinds that move the PROJECTION, so the page re-reads the plan.
 *
 * A reconcile supersedes the standing run outright. A settle is subtler and is
 * here for a real reason: a worker that ended without landing writes its plan
 * item to `blocked`, which is a state the ledger draws - so a settle can change
 * a row on screen without changing the run.
 */
export const PLAN_MOVED: ReadonlySet<string> = new Set([
  CuratorPulseKind.SLEPT,
  CuratorPulseKind.SETTLED,
]);
