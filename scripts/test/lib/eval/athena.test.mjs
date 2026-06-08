// Unit tests for the §8 Athena orchestration scorer. Plain node + assert, no
// deps (mirrors scripts/docs/__tests__/check-doc-sync.test.mjs). Run with:
//   node scripts/test/lib/eval/athena.test.mjs
import assert from 'node:assert/strict';
import { athenaOrchestration } from './athena.mjs';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
};

// Helpers ---------------------------------------------------------------------
const athenaMsg = (over = {}) => ({
  author_kind: 'athena',
  body: 'A note about the work.',
  consumer: 'display',
  assignment_id: null,
  created_at: '2026-06-08 10:00:00',
  ...over,
});
const escalation = (assignmentId, at = '2026-06-08 10:00:00') =>
  athenaMsg({
    body: `⚠️ PR is parked in awaiting-review and the team can't self-resolve.\n\n› cap-out needs a human`,
    assignment_id: assignmentId,
    created_at: at,
  });

// 1. Strict no-op ------------------------------------------------------------
test('returns null when there is no Athena activity AND no moments', () => {
  assert.equal(athenaOrchestration({ channelMessages: [], assignments: [], assignmentEvents: [] }), null);
  // Non-athena chatter + no moments is still a no-op.
  const r = athenaOrchestration({
    channelMessages: [{ author_kind: 'director', body: 'coaching', created_at: '2026-06-08 09:00:00' }],
    assignments: [],
    assignmentEvents: [],
  });
  assert.equal(r, null);
});

// 2. Coverage: catches the must-react cap-out --------------------------------
test('critical coverage credits an escalation linked to an awaiting_review assignment', () => {
  const r = athenaOrchestration({
    channelMessages: [escalation('a1', '2026-06-08 10:05:00')],
    assignments: [{ id: 'a1', status: 'awaiting_review', goal_id: 'g1', created_at: '2026-06-08 10:00:00' }],
    assignmentEvents: [],
  });
  assert.equal(r.applicable, true);
  assert.equal(r.axes.coverage.criticalMoments, 1);
  assert.equal(r.axes.coverage.criticalCovered, 1);
  assert.equal(r.axes.coverage.criticalCoveragePct, 100);
});

test('a missed cap-out scores 0% critical coverage', () => {
  const r = athenaOrchestration({
    channelMessages: [], // Athena said nothing
    assignments: [{ id: 'a1', status: 'awaiting_review', goal_id: 'g1', created_at: '2026-06-08 10:00:00' }],
    assignmentEvents: [],
  });
  assert.equal(r.applicable, true);
  assert.equal(r.axes.coverage.criticalCoveragePct, 0);
});

// 3. Soundness: over-escalation on a shipped goal is unsound -----------------
test('escalating a goal_done (not a stuck moment) is counted unsound', () => {
  const r = athenaOrchestration({
    channelMessages: [escalation('a1')],
    assignments: [{ id: 'a1', status: 'done', goal_id: 'g1', created_at: '2026-06-08 09:00:00', completed_at: '2026-06-08 09:30:00' }],
    assignmentEvents: [],
  });
  assert.equal(r.axes.soundness.unsound, 1);
  assert.equal(r.axes.soundness.sound, 0);
  assert.equal(r.axes.soundness.soundnessPct, 0);
  assert.equal(r.axes.soundness.unsoundEscalations[0].linkedKind, 'goal_done');
});

test('a plain observation (no escalation) is sound by default', () => {
  const r = athenaOrchestration({
    channelMessages: [athenaMsg({ body: 'Shipped the validation fix.\n\n› milestone worth recording', assignment_id: 'a1' })],
    assignments: [{ id: 'a1', status: 'done', goal_id: 'g1', created_at: '2026-06-08 09:00:00', completed_at: '2026-06-08 09:30:00' }],
    assignmentEvents: [],
  });
  assert.equal(r.axes.soundness.sound, 1);
  assert.equal(r.axes.soundness.unsound, 0);
});

