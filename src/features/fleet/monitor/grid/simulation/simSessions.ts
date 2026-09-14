// simSessions — the live Claude sessions the simulated board places under its
// columns, plus two the board deliberately CANNOT place.
//
// A session reaches a column by `cwd` → `dev_projects.root_path` →
// `team_id` (`fleetSessionModel.groupSessions`), so the fixture sets a real
// `cwd` on every session rather than a team id: routing is the thing being
// simulated, and handing the board a pre-routed answer would exercise none of
// it. The last two sessions point at directories no simulated project owns —
// that is how the Ungrouped tray gets its session lane, and it is the branch
// most likely to rot unseen because a healthy real fleet rarely produces one.

import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { SimRoster } from './simFleet';
import { int, mulberry32, pick, SEED, type Rand } from './simRandom';

/** The states worth painting. `spawning` and `exited` are transient by design. */
const STATES: readonly FleetSessionState[] = [
  'running', 'awaiting_input', 'idle', 'stale', 'finished', 'hibernated',
];

const TITLES: readonly string[] = [
  'Splitting the settings module',
  'Chasing a flaky migration test',
  'Wiring the new usage endpoint',
  'Writing the release notes',
  'Reproducing the reported crash',
  'Tightening the retry budget',
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
  };
}

/**
 * Sessions across roughly half the projects — a board where every column has
 * one would be a board where the "no sessions, no divider" branch never
 * renders, and that branch is the reason `columnRows` exists.
 */
export function buildSimSessions(roster: SimRoster, now = Date.now()): FleetSession[] {
  const rand = mulberry32(SEED.sessions);
  const out: FleetSession[] = [];
  roster.projects.forEach((project, i) => {
    if (i % 2 === 1) return;
    for (let n = 0; n < int(rand, 1, 2); n += 1) {
      out.push(session(`sim-session-${i}-${n}`, project.root_path, project.name, now, rand));
    }
  });
  // The unplaceable pair: a real `cwd`, no project that owns it.
  out.push(session('sim-session-orphan-0', '/simulated/scratch', 'scratch', now, rand));
  out.push(session('sim-session-orphan-1', '/simulated/one-off', 'one-off', now, rand));
  return out;
}
