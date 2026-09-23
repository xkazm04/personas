/**
 * Pure derivations for REMOTE sessions: fleet sessions this device sent to one
 * of the operator's paired devices, tracked from here.
 *
 * Everything that decides how a remote session READS lives here, so it is
 * testable without a store, a backend or React:
 *
 *  - {@link effectiveRemoteState}: the client half of the liveness rule. The
 *    backend applies the same 45 s rule on read, but a view that was fresh
 *    when it was pushed goes stale on the client's clock, with no event to say
 *    so. A quiet remote session reads `unknown`, never `running`.
 *  - {@link upsertRemoteSessionView}: how a pushed view merges into the map,
 *    including the stale-push guard (Tauri events carry no ordering).
 *  - {@link receiptVerdict}: what a finished job's receipt claims about the
 *    work it returned.
 *
 * NEVER DEFAULT A MISSING STATE TO `running`. `monitorModel.ts` does exactly
 * that for local processes and it is a recorded registry deviation; a closed
 * union with an explicit `unknown` is the whole point of this module.
 */
import type { FleetSessionJobReceipt } from '@/lib/bindings/FleetSessionJobReceipt';
import type { RemoteJobStatus } from '@/lib/bindings/RemoteJobStatus';
import type { RemoteSessionState } from '@/lib/bindings/RemoteSessionState';
import type { RemoteSessionView } from '@/lib/bindings/RemoteSessionView';
import { isTerminalRemoteJobStatus } from './remoteJobHistory';

/**
 * A running session with no mirror frame for this long reads `unknown`:
 * three missed 15 s health ticks. Same number as the backend's read-side rule
 * (`list_remote_sessions`), so a fetch and a clock tick agree.
 */
export const REMOTE_MIRROR_STALE_MS = 45_000;

/** Every token the closed union carries, for guarding a value off the wire. */
const REMOTE_STATES: ReadonlySet<RemoteSessionState> = new Set<RemoteSessionState>([
  'queued', 'spawning', 'running', 'awaiting_input', 'idle', 'stale', 'finished', 'hibernated', 'exited', 'unknown',
]);

/** A session state that says the process is over. */
const ENDED_STATES: ReadonlySet<RemoteSessionState> = new Set<RemoteSessionState>(['finished', 'exited']);

/**
 * The state a remote session should RENDER as at `nowMs`.
 *
 *  - The job still waits in this device's outbox → `queued`, whatever the view
 *    says (the peer has not seen it yet, so no mirror can exist).
 *  - The job is terminal → the session is over: `finished` when the mirror
 *    said so, `exited` otherwise. A terminal job never reads live.
 *  - The job is `running` and no mirror frame arrived within
 *    {@link REMOTE_MIRROR_STALE_MS} (or ever) → `unknown`.
 *  - Otherwise the mirrored state, and `unknown` for anything off the union.
 */
export function effectiveRemoteState(view: RemoteSessionView, nowMs: number): RemoteSessionState {
  if (view.jobStatus === 'queued') return 'queued';
  if (isTerminalRemoteJobStatus(view.jobStatus)) {
    return view.state === 'finished' ? 'finished' : 'exited';
  }
  const mirrored: RemoteSessionState = REMOTE_STATES.has(view.state) ? view.state : 'unknown';
  if (view.jobStatus === 'running') {
    const heard = view.mirrorAtMs > 0 && nowMs - view.mirrorAtMs <= REMOTE_MIRROR_STALE_MS;
    if (!heard) return 'unknown';
  }
  return mirrored;
}

/** True once the job will not change again (its tile shows the receipt). */
export function isRemoteSessionSettled(view: Pick<RemoteSessionView, 'jobStatus'>): boolean {
  return isTerminalRemoteJobStatus(view.jobStatus);
}

/** True when the rendered state says the process is over. */
export function isEndedRemoteState(state: RemoteSessionState): boolean {
  return ENDED_STATES.has(state);
}

/**
 * When this device last heard anything about the session, or `null` when it
 * never did. `0` is the wire's "never", not the epoch.
 */
export function remoteLastSeenMs(view: Pick<RemoteSessionView, 'mirrorAtMs' | 'lastActivityMs'>): number | null {
  const seen = Math.max(view.mirrorAtMs, view.lastActivityMs);
  return seen > 0 ? seen : null;
}

/** Rank a job status so a late push can never walk a job backwards. */
function statusRank(status: RemoteJobStatus): number {
  if (isTerminalRemoteJobStatus(status)) return 3;
  if (status === 'running') return 2;
  if (status === 'pending') return 1;
  return 0; // queued
}

/**
 * Merge one pushed view into the map keyed by job id.
 *
 * Returns the SAME reference for a push that changes nothing or that is older
 * than the view already held, so a burst of redundant events costs no render.
 * "Older" is: a lower job-status rank (a late `running` after `completed`), or
 * the same rank with an older mirror stamp.
 */
export function upsertRemoteSessionView(
  views: Record<string, RemoteSessionView>,
  next: RemoteSessionView,
): Record<string, RemoteSessionView> {
  const held = views[next.jobId];
  if (held) {
    const heldRank = statusRank(held.jobStatus);
    const nextRank = statusRank(next.jobStatus);
    if (nextRank < heldRank) return views;
    if (nextRank === heldRank && next.mirrorAtMs < held.mirrorAtMs) return views;
    if (held === next) return views;
  }
  return { ...views, [next.jobId]: next };
}

/** Replace the whole map from a fetch, keeping any pushed view that is newer. */
export function replaceRemoteSessionViews(
  views: Record<string, RemoteSessionView>,
  fetched: readonly RemoteSessionView[],
): Record<string, RemoteSessionView> {
  let out: Record<string, RemoteSessionView> = {};
  for (const v of fetched) out = upsertRemoteSessionView(out, v);
  // A push that landed while the fetch was in flight must survive it.
  for (const held of Object.values(views)) {
    if (out[held.jobId]) out = upsertRemoteSessionView(out, held);
  }
  return out;
}

/** What a finished job's receipt says about the work it returned. */
export type ReceiptVerdict = 'verified' | 'unverified' | 'could_not_verify' | 'not_pushed' | 'push_failed';

export function receiptVerdict(receipt: FleetSessionJobReceipt): ReceiptVerdict {
  if (!receipt.pushedSha) return receipt.pushError ? 'push_failed' : 'not_pushed';
  if (receipt.verified === true) return 'verified';
  if (receipt.verified === false) return 'unverified';
  // `null`: this device has no checkout to fetch into. Not "broken".
  return 'could_not_verify';
}

/** The seven-character SHA a human reads. */
export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/**
 * Normalise a git remote URL for matching: host + path, lower-case, no
 * protocol, no credentials, no `.git`, no trailing slash. `git@host:o/r` and
 * `https://host/o/r.git` compare equal.
 */
export function normalizeGitRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim().toLowerCase();
  if (!u) return null;
  u = u.replace(/^[a-z+]+:\/\//, '');       // https://, ssh://, git+ssh://
  u = u.replace(/^[^@/]+@/, '');            // user@ / token@
  u = u.replace(/^([^/:]+):(?!\d)/, '$1/'); // scp-like host:owner/repo
  u = u.replace(/^www\./, '');
  u = u.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return u || null;
}