// 4. Auditability: rationale footer + assignment link ------------------------
test('auditability requires BOTH a rationale footer and an assignment link', () => {
  const r = athenaOrchestration({
    channelMessages: [
      athenaMsg({ body: 'linked + rationale\n\n› because', assignment_id: 'a1' }), // fully auditable
      athenaMsg({ body: 'rationale only\n\n› because', assignment_id: null }), // no link
      athenaMsg({ body: 'no rationale', assignment_id: 'a1' }), // no footer
    ],
    assignments: [{ id: 'a1', status: 'awaiting_review', goal_id: 'g1', created_at: '2026-06-08 09:00:00' }],
    assignmentEvents: [],
  });
  assert.equal(r.axes.auditability.posts, 3);
  assert.equal(r.axes.auditability.withRationale, 2);
  assert.equal(r.axes.auditability.withLink, 2);
  assert.equal(r.axes.auditability.auditablePct, 33); // only 1/3 has both
});

// 5. Restraint: repeating about one assignment trips the spam flag -----------
test('more than MAX_POSTS_PER_ASSIGNMENT about one assignment flags duplicate', () => {
  const r = athenaOrchestration({
    channelMessages: [
      athenaMsg({ body: 'p1\n\n› r', assignment_id: 'a1' }),
      athenaMsg({ body: 'p2\n\n› r', assignment_id: 'a1' }),
      athenaMsg({ body: 'p3\n\n› r', assignment_id: 'a1' }),
    ],
    assignments: [{ id: 'a1', status: 'awaiting_review', goal_id: 'g1', created_at: '2026-06-08 09:00:00' }],
    assignmentEvents: [],
  });
  assert.equal(r.axes.restraint.maxPostsPerAssignment, 3);
  assert.equal(r.axes.restraint.duplicateSuspected, true);
  assert.equal(r.axes.restraint.restraintOk, false);
});

test('selective single reaction per moment keeps restraintOk true', () => {
  const r = athenaOrchestration({
    channelMessages: [escalation('a1', '2026-06-08 10:05:00')],
    assignments: [
      { id: 'a1', status: 'awaiting_review', goal_id: 'g1', created_at: '2026-06-08 10:00:00' },
      { id: 'a2', status: 'done', goal_id: 'g2', created_at: '2026-06-08 08:00:00', completed_at: '2026-06-08 08:30:00' },
    ],
    assignmentEvents: [{ assignment_id: 'a2', kind: 'qa_changes_requested_rework', created_at: '2026-06-08 08:10:00' }],
  });
  assert.equal(r.axes.restraint.restraintOk, true);
  assert.equal(r.axes.restraint.duplicateSuspected, false);
  // 1 post over 3 moments → she declined most: not over-reacting.
  assert.equal(r.axes.restraint.overReacting, false);
});

// 6. Facts breakdown ---------------------------------------------------------
test('facts split escalations / directives / observations', () => {
  const r = athenaOrchestration({
    channelMessages: [
      escalation('a1'), // escalation, display
      athenaMsg({ body: 'Dev Clone, stabilize the test.\n\n› repeating bounce', consumer: 'inject', assignment_id: 'a2' }), // directive
    ],
    assignments: [{ id: 'a1', status: 'awaiting_review', goal_id: 'g1', created_at: '2026-06-08 09:00:00' }],
    assignmentEvents: [{ assignment_id: 'a2', kind: 'qa_changes_requested_rework', created_at: '2026-06-08 09:10:00' }],
  });
  assert.equal(r.facts.athenaPosts, 2);
  assert.equal(r.facts.escalations, 1);
  assert.equal(r.facts.directives, 1);
  assert.equal(r.facts.observations, 0); // mutually exclusive → sums to athenaPosts
  assert.equal(r.facts.escalations + r.facts.directives + r.facts.observations, r.facts.athenaPosts);
});

console.log(`✓ athena.mjs scorer: ${passed} assertions passed`);
