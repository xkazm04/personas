// §8 Athena orchestration & decision quality
// (docs/tests/autonomy-eval/evaluation-rubric.md).
//
// Scores how Athena ran the team UNATTENDED across the four axes the user
// asked to track when she has autonomous channel reactions enabled
// (`autonomous_athena_reactions`):
//
//   1. Channel reaction coverage — did she catch the moments she MUST catch
//      (awaiting-review cap-outs the team can't self-resolve), without being
//      expected to narrate routine progress.
//   2. Decision soundness — do her escalations align with genuinely stuck
//      moments (not over-escalating shipped goals), are directives in context.
//   3. Auditability — does every reaction carry its rationale footer + a link
//      to the assignment that prompted it, so the trail is reconstructable.
//   4. Restraint / no-spam — she reacts selectively, not once per step, and
//      doesn't repeat herself about the same assignment without new activity.
//
// PURE: takes only pre-read bundle arrays (no fs/db). Returns `null` — a strict
// no-op, byte-identical scorecard — when the run shows NO Athena channel posts
// AND NO reaction-worthy development moments (the golden-diff invariant, same
// discipline as §6 resilience / §7 standards). So runs that never enabled
// Athena reactions stay unchanged; the dimension only materializes when there
// is something to grade.
//
// These are deterministic heuristics over the channel/assignment trail; deep
// soundness ("was this the RIGHT message?") is left to the judge layer
// (`judgeRecommended: true`). The trail Athena writes —
// `companion/athena_reaction.rs` posts `author_kind='athena'`, an `⚠️ ` prefix
// on escalations, a `\n\n› <rationale>` footer, `assignment_id` linking the
// moment, and `consumer='inject'` when addressed to a persona — is exactly what
// these axes read.

/** More than this many Athena posts about ONE assignment (with no new
 *  reaction-worthy event between them) reads as repeating herself → spam. */
const MAX_POSTS_PER_ASSIGNMENT = 2;
/** Athena posting more than this multiple of the reaction-worthy moment count
 *  suggests she's narrating rather than reacting selectively. */
const SPAM_REACTION_RATE = 1.5;

const isAthena = (m) => m.author_kind === 'athena';
const hasRationale = (body) => typeof body === 'string' && /\n›\s/.test(body);
const isEscalation = (body) => typeof body === 'string' && body.trimStart().startsWith('⚠️');
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);

/**
 * @param {object} args
 * @param {Array}  args.channelMessages   team_channel_messages in window (channel.json)
 * @param {Array}  args.assignments       team_assignments in window (assignments.json)
 * @param {Array}  args.assignmentEvents  team_assignment_events in window (assignment_events.json)
 * @returns {null | object} §8 block, or null when not applicable (no-op)
 */
