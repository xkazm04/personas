/**
 * The arrival-notice state machine for work a paired device asked THIS device
 * to run.
 *
 * The companion emits `companion://remote-job-turn` with phase
 * `started` / `completed` / `failed` around the turn that answers a remote
 * instruction. That turn runs with `suppress_chat`, so this event is the only
 * signal the frontend gets — there is no chat bubble, and by explicit product
 * choice there must not be one: the operator asked for ambient awareness, not
 * a transcript entry and not a modal. The durable record is the `remote_jobs`
 * row in Settings → Devices; this machine only drives the quiet chip.
 *
 * Tauri events are fire-and-forget, so the machine is written to survive the
 * two ways they go wrong:
 *
 *  - **Out of order.** A `started` that arrives after its own terminal phase is
 *    ignored, and the FIRST terminal phase for a job wins, so a late duplicate
 *    can never re-open a notice that already settled.
 *  - **Missed entirely.** A terminal phase for a job we never saw start still
 *    produces a notice (the operator learns the errand happened), and a
 *    `started` whose terminal phase never arrives is swept by
 *    {@link RUNNING_NOTICE_TTL_MS} rather than pinning the chip forever.
 *
 * Everything here is pure. The store slice owns the array; the chip renders
 * {@link activeRemoteJobNotice}.
 */

/** Phases the companion emits. Anything else is ignored rather than shown. */
export type RemoteJobNoticePhase = 'started' | 'completed' | 'failed';

/**
 * Wire shape of `companion://remote-job-turn`
 * (`src-tauri/src/companion/session.rs::RemoteJobTurnEvent`). `phase` is typed
 * as a plain string on purpose: it crosses an untyped IPC boundary, so the
 * machine validates it instead of trusting it.
 */
export interface RemoteJobTurnEvent {
  jobId: string;
  /** The originating device's display name, as confirmed at pairing time. */
  source: string;
  instruction: string;
  phase: string;
  /** Empty on `started`. */
  summary: string;
}

/** One live notice. Newest-first in the array the store holds. */
export interface RemoteJobNotice {
  jobId: string;
  source: string;
  instruction: string;
  phase: RemoteJobNoticePhase;
  summary: string;
  /** Epoch ms at which this notice last changed phase. Drives expiry. */
  updatedAt: number;
}

/**
 * How long a settled notice lingers before it clears itself. Long enough to
 * read a device name and a one-line summary, short enough not to become
 * furniture.
 */
export const TERMINAL_NOTICE_TTL_MS = 12_000;

/**
 * How long a `started` notice may sit without a terminal phase. Deliberately
 * just past the companion's own 25-minute turn ceiling
 * (`session.rs::TURN_TIMEOUT`): inside that window the turn may genuinely still
 * be running, past it the terminal event is never coming.
 */
export const RUNNING_NOTICE_TTL_MS = 26 * 60 * 1000;

/** Most concurrent notices retained. Oldest are dropped first. */
export const MAX_REMOTE_JOB_NOTICES = 4;

export type RemoteJobNoticeAction =
  | { type: 'turn'; event: RemoteJobTurnEvent; now: number }
  | { type: 'dismiss'; jobId: string }
  | { type: 'expire'; now: number }
  | { type: 'reset' };

const TERMINAL_PHASES: ReadonlySet<RemoteJobNoticePhase> = new Set<RemoteJobNoticePhase>([
  'completed',
  'failed',
]);

/** True once the notice will not change phase again. */
export function isTerminalNoticePhase(phase: RemoteJobNoticePhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

function parsePhase(phase: string): RemoteJobNoticePhase | null {
  return phase === 'started' || phase === 'completed' || phase === 'failed' ? phase : null;
}

/** The notice the chip shows: the most recently changed one, or null. */
export function activeRemoteJobNotice(notices: readonly RemoteJobNotice[]): RemoteJobNotice | null {
  return notices[0] ?? null;
}

/** TTL for a notice in the given phase. */
function ttlFor(phase: RemoteJobNoticePhase): number {
  return isTerminalNoticePhase(phase) ? TERMINAL_NOTICE_TTL_MS : RUNNING_NOTICE_TTL_MS;
}

/**
 * Fold one action into the notice list. Returns the SAME array reference when
 * nothing changed, so a store `set` driven by this never re-renders the orb
 * layer for a no-op event.
 */
export function reduceRemoteJobNotices(
  notices: readonly RemoteJobNotice[],
  action: RemoteJobNoticeAction,
): RemoteJobNotice[] {
  switch (action.type) {
    case 'reset':
      return notices.length === 0 ? (notices as RemoteJobNotice[]) : [];

    case 'dismiss': {
      const next = notices.filter((n) => n.jobId !== action.jobId);
      return next.length === notices.length ? (notices as RemoteJobNotice[]) : next;
    }

    case 'expire': {
      const next = notices.filter((n) => action.now - n.updatedAt < ttlFor(n.phase));
      return next.length === notices.length ? (notices as RemoteJobNotice[]) : next;
    }

    case 'turn': {
      const { event, now } = action;
      const phase = parsePhase(event.phase);
      const jobId = event.jobId?.trim();
      // An unknown phase or an unidentifiable job is not something we can
      // reason about — drop it rather than showing a chip we can never clear.
      if (!phase || !jobId) return notices as RemoteJobNotice[];

      const existing = notices.find((n) => n.jobId === jobId);
      // First terminal phase wins, and a `started` can never re-open a settled
      // notice — both are the out-of-order guard.
      if (existing && isTerminalNoticePhase(existing.phase)) return notices as RemoteJobNotice[];
      if (existing && existing.phase === phase) return notices as RemoteJobNotice[];

      const notice: RemoteJobNotice = {
        jobId,
        // A terminal event for a job we never saw start still carries the
        // source; prefer what we already learned if the late payload is thin.
        source: event.source?.trim() || existing?.source || '',
        instruction: event.instruction?.trim() || existing?.instruction || '',
        phase,
        summary: event.summary?.trim() ?? '',
        updatedAt: now,
      };

      return [notice, ...notices.filter((n) => n.jobId !== jobId)].slice(
        0,
        MAX_REMOTE_JOB_NOTICES,
      );
    }
  }
}
