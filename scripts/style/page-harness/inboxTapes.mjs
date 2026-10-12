// Synthetic IPC tapes for the two Overview inbox surfaces (kit batch
// overview-1, builder AI): Approvals (`sub_manual-review`) and Incidents
// (`sub_incidents`). Neither surface had a harness view before this batch.
//
// Shapes come from the bindings: `PersonaManualReview` + `ManualReviewPage` +
// `ManualReviewCounts` for Approvals, `AuditIncident` + `AuditIncidentSummary`
// for Incidents. Every timestamp is an offset from RECORDED_AT, which the
// shooter also uses as the frozen page clock, so "5 min ago" and the day
// grouping read the same on every run.
//
// Two fixture decisions are load-bearing for what these surfaces are gated on:
//
// 1. **Approvals carries three workspaces and one unassigned persona.** The
//    queue sidebar tints a persona name by the workspace its home team belongs
//    to, so the fixture needs `list_teams` rows with a `workspace_id` AND a
//    persona whose `home_team_id` is null, which is the common case for a
//    local fleet and must render the neutral default.
// 2. **Incidents returns exactly `DEFAULT_LIMIT` (100) rows.** That is the only
//    state in which the list-truncated notice renders at all, and moving that
//    notice into the table footer is this module's brief.

/** [minutesAgo, personaId, severity, status, title, decisions] */
const REVIEW_ROWS = [
  [4, 'p-triage', 'critical', 'pending', 'Delete 1,284 archived threads from the shared inbox?', 3],
  [11, 'p-review', 'warning', 'pending', 'Merge the refactor branch with two failing contract tests?', 2],
  [23, 'p-release', 'info', 'pending', 'Publish the 4.2 release notes to the public changelog?', 0],
  [38, 'p-research', 'warning', 'pending', 'Spend the remaining $180 of the research budget on one deep report?', 2],
  [57, 'p-finance', 'critical', 'pending', 'Reconcile the two invoices that disagree by $4,210?', 4],
  [92, 'p-monitor', 'info', 'pending', 'Raise the uptime alert threshold from 3 failures to 5?', 0],
  [141, 'p-triage', 'warning', 'pending', 'Unsubscribe the team from 14 low-signal notification sources?', 2],
  [208, 'p-review', 'info', 'pending', 'Adopt the stricter lint preset across the two shared packages?', 0],
];

/** [minutesAgo, personaId, severity, status, sourceTable, kind, title] */
const INCIDENT_SEED = [
  ['critical', 'open', 'fired_alerts', 'alert_fired', 'Uptime probe for status.example.com failed 3 times in 10 minutes'],
  ['critical', 'open', 'credential_audit_log', 'credential_decrypt_failure', 'Vault entry "stripe-live" could not be decrypted on this device'],
  ['high', 'open', 'tool_execution_audit_log', 'tool_error', 'The http_request tool returned 429 on 18 consecutive calls'],
  ['high', 'acknowledged', 'provider_audit_log', 'provider_failover', 'Anthropic provider failed over to the secondary route'],
  ['medium', 'open', 'healing_audit_log', 'healing_retry_exhausted', 'Self-healing gave up after 4 retries on the nightly digest'],
  ['medium', 'acknowledged', 'policy_events', 'policy_denied', 'A persona requested filesystem write outside its workspace'],
  ['low', 'resolved', 'persona_healing_issues', 'persona_blocker', 'Invoice Reconciler was blocked on a missing sheet credential'],
  ['medium', 'open', 'tool_execution_audit_log', 'tool_timeout', 'The web_search tool timed out after 30s on a long query'],
  ['high', 'open', 'fired_alerts', 'alert_fired', 'Daily spend crossed the $25 ceiling at 14:05'],
  ['low', 'dismissed', 'policy_events', 'policy_warned', 'A prompt mentioned a credential name in plain text'],
];

const INCIDENT_PERSONAS = ['p-monitor', 'p-finance', 'p-triage', 'p-review', 'p-research', 'p-release', null];

/**
 * @param {{ RECORDED_AT: string, PERSONAS: Array<Record<string, unknown>> }} ctx
 */
