// simSessions — the live Claude sessions the simulated board places under its
// columns, plus two the board deliberately CANNOT place, plus the QUEUE: thirty
// queued rows (ranks 1..30, mixed origins, a few gated by a future
// `notBeforeMs`) and the `FleetQueueSnapshot` the door would report for them
// at a cap of ten — so every queue board, the stepper's `10 / 10` readout and
// the over-admission tone can be walked without a real fleet.
//
// A session reaches a column by `cwd` → `dev_projects.root_path` →
// `team_id` (`fleetSessionModel.groupSessions`), so the fixture sets a real
// `cwd` on every session rather than a team id: routing is the thing being
// simulated, and handing the board a pre-routed answer would exercise none of
// it. The last two sessions point at directories no simulated project owns —
// that is how the Ungrouped tray gets its session lane, and it is the branch
// most likely to rot unseen because a healthy real fleet rarely produces one.

import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { FleetQueueEntry } from '@/lib/bindings/FleetQueueEntry';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { SimRoster } from './simFleet';
import { int, mulberry32, pick, SEED, type Rand } from './simRandom';

/** The door's cap in the simulated world — ten, the setting's default. */
export const SIM_QUEUE_CAP = 10;
export const SIM_LIVE_SESSIONS = 10;
export const SIM_QUEUED_SESSIONS = 30;
/** Mean session length the fabricated snapshot estimates starts from. */
const SIM_MEAN_DURATION_MS = 9 * 60 * 1_000;

const ORIGINS: readonly DispatchOrigin[] = [
  'manual', 'dev_runner', 'dispatch_ideas', 'athena', 'autopilot', 'night_shift', 'feed_impact', 'orphan_resume',
];

/** The states worth painting. `spawning` and `exited` are transient by design. */
const STATES: readonly FleetSessionState[] = [
  'running', 'awaiting_input', 'idle', 'stale', 'finished', 'hibernated',
];

/**
 * Realistic task titles — every one of them LONGER than a node's title row
 * (≥ 40 characters), so the simulated board shows truncation the way a real
 * fleet does and the tooltip's full title has something to add. A fixture of
 * short titles would certify a node that never has to truncate.
 */
const TITLES: readonly string[] = [
  'Splitting the settings module into per-tab chunks',
  'Chasing a flaky migration test on the cold-start path',
  'Wiring the new usage endpoint through the shared client',
  'Writing the release notes for the queue and the cap',
  'Reproducing the reported crash on a resumed session',
  'Tightening the retry budget around the vault reads',
];

const REASONS: readonly string[] = [
  'Notification: permission requested',
  'Stop hook',
  'PreToolUse: Edit',
];

function session(id: string, cwd: string, projectLabel: string, now: number, rand: Rand): FleetSession {
  const state = pick(rand, STATES);
  const ageMs = int(rand, 20, 9_000) * 1_000;
  return {
    id,
    claudeSessionId: `${id}-claude`,
    cwd,
    projectLabel,
    name: null,
    title: pick(rand, TITLES),
    args: [],
    mode: 'interactive',
    state,
    lastActivityMs: BigInt(now - int(rand, 1, 600) * 1_000),
    lastPtyOutputMs: BigInt(now - int(rand, 1, 900) * 1_000),
    lastGrewMs: BigInt(now - int(rand, 1, 1_200) * 1_000),
    createdAtMs: BigInt(now - ageMs),
    childPid: int(rand, 4_000, 60_000),
    exitCode: null,
    stateReason: pick(rand, REASONS),
    athenaActive: state === 'awaiting_input' && int(rand, 0, 2) === 0,
    dozing: state === 'stale' && int(rand, 0, 2) === 0,
    limitResetAtMs: null,
    staleKind: state === 'stale' ? pick(rand, ['done', 'blocked_question', 'hung_mid_tool']) : null,
    queueRank: null,
    queuedAtMs: null,
    notBeforeMs: null,
    origin: null,
    personaId: null,
    goalId: null,
    cycleIndex: null,
  };
}

/**
 * Ten LIVE sessions on the even projects — eight placed, two the board cannot
 * place — so half the columns stay session-less (the "no sessions, no
 * divider" branch is the reason `columnRows` exists) — and THIRTY QUEUED rows
 * spread over the same even projects, ranks 1..30 in the order they are
 * pushed, origins rotating through every token, every fifth gated by a
 * `notBeforeMs` in the future.
 */
export function buildSimSessions(roster: SimRoster, now = Date.now()): FleetSession[] {
  const rand = mulberry32(SEED.sessions);
  const out: FleetSession[] = [];
  const even = roster.projects.filter((_, i) => i % 2 === 0);
  even.slice(0, SIM_LIVE_SESSIONS - 2).forEach((project, i) => {
    out.push(session(`sim-session-${i}-0`, project.root_path, project.name, now, rand));
  });
  // The unplaceable pair: a real `cwd`, no project that owns it.
  out.push(session('sim-session-orphan-0', '/simulated/scratch', 'scratch', now, rand));
  out.push(session('sim-session-orphan-1', '/simulated/one-off', 'one-off', now, rand));

  for (let rank = 1; rank <= SIM_QUEUED_SESSIONS; rank += 1) {
    const project = even[(rank - 1) % even.length]!;
    const base = session(`sim-queued-${rank}`, project.root_path, project.name, now, rand);
    out.push({
      ...base,
      state: 'queued',
      childPid: null,
      claudeSessionId: null,
      stateReason: null,
      athenaActive: false,
      dozing: false,
      staleKind: null,
      queueRank: rank,
      queuedAtMs: now - (SIM_QUEUED_SESSIONS - rank) * 45_000,
      notBeforeMs: rank % 5 === 0 ? now + rank * 4 * 60_000 : null,
      origin: ORIGINS[(rank - 1) % ORIGINS.length]!,
      personaId: rank % 3 === 0 ? roster.personas[(rank * 7) % roster.personas.length]!.id : null,
      goalId: null,
      cycleIndex: rank % 4 === 0 ? 7 : null,
    });
  }
  return out;
}

/** The snapshot the door would report for `sessions` at `SIM_QUEUE_CAP`. */
export function buildSimQueueSnapshot(sessions: readonly FleetSession[], now = Date.now()): FleetQueueSnapshot {
  const queued = sessions.filter((x) => x.state === 'queued').sort((a, b) => (a.queueRank ?? 0) - (b.queueRank ?? 0));
  const running = sessions.filter((x) => x.state !== 'queued' && x.state !== 'exited').length;
  const entries: FleetQueueEntry[] = queued.map((x, i) => ({
    sessionId: x.id,
    rank: i + 1,
    // The row's token is one of the eight; the fixture writes only those.
    origin: (x.origin ?? 'manual') as DispatchOrigin,
    personaId: x.personaId,
    goalId: x.goalId,
    queuedAtMs: x.queuedAtMs ?? now,
    notBeforeMs: x.notBeforeMs,
    estimatedStartMs: now + (i + 1) * SIM_MEAN_DURATION_MS,
  }));
  return {
    cap: SIM_QUEUE_CAP,
    running,
    queued: entries.length,
    overAdmitted: Math.max(0, running - SIM_QUEUE_CAP),
    entries,
  };
}
