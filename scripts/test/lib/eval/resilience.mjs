// Resilience & Escalation scorer (rubric §6). Pure — unit-tested in tests/cli/resilience.test.mjs.
// Reads the bundle's incidents.json + executions.json + events.json (no DB, no app).
// Asserts the OBSERVABLE DB signals of the P2 incident escalation + auto-continuation loop.

/** Incidents a persona escalated via raise_incident (source_table='persona_blocker'). */
export function resilienceFacts(incidents = [], executions = [], events = []) {
  const blockerIncidents = incidents.filter((i) => i.source_table === 'persona_blocker');
  const raised = blockerIncidents.length;
  const resolved = blockerIncidents.filter((i) => i.status === 'resolved').length;
  // Auto-continuation stamps continued_at exactly once (claim_continuation).
  const continued = blockerIncidents.filter((i) => i.continued_at).length;

  // A resolved blocker incident's source_id IS the blocked execution id. The
  // auto-continuation creates a NEW execution via create_retry → that row's
  // retry_of_execution_id === the blocked exec id and it should reach completed.
  const blockedExecIds = new Set(
    blockerIncidents.filter((i) => i.status === 'resolved').map((i) => i.source_id),
  );
  const continuationExecs = executions.filter((e) => blockedExecIds.has(e.retry_of_execution_id));
  const continuationExecsCompleted = continuationExecs.filter((e) => e.status === 'completed').length;

  // §6.4 — the bus signal that drives event-orchestrated continuation.
  const incidentResolvedEvents = events.filter(
    (e) => e.event_type === 'incident_resolved' && e.status === 'delivered',
  ).length;
  const reviewDecisionEvents = events.filter(
    (e) => typeof e.event_type === 'string' && e.event_type.startsWith('review_decision.') && e.status === 'delivered',
  ).length;

  // Escalation CLOSED when every raised blocker was resolved AND auto-continued
  // AND its continuation execution completed. This is the core "the team
  // recovered from a real blocker without a human babysitting it" assertion.
  const escalationClosed =
    raised > 0 &&
    resolved === raised &&
    continued === raised &&
    continuationExecsCompleted >= resolved;

  // 0–100 recovery score (reported only; NOT folded into team_score).
  const recoveryScore = raised === 0 ? null : Math.round(
    ((resolved / raised) * 0.34 + (continued / raised) * 0.33 +
     (resolved ? Math.min(continuationExecsCompleted / resolved, 1) : 0) * 0.33) * 100,
  );

  return {
    raised, resolved, continued,
    continuationExecsCompleted,
    incidentResolvedEvents, reviewDecisionEvents,
    escalationClosed, recoveryScore,
  };
}