export function inboxTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

  // ── Approvals ───────────────────────────────────────────────────────────
  // Three workspaces, four teams, and one persona left outside every team.
  const TEAMS = [
    team('team-platform', 'Platform', 'ws-atlas', 'proj-atlas'),
    team('team-growth', 'Growth', 'ws-beacon', 'proj-beacon'),
    team('team-ops', 'Operations', 'ws-beacon', 'proj-beacon'),
    team('team-lab', 'Lab', 'ws-cinder', null),
  ];
  const HOME_TEAM = {
    'p-triage': 'team-platform',
    'p-review': 'team-platform',
    'p-release': 'team-growth',
    'p-research': 'team-lab',
    'p-finance': 'team-ops',
    // p-monitor keeps home_team_id null on purpose: the no-workspace case.
  };
  const REVIEW_PERSONAS = PERSONAS.map((p) => ({
    ...p,
    home_team_id: HOME_TEAM[p.id] ?? null,
  }));

  function team(id, name, workspaceId, projectId) {
    return {
      id,
      project_id: projectId,
      workspace_id: workspaceId,
      parent_team_id: null,
      name,
      description: null,
      canvas_data: null,
      team_config: null,
      icon: null,
      color: '#6B7280',
      enabled: true,
      shared_instructions: null,
      default_model_profile: null,
      default_max_budget_usd: null,
      created_at: ago(60 * 24 * 40),
      updated_at: ago(60 * 24 * 3),
    };
  }

  const reviews = REVIEW_ROWS.map(([m, personaId, severity, status, title, decisionCount], i) => ({
    id: `rev-${String(i + 1).padStart(3, '0')}`,
    execution_id: `exec-${String(i + 1).padStart(3, '0')}`,
    persona_id: personaId,
    title,
    description: 'The persona stopped here because the next step is irreversible. Its reasoning, the inputs it read and the options it weighed are below.',
    severity,
    context_data: decisionCount === 0 ? null : JSON.stringify({
      context_text: 'Each option below was scored against the brief; the persona declined to pick one on its own.',
      decisions: Array.from({ length: decisionCount }, (_, d) => ({
        id: `dec-${i + 1}-${d + 1}`,
        label: `Option ${String.fromCharCode(65 + d)}`,
        description: 'What this option does, and the one consequence that makes it a judgement call.',
        category: 'plan',
      })),
    }),
    suggested_actions: null,
    status,
    reviewer_notes: null,
    resolved_at: null,
    created_at: ago(m),
    updated_at: ago(m),
    use_case_id: null,
    assignment_id: null,
    step_id: null,
  }));

  const reviewCounts = {
    total: reviews.length + 14,
    pending: reviews.length,
    approved: 9,
    rejected: 4,
    resolved: 1,
  };

  const approvals = (moduleId) => ({
    version: 1,
    module: moduleId,
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note: 'Synthetic: 8 pending reviews across 6 personas; 5 personas sit in 3 workspaces (two share one) and Uptime Sentinel sits in none, so the queue shows both the workspace tint and the neutral default.',
    calls: [
      { cmd: 'list_personas', response: REVIEW_PERSONAS },
      { cmd: 'get_persona_summaries', response: [] },
      { cmd: 'list_teams', response: TEAMS },
      // An ARRAY, not an object: `teamSlice.fetchTeams` iterates this with
      // `for (const c of counts)`, and one `{}` here throws inside its try,
      // which silently leaves `teams` empty and every workspace unresolved.
      { cmd: 'get_team_counts', response: TEAMS.map((tm) => ({ team_id: tm.id, member_count: 0, connection_count: 0 })) },
      { cmd: 'get_manual_review_counts', response: reviewCounts },
      { cmd: 'list_manual_reviews_page', response: { rows: reviews, nextCursor: null, hasMore: false } },
      { cmd: 'list_manual_reviews', response: reviews },
      {
        cmd: 'dev_tools_triage_ideas',
        response: {
          ideas: [],
          cursor: null,
          hasMore: false,
          counts: { total: 0, pending: 0, accepted: 0, rejected: 0, archived: 0, byOrigin: {}, byCategory: {} },
        },
      },
    ],
  });

  // ── Incidents ───────────────────────────────────────────────────────────
  // Exactly DEFAULT_LIMIT rows, so `truncated` is true and the cap notice
  // renders. The seed repeats with a widening age so the ledger's age pills,
  // stale treatment and day spread all appear.
  const LIMIT = 100;
  const incidents = Array.from({ length: LIMIT }, (_, i) => {
    const [severity, status, sourceTable, kind, title] = INCIDENT_SEED[i % INCIDENT_SEED.length];
    const personaId = INCIDENT_PERSONAS[i % INCIDENT_PERSONAS.length];
    const persona = PERSONAS.find((p) => p.id === personaId);
    const minutes = 3 + i * 47;
    const closed = status === 'resolved' || status === 'dismissed';
    return {
      id: `inc-${String(i + 1).padStart(3, '0')}`,
      sourceTable,
      sourceId: `src-${String(i + 1).padStart(3, '0')}`,
      dedupKey: `${sourceTable}:src-${String(i + 1).padStart(3, '0')}`,
      personaId,
      personaName: persona?.name ?? null,
      executionId: i % 3 === 0 ? `exec-${String((i % 25) + 1).padStart(3, '0')}` : null,
      severity,
      kind,
      title: i < INCIDENT_SEED.length ? title : `${title} (#${i + 1})`,
      detail: 'The audit row this was promoted from, verbatim, plus whatever the promoter could resolve about the persona and execution around it.',
      status,
      acknowledgedAt: status === 'acknowledged' || closed ? ago(minutes - 2) : null,
      acknowledgedBy: status === 'acknowledged' || closed ? 'user' : null,
      resolvedAt: closed ? ago(minutes - 1) : null,
      resolutionNote: closed ? 'Closed after the source condition stopped reproducing.' : null,
      continuedAt: null,
      createdAt: ago(minutes),
    };
  });

  const openRows = incidents.filter((r) => r.status === 'open');
  const tally = (rows, key) => {
    const m = new Map();
    for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
    return [...m.entries()];
  };
  const summary = {
    open: openRows.length,
    acknowledged: incidents.filter((r) => r.status === 'acknowledged').length,
    resolved: incidents.filter((r) => r.status === 'resolved').length,
    dismissed: incidents.filter((r) => r.status === 'dismissed').length,
    openBySeverity: tally(openRows, 'severity'),
    openBySource: tally(openRows, 'sourceTable'),
  };

  const inbox = (moduleId) => ({
    version: 1,
    module: moduleId,
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note: `Synthetic: exactly ${LIMIT} incidents (= DEFAULT_LIMIT, so the cap notice renders) over ~3 months, all four statuses, all four severities, all seven source tables, one persona-less row per cycle.`,
    calls: [
      { cmd: 'list_personas', response: PERSONAS },
      { cmd: 'get_persona_summaries', response: [] },
      { cmd: 'list_audit_incidents', response: incidents },
      { cmd: 'get_audit_incidents_summary', response: summary },
      { cmd: 'list_autonomously_handled_incidents', response: incidents.filter((r) => r.status === 'resolved').slice(0, 6) },
    ],
  });

  // ── Decision Deck over the two inboxes (decision-center wave 3, C2) ──────
  // The same pages with the global deck opened from their own doors. The deck
  // reads the roster: PendingCounts for the chip numbers, plus each chip's
  // item sources (Approvals' gates queue = the reviews above + Athena's
  // companion approvals; Incidents' queue = the incidents above).
  const pendingCounts = {
    goalAcceptance: 0, manualReviews: reviews.length, ideas: 0, policyProposals: 0, promotionProposals: 0,
    openIncidents: openRows.length, blockingIncidents: openRows.filter((r) => r.severity === 'critical' || r.severity === 'high').length,
    unreadReports: 0, companionApprovals: 0, councilDecidable: 0, decisionTotal: 0, total: 0,
  };
  const deckCalls = [
    { cmd: 'dev_tools_pending_counts', response: pendingCounts },
    { cmd: 'companion_list_pending_approvals', response: [] },
    // The gates/proposals sources the roster's triage half reads alongside.
    { cmd: 'policy_tuning_list', response: [] },
    { cmd: 'evolution_list_promotion_proposals', response: [] },
    { cmd: 'dev_tools_list_pending_acceptance', response: [] },
    { cmd: 'dev_tools_undispatched_ideas', response: [] },
  ];
  const withDeck = (tape, moduleId, note) => ({ ...tape, module: moduleId, note, calls: [...tape.calls, ...deckCalls] });

  return {
    builders: {
      'overview/sub_manual-review': () => approvals('overview/sub_manual-review'),
      'overview/sub_incidents': () => inbox('overview/sub_incidents'),
      'overview/sub_manual-review/deck': () => withDeck(
        approvals('overview/sub_manual-review/deck'),
        'overview/sub_manual-review/deck',
        'Synthetic: the Approvals tape, with the Decision Deck opened by the pending view Decide N button on the gates chip.',
      ),
      'overview/sub_incidents/deck': () => withDeck(
        // The roster's gates half reads the pending-review page even when the
        // deck deals only incidents; an empty page keeps the report clean.
        { ...inbox('overview/sub_incidents/deck'), calls: [...inbox('overview/sub_incidents/deck').calls, { cmd: 'list_manual_reviews_page', response: { rows: [], nextCursor: null, hasMore: false } }] },
        'overview/sub_incidents/deck',
        'Synthetic: the Incidents tape, with the Decision Deck opened by clicking the first open incident row.',
      ),
    },
  };
}
