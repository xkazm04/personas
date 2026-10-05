// Synthetic tapes for the Monitor's Activity board, Classic and Lanes
// (monitorActivitySurfaces.tsx). Fixture CODE, no personal data.
//
// The persona fleet is the Board's real-shaped one (monitorBoardTapes.mjs): 30
// personas shaped like the operator's database. On top of it this adds what the
// Board does not draw and Activity does: Claude Code sessions in every state a
// session card paints (running, awaiting input, idle, stale, finished,
// hibernated, a failed and a clean exit inside the parked hour) and a short
// queue, so Classic's bays carry session lines and all three Lanes fill.
// Three dev projects tie session directories to teams, so sessions land in
// their bays; one directory no project owns lands in the ungrouped tray.
//
// The simulation variants reuse the Board's simulation shell: their fleet,
// sessions and queue are the test build's own.

import { monitorBoardTapes } from './monitorBoardTapes.mjs';

const PROJECTS = [
  ['dp-personas', 'personas', '/work/personas', 't-personas-desktop'],
  ['dp-docs', 'docs', '/work/docs', 't-docs'],
  ['dp-research', 'research', '/work/research', 't-research'],
];

/** [id, state, title, cwd, ageMin, idleMin, origin, extra] */
const SESSIONS = [
  ['s-run-1', 'running', 'Splitting the settings module into per-tab chunks', '/work/personas', 23, 0, 'dev_runner'],
  ['s-wait-1', 'awaiting_input', 'Fix flaky login test', '/work/personas', 8, 2, 'manual'],
  ['s-stale-1', 'stale', 'Chasing a flaky migration test on the cold-start path', '/work/personas', 60 * 30, 60 * 5, 'athena', { staleKind: 'blocked_question' }],
  ['s-idle-1', 'idle', 'Write ADR for the queue', '/work/docs', 190, 40, 'manual'],
  ['s-run-2', 'running', 'Bump vite to 8.1', '/work/research', 4, 0, 'autopilot'],
  ['s-run-3', 'running', 'Triage Sentry backlog', '/work/scratch', 61, 0, 'night_shift'],
  ['s-fin-1', 'finished', 'Recap modal copy pass', '/work/docs', 75, 30, 'dispatch_ideas'],
  ['s-hib-1', 'hibernated', 'Port ghost to v2 laws', '/work/personas', 60 * 9, 60 * 2, 'feed_impact'],
  ['s-fail-1', 'exited', 'Wiring the new usage endpoint through the shared client', '/work/personas', 50, 12, 'dev_runner', { exitCode: 1 }],
  ['s-done-1', 'exited', 'Rename the cap setting', '/work/research', 35, 20, 'manual', { exitCode: 0 }],
];
/** [id, title, cwd, origin, waitMin, notBeforeMin] */
const QUEUED = [
  ['q-1', 'Add ETA to queue tile', '/work/personas', 'dev_runner', 6, null],
  ['q-2', 'Tightening the retry budget around the vault reads', '/work/research', 'autopilot', 14, null],
  ['q-3', 'Split settings chunks', '/work/docs', 'athena', 22, 40],
  ['q-4', 'Retry budget on vault', '/work/personas', 'night_shift', 31, null],
];

export function monitorActivityTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const board = monitorBoardTapes({ RECORDED_AT }).builders;

  const projects = PROJECTS.map(([id, name, root_path, team_id]) => ({
    id, name, root_path, description: null, status: 'active', tech_stack: null, github_url: null,
    monitoring_credential_id: null, monitoring_project_slug: null, static_scan_config: null, pr_credential_id: null,
    llm_tracking_credential_id: null, support_credential_id: null, data_links: null, test_env_url: null,
    test_env_branch: null, main_branch: 'master', standards_config: null, team_id, workspace_id: null, kind: 'code',
    enabled: true, created_at: ago(60 * 24 * 30), updated_at: ago(60 * 24),
  }));
  const labelOf = (cwd) => cwd.split('/').pop();
  const session = (id, state, title, cwd, ageMin, idleMin, origin, extra = {}) => ({
    id, claudeSessionId: state === 'queued' ? null : `${id}-claude`, cwd, projectLabel: labelOf(cwd), name: null, title,
    args: [], mode: 'interactive', state,
    lastActivityMs: T0 - idleMin * 60_000, lastPtyOutputMs: T0 - idleMin * 60_000, lastGrewMs: T0 - idleMin * 60_000,
    createdAtMs: T0 - ageMin * 60_000, childPid: state === 'queued' || state === 'exited' ? null : 4100 + ageMin,
    exitCode: null, stateReason: null, athenaActive: false, dozing: false, limitResetAtMs: null, staleKind: null,
    queueRank: null, queuedAtMs: null, notBeforeMs: null, origin, athenaFlagged: false, lane: null, reservedBand: null,
    personaId: null, goalId: null, cycleIndex: null, runLabel: null, runId: null, contestId: null,
    contestProjectId: null, remoteJobId: null, originPeerId: null, ...extra,
  });
  const live = SESSIONS.map(([id, state, title, cwd, age, idle, origin, extra]) => session(id, state, title, cwd, age, idle, origin, extra));
  const queued = QUEUED.map(([id, title, cwd, origin, wait, gate], i) => session(id, 'queued', title, cwd, wait, wait, origin, {
    queueRank: i + 1, queuedAtMs: T0 - wait * 60_000, notBeforeMs: gate === null ? null : T0 + gate * 60_000,
  }));
  const snapshot = {
    cap: 4, running: 3, queued: queued.length, overAdmitted: 0,
    entries: QUEUED.map(([id, , , origin, wait, gate], i) => ({
      sessionId: id, rank: i + 1, origin, personaId: null, goalId: null, queuedAtMs: T0 - wait * 60_000,
      notBeforeMs: gate === null ? null : T0 + gate * 60_000, estimatedStartMs: T0 + (i + 1) * 9 * 60_000,
      machineUnits: 1, planUnits: 1, gpu: 'none', skips: 0, heldBy: null, lane: null, reservedBand: null,
    })),
    budgets: {
      enabled: false, machineUsed: 3, machineBudget: 8, planUsed: 3, planBudget: 8, planBudgetMax: 8, paceFactor: 1,
      behindPct: null, ramPct: null, ramGate: 'open', gpuHolder: null, hold: null,
    },
  };

  const withSessions = (tape, module, note) => ({
    ...tape,
    module,
    note: `${tape.note} ${note}`,
    calls: [
      ...tape.calls.filter((c) => c.cmd !== 'fleet_list_sessions' && c.cmd !== 'dev_tools_list_projects'),
      { cmd: 'fleet_list_sessions', response: { sessions: [...live, ...queued], hookPort: null, hooksInstalled: true } },
      { cmd: 'dev_tools_list_projects', response: projects },
      { cmd: 'fleet_queue_snapshot', response: snapshot },
    ],
  });
  const sim = (module) => ({ ...board['monitor/board/sim'](), module });
  const NOTE = 'Plus 10 sessions in every painted state and a queue of 4 (3 dev projects tie them to bays).';
  return {
    builders: {
      'monitor/classic': () => withSessions(board['monitor/board'](), 'monitor/classic', NOTE),
      'monitor/lanes': () => withSessions(board['monitor/board'](), 'monitor/lanes', NOTE),
      'monitor/classic/sim': () => sim('monitor/classic/sim'),
      'monitor/lanes/sim': () => sim('monitor/lanes/sim'),
    },
  };
}
