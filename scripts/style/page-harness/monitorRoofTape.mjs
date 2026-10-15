#!/usr/bin/env node
// The "one roof" tape (spark mandate-lanes, WP8): the Monitor's Classic fleet
// (`monitor/classic`, monitorActivityTapes.mjs) plus a team conversation that
// carries every band the Conversations tab draws - talk, an assignment in
// flight with a step waiting on review, a settled assignment, a live
// deliberation - and one held step for the rail's Reviews lamp. It lets the
// three Monitor tabs be shot on ONE tape, so "do they read as one surface" is
// judged on the same fleet in all three.
//
// Not a registry module: it is a tape builder for the existing `monitor/*`
// modules, driven to the tab with shoot.mjs --steps. Usage:
//   node scripts/style/page-harness/monitorRoofTape.mjs tmp/style-tapes/monitor-roof.json
//   node scripts/style/shoot.mjs --module monitor/classic --tape tmp/style-tapes/monitor-roof.json \
//     --reduced-motion --settle 2500 --out <dir> --label conversations \
//     --steps "wait=1500;click=[data-testid=monitor-view-conversations];wait=1500"
// (--reduced-motion: the Activity entrance's beats run on a clock the shooter
// freezes, so without it the board stays on its ghost beat.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSyntheticTape, RECORDED_AT } from './synthetic-tapes.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T0 = Date.parse(RECORDED_AT);
const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
const TEAM = 't-personas-desktop';
// Members of Personas Desktop on the Classic tape (home_team_id).
const [A, B, C] = ['p-board-0', 'p-board-1', 'p-board-2'];

const item = (id, kind, minutes, over = {}) => ({
  id, kind, at: ago(minutes), personaId: null, label: '', body: null, assignmentId: null, stepId: null,
  extra: null, replyTo: null, deliberationId: null, importance: null, consumers: null, ...over,
});

// Newest first, as `list_team_channel` returns it.
const channel = [
  item('rc-9', 'persona', 4, { personaId: A, body: 'Release notes for 1.1 are drafted. The **breaking change** to the vault export needs your eyes before I publish.' }),
  item('rc-8', 'step', 9, { assignmentId: 'asg-live', stepId: 'st-2', label: 'step_running', body: 'Ship the 1.1 release notes' }),
  item('rc-7', 'step', 22, { assignmentId: 'asg-live', stepId: 'st-1', label: 'step_running', body: 'Ship the 1.1 release notes' }),
  item('rc-6', 'directive', 30, { body: 'Ship the 1.1 notes today, keep the vault change at the top.' }),
  item('rc-5', 'persona', 48, { personaId: B, deliberationId: 'dl-1', body: 'Splitting the settings chunk saves 180 kB but adds a second request on cold start.' }),
  item('rc-4', 'persona', 52, { personaId: C, deliberationId: 'dl-1', body: 'Cold start is the path the operator sees most. I would keep one chunk and lazy-load the editor only.' }),
  item('rc-3', 'athena', 95, { body: 'Yesterday\'s PR review backlog is clear: 6 reviewed, 1 sent back.' }),
  item('rc-2', 'step', 140, { assignmentId: 'asg-done', stepId: 'st-9', label: 'step_done', body: 'Triage the Sentry backlog' }),
];

const step = (id, assignmentId, order, title, status, persona, over = {}) => ({
  id, assignmentId, stepOrder: order, title, description: null, status, assignedPersonaId: persona,
  assignedUseCaseId: null, matchConfidence: null, matchRationale: null, executionId: null, dependsOn: null,
  outputSummary: null, retryCount: 0, errorMessage: null, startedAt: ago(30), completedAt: null, ...over,
});

const deliberation = {
  id: 'dl-1', teamId: TEAM, topic: 'One settings chunk or two?', goal: null, status: 'converging', round: 3,
  consecutiveStallRounds: 0, costBudgetUsd: 5, costSpentUsd: 1.8, idleDeadline: null, resolution: null,
  spawnedAssignmentId: null, pendingAction: null, parentId: null, rosterIds: null, actionExecutionId: null,
  createdBy: 'athena', createdAt: ago(60), updatedAt: ago(48),
};

const heldStep = {
  id: 'rv-roof-1', execution_id: null, persona_id: A, title: 'Publish the 1.1 release notes?',
  description: 'The notes call out a breaking change to the vault export format.', severity: 'medium',
  context_data: null, suggested_actions: null, status: 'pending', reviewer_notes: null, resolved_at: null,
  created_at: ago(5), updated_at: ago(5), use_case_id: null, assignment_id: 'asg-live', step_id: 'st-2',
};

export function buildMonitorRoofTape() {
  const base = buildSyntheticTape('monitor/classic', REPO);
  return {
    ...base,
    module: 'monitor/classic',
    note: `${base.note} Plus a Personas Desktop conversation (talk, a live and a settled assignment, a converging deliberation) and one held step for its first member (monitorRoofTape.mjs).`,
    calls: [
      ...base.calls,
      { cmd: 'list_team_channel', args: { teamId: TEAM, before: null, beforeId: null, kinds: null, limit: 60 }, response: channel },
      { cmd: 'list_team_channel', response: [] },
      { cmd: 'count_team_channel_kinds', response: 0 },
      { cmd: 'list_team_deliberations', response: [deliberation] },
      { cmd: 'list_team_assignment_steps', args: { assignmentId: 'asg-live' }, response: [
        step('st-1', 'asg-live', 1, 'Draft the notes', 'done', A, { completedAt: ago(12) }),
        step('st-2', 'asg-live', 2, 'Publish to the changelog', 'awaiting_review', A),
      ] },
      { cmd: 'list_team_assignment_steps', args: { assignmentId: 'asg-done' }, response: [
        step('st-9', 'asg-done', 1, 'Triage the Sentry backlog', 'done', C, { completedAt: ago(140) }),
      ] },
      { cmd: 'list_manual_reviews_page', args: { personaId: A, status: 'pending', cursor: null, limit: 40 }, response: { rows: [heldStep], hasMore: false, nextCursor: null } },
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/monitor-roof.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildMonitorRoofTape(), null, 2));
  console.log(`wrote ${out}`);
}
