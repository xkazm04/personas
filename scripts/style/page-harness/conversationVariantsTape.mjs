#!/usr/bin/env node
// The Conversations variants tape (spark mandate-lanes, WP12 Phase A). The
// WP8 roof tape (`monitorRoofTape.mjs`: the Classic fleet plus a Personas
// Desktop conversation with talk, a live and a settled assignment, a
// converging deliberation and one held step) grown to what the restructure
// has to carry: an operator reply after a persona message, a second and third
// held step from two other members (so the Reviews rail lists three), an
// outcome on the settled run, and two persona conversations so the sidebar's
// Personas group renders. The "before" shot (today's tab) and the three
// variants are shot on this one tape, so they show the same project.
//
// Usage:
//   node scripts/style/page-harness/conversationVariantsTape.mjs tmp/style-tapes/conv-variants.json
//   node scripts/style/shoot.mjs --module monitor/conversations/v1 --tape tmp/style-tapes/conv-variants.json \
//     --reduced-motion --settle 2500 --out <dir> --label v1
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED_AT } from './synthetic-tapes.mjs';
import { buildMonitorRoofTape } from './monitorRoofTape.mjs';

const T0 = Date.parse(RECORDED_AT);
const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
const TEAM = 't-personas-desktop';
const [A, B, C, D] = ['p-board-0', 'p-board-1', 'p-board-2', 'p-board-3'];

const item = (id, kind, minutes, over = {}) => ({
  id, kind, at: ago(minutes), personaId: null, label: '', body: null, assignmentId: null, stepId: null,
  extra: null, replyTo: null, deliberationId: null, importance: null, consumers: null, ...over,
});

/** Newest first, as `list_team_channel` returns it: the roof's channel plus a reply and a PR line. */
export const CHANNEL = [
  item('rc-12', 'persona', 1, { personaId: B, body: 'Settings split PR #482 is green. Merging needs your sign-off because it touches the build config.' }),
  item('rc-11', 'directive', 2, { body: 'Looks right. Link the migration guide from the vault line before it goes out.' }),
  item('rc-9', 'persona', 4, { personaId: A, body: 'Release notes for 1.1 are drafted. The **breaking change** to the vault export needs your eyes before I publish.' }),
  item('rc-8', 'step', 9, { assignmentId: 'asg-live', stepId: 'st-2', label: 'step_running', body: 'Ship the 1.1 release notes' }),
  item('rc-7', 'step', 22, { assignmentId: 'asg-live', stepId: 'st-1', label: 'step_running', body: 'Ship the 1.1 release notes' }),
  item('rc-q', 'persona', 20, { personaId: D, body: 'Before I outline the 1.1 launch post: which readers is it for?' }),
  item('rc-6', 'directive', 30, { body: 'Ship the 1.1 notes today, keep the vault change at the top.' }),
  item('rc-5', 'persona', 48, { personaId: B, deliberationId: 'dl-1', body: 'Splitting the settings chunk saves 180 kB but adds a second request on cold start.' }),
  item('rc-4', 'persona', 52, { personaId: C, deliberationId: 'dl-1', body: 'Cold start is the path the operator sees most. I would keep one chunk and lazy-load the editor only.' }),
  item('rc-3', 'athena', 95, { body: 'Yesterday\'s PR review backlog is clear: 6 reviewed, 1 sent back.' }),
  item('rc-2', 'step', 140, { assignmentId: 'asg-done', stepId: 'st-9', label: 'step_done', body: 'Triage the Sentry backlog' }),
];

const held = (id, persona, minutes, title, description, severity, over = {}) => ({
  id, execution_id: null, persona_id: persona, title, description, severity,
  context_data: null, suggested_actions: null, status: 'pending', reviewer_notes: null, resolved_at: null,
  created_at: ago(minutes), updated_at: ago(minutes), use_case_id: null, assignment_id: null, step_id: null, ...over,
});

/** Three held steps in one project: the run's publish gate, a merge, a triage close. */
export const HELD = [
  held('rv-roof-1', A, 5, 'Publish the 1.1 release notes?', 'The notes call out a breaking change to the vault export format.', 'medium', { assignment_id: 'asg-live', step_id: 'st-2' }),
  held('rv-wp12-2', B, 1, 'Merge PR #482, the settings chunk split?', 'Green on CI. It changes vite.config chunking, so the next release build is the first real test.', 'high', { suggested_actions: '["Merge after one more CI run"]' }),
  held('rv-wp12-3', C, 130, 'Close 11 Sentry issues as noise?', 'All 11 are the same ResizeObserver warning from a browser extension.', 'low'),
];

const page = (rows) => ({ rows, hasMore: false, nextCursor: null });

const preview = (id, persona, minutes, kind, authorKind, title, body) => [{
  id, kind, at: ago(minutes), authorKind, title, body, reportId: kind === 'report' ? `${id}-r` : null,
  reviewId: null, severity: null, suggestedActions: null, executionId: null, replyTo: null, extra: null,
}];

export function buildConversationVariantsTape() {
  const roof = buildMonitorRoofTape();
  // The roof's channel, its single held step and the settled run's step are replaced, not appended to:
  // the player answers the LAST entry whose args match, but a reader of this file should see one answer.
  const kept = roof.calls.filter((c) => !(
    (c.cmd === 'list_team_channel' && c.args) ||
    c.cmd === 'list_manual_reviews_page' ||
    (c.cmd === 'list_team_assignment_steps' && c.args?.assignmentId === 'asg-done')
  ));
  const doneStep = {
    id: 'st-9', assignmentId: 'asg-done', stepOrder: 1, title: 'Triage the Sentry backlog', description: null,
    status: 'done', assignedPersonaId: C, assignedUseCaseId: null, matchConfidence: null, matchRationale: null,
    executionId: null, dependsOn: null, retryCount: 0, errorMessage: null, startedAt: ago(170), completedAt: ago(140),
    outputSummary: '14 issues triaged: 3 filed as bugs, 11 are one extension warning.',
  };
  return {
    ...roof,
    note: `${roof.note} Grown for WP12 (conversationVariantsTape.mjs): an operator reply, three held steps, an outcome on the settled run, two persona conversations.`,
    calls: [
      ...kept,
      { cmd: 'list_team_channel', args: { teamId: TEAM, before: null, beforeId: null, kinds: null, limit: 60 }, response: CHANNEL },
      { cmd: 'list_team_assignment_steps', args: { assignmentId: 'asg-done' }, response: [doneStep] },
      { cmd: 'list_manual_reviews_page', response: page([]) },
      ...[A, B, C].map((personaId) => ({
        cmd: 'list_manual_reviews_page', args: { personaId, status: 'pending', cursor: null, limit: 40 },
        response: page(HELD.filter((h) => h.persona_id === personaId)),
      })),
      { cmd: 'list_persona_channel', response: [] },
      { cmd: 'list_persona_channel', args: { personaId: A, limit: 1, before: null, beforeId: null, kinds: null },
        response: preview('pch-a1', A, 3, 'chat', 'persona', null, 'Draft is in the notes folder.') },
      { cmd: 'list_persona_channel', args: { personaId: D, limit: 1, before: null, beforeId: null, kinds: null },
        response: preview('prep-d1', D, 62, 'report', 'persona', '1.1 launch post outline', 'Three angles for the launch post.') },
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? 'tmp/style-tapes/conv-variants.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildConversationVariantsTape(), null, 2));
  console.log(`wrote ${out}`);
}