export function athenaOrchestration({ channelMessages = [], assignments = [], assignmentEvents = [] }) {
  const athenaMsgs = (channelMessages || []).filter(isAthena);

  // Reaction-worthy moments — the development events Athena is meant to watch.
  // `mustReact` flags the ones she's expected to surface (cap-outs): the team
  // cannot exit awaiting-review on its own, so silence there is a real miss.
  const moments = [];
  for (const a of assignments || []) {
    if (a.status === 'awaiting_review') {
      moments.push({ assignmentId: a.id, kind: 'awaiting_review', mustReact: true, at: a.created_at });
    } else if (a.status === 'done' && a.goal_id) {
      moments.push({ assignmentId: a.id, kind: 'goal_done', mustReact: false, at: a.completed_at || a.created_at });
    }
  }
  for (const e of assignmentEvents || []) {
    if (e.kind === 'qa_changes_requested_rework') {
      moments.push({ assignmentId: e.assignment_id, kind: 'qa_bounce', mustReact: false, at: e.created_at });
    }
  }

  // Strict no-op: nothing Athena-shaped happened → leave the scorecard untouched.
  if (athenaMsgs.length === 0 && moments.length === 0) return null;

  // Is a moment covered? An Athena post linked to that assignment, posted at or
  // after the moment occurred. (assignment_id is the link Athena writes.)
  const covers = (moment) =>
    athenaMsgs.some(
      (m) => m.assignment_id === moment.assignmentId && (!moment.at || !m.created_at || m.created_at >= moment.at),
    );

  // --- Axis 1: coverage (over the must-react / critical moments) ------------
  const critical = moments.filter((m) => m.mustReact);
  const criticalCovered = critical.filter(covers).length;
  const coverage = {
    criticalMoments: critical.length,
    criticalCovered,
    criticalCoveragePct: pct(criticalCovered, critical.length),
    reactionWorthyMoments: moments.length,
    // Informational, NOT a coverage target — she's meant to decline most of these.
    overallReactionRate: moments.length ? +(athenaMsgs.length / moments.length).toFixed(2) : null,
  };

  // --- Axis 2: decision soundness (heuristic) -------------------------------
  const momentByAssignment = new Map();
  for (const m of moments) {
    // Prefer the most "severe" moment per assignment (awaiting_review > others).
    const prev = momentByAssignment.get(m.assignmentId);
    if (!prev || (m.mustReact && !prev.mustReact)) momentByAssignment.set(m.assignmentId, m);
  }
  const unsoundEscalations = [];
  let sound = 0;
  for (const m of athenaMsgs) {
    const linked = m.assignment_id ? momentByAssignment.get(m.assignment_id) : null;
    if (isEscalation(m.body)) {
      // Escalations are sound when they sit on a genuinely-stuck moment.
      if (linked && linked.kind === 'awaiting_review') sound += 1;
      else unsoundEscalations.push({ assignment_id: m.assignment_id || null, linkedKind: linked?.kind ?? 'none' });
    } else {
      // Observations / directives are sound by default (they don't claim the
      // team is blocked); a directive is a steer that's fine in any context.
      sound += 1;
    }
  }
  const soundness = {
    posts: athenaMsgs.length,
    sound,
    unsound: unsoundEscalations.length,
    soundnessPct: pct(sound, athenaMsgs.length),
    unsoundEscalations,
    judgeRecommended: true,
  };

  // --- Axis 3: auditability -------------------------------------------------
  const withRationale = athenaMsgs.filter((m) => hasRationale(m.body)).length;
  const withLink = athenaMsgs.filter((m) => !!m.assignment_id).length;
  const fullyAuditable = athenaMsgs.filter((m) => hasRationale(m.body) && !!m.assignment_id).length;
  const auditability = {
    posts: athenaMsgs.length,
    withRationale,
    withLink,
    auditablePct: pct(fullyAuditable, athenaMsgs.length),
  };

  // --- Axis 4: restraint / no-spam ------------------------------------------
  const perAssignment = {};
  for (const m of athenaMsgs) {
    const k = m.assignment_id || '__none__';
    perAssignment[k] = (perAssignment[k] || 0) + 1;
  }
  const maxPostsPerAssignment = Object.values(perAssignment).reduce((a, b) => Math.max(a, b), 0);
  const reactionRate = coverage.overallReactionRate;
  const duplicateSuspected = maxPostsPerAssignment > MAX_POSTS_PER_ASSIGNMENT;
  const overReacting = reactionRate != null && reactionRate > SPAM_REACTION_RATE;
  const restraint = {
    athenaPosts: athenaMsgs.length,
    reactionWorthyMoments: moments.length,
    reactionRate,
    maxPostsPerAssignment,
    duplicateSuspected,
    overReacting,
    // Declines (react=false) are logged, not posted — not visible in the bundle;
    // restraint is inferred from posting selectivity instead.
    restraintOk: !duplicateSuspected && !overReacting,
  };

  // Mutually-exclusive post categories (sum === athenaPosts): an escalation
  // (⚠️) classifies first regardless of delivery; then a persona-addressed
  // directive (inject); everything else is a plain observation.
  let escalations = 0;
  let directives = 0;
  let observations = 0;
  for (const m of athenaMsgs) {
    if (isEscalation(m.body)) escalations += 1;
    else if (m.consumer === 'inject') directives += 1;
    else observations += 1;
  }

  return {
    applicable: true,
    axes: { coverage, soundness, auditability, restraint },
    facts: {
      athenaPosts: athenaMsgs.length,
      escalations,
      directives,
      observations,
    },
  };
}
