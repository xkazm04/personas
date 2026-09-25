// Synthetic tapes for kit batch home-1, the DEV Welcome tab (homeWelcomeSurfaces.tsx).
// Shapes follow the TS bindings (Persona, GlobalExecutionListItem, MetricsSummary,
// PaginatedEvents, AuditIncidentSummary, PersonaTeam, Credential). Fixture CODE, no
// personal data.

export function homeWelcomeTapes({ RECORDED_AT, PERSONAS, EVENTS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

  // [minutesAgo, persona, status]: 14 runs over the last day, 3 failed, the newest failure 40 min ago.
  const RUN_ROWS = [
    [4, 'p-triage', 'completed'], [18, 'p-review', 'completed'], [40, 'p-finance', 'failed'],
    [65, 'p-monitor', 'completed'], [90, 'p-triage', 'completed'], [140, 'p-release', 'completed'],
    [210, 'p-research', 'failed'], [300, 'p-monitor', 'completed'], [420, 'p-triage', 'completed'],
    [560, 'p-review', 'completed'], [700, 'p-monitor', 'failed'], [900, 'p-triage', 'completed'],
    [60 * 26, 'p-release', 'completed'], [60 * 30, 'p-monitor', 'completed'],
  ];
  const RUNS = RUN_ROWS.map(([m, personaId, status], i) => ({
    id: `exec-${String(i + 1).padStart(3, '0')}`, personaId, status, modelUsed: 'claude-sonnet-4-5', thinkingLevel: null,
    inputTokens: 4200, outputTokens: 900, costUsd: 0.02, durationMs: 41_000, startedAt: ago(m), createdAt: ago(m),
    personaName: null, personaIcon: null, personaColor: null,
  }));

  const METRICS = {
    totalExecutions: RUNS.length, successfulExecutions: 11, failedExecutions: 3, totalCostUsd: 0.28,
    activePersonas: 6, successRate: 78.6, periodDays: 1,
  };

  const ALERTS = [
    { id: 'al-1', rule_id: 'r-cost', rule_name: 'Daily cost over budget', metric: 'cost', value: 4.2, threshold: 3, severity: 'warning', message: 'Cost 4.20 over 3.00', fired_at: ago(120), dismissed: false, persona_id: null },
    { id: 'al-2', rule_id: 'r-fail', rule_name: 'Failure rate above 20%', metric: 'failure_rate', value: 0.21, threshold: 0.2, severity: 'critical', message: 'Failure rate 21%', fired_at: ago(400), dismissed: false, persona_id: 'p-monitor' },
  ];

  const TEAMS = ['Content Studio', 'Ops Watch', 'Finance Desk'].map((name, i) => ({
    id: `team-${i + 1}`, project_id: 'proj-harness', parent_team_id: null, name, description: null,
    canvas_data: null, team_config: null, icon: null, color: '#06b6d4', enabled: true,
    created_at: ago(60 * 24 * 20), updated_at: ago(60 * 24 * 2),
  }));

  const CREDENTIALS = [
    ['github', 'GitHub'], ['slack', 'Slack'], ['google_workspace', 'Google Workspace'], ['notion', 'Notion'],
    ['personas_messages', 'Messages'], ['local_drive', 'Local Drive'],
  ].map(([service_type, name], i) => ({
    id: `cred-${i + 1}`, name, service_type, metadata: null, healthcheck_last_success: true,
    healthcheck_last_message: null, healthcheck_last_tested_at: ago(60), healthcheck_last_success_at: ago(60),
    last_used_at: ago(30), created_at: ago(60 * 24 * 40), updated_at: ago(60 * 24),
  }));

  function tape(module, note, { personas = PERSONAS, runs = RUNS, runsError = false, alerts = ALERTS, approvals = 4 } = {}) {
    return {
      version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
      calls: [
        { cmd: 'list_personas', response: personas },
        { cmd: 'get_persona_summaries', response: [] },
        runsError
          ? { cmd: 'list_all_executions', error: 'database is locked' }
          : { cmd: 'list_all_executions', response: runs },
        { cmd: 'get_metrics_summary', response: METRICS },
        { cmd: 'list_events_in_range', response: { events: EVENTS, total: EVENTS.length, has_more: false } },
        { cmd: 'get_audit_incidents_summary', response: { open: 2, acknowledged: 0, in_progress: 1, openBySource: [['executions', 2]] } },
        { cmd: 'list_fired_alerts', response: alerts },
        { cmd: 'get_team_counts', response: TEAMS.map((t, i) => ({ team_id: t.id, member_count: 3 + i, connection_count: 2 + i })) },
        { cmd: 'companion_list_pending_approvals', response: [] },
        { cmd: 'get_pending_review_count', response: approvals },
        { cmd: 'list_teams', response: TEAMS },
        { cmd: 'list_credentials', response: CREDENTIALS },
      ],
    };
  }

  return {
    builders: {
      'home/welcome': () => tape('home/welcome', 'Synthetic: returning operator; 14 runs (3 failed) since a visit 14 h ago, 2 alerts, 4 approvals; resume = the newest failure.'),
      'home/welcome/first-run': () => tape('home/welcome/first-run', 'Synthetic: fresh profile, no personas, no runs, no last-seen anchor.', { personas: [], runs: [] }),
      'home/welcome/edit': () => tape('home/welcome/edit', 'Synthetic: the run list fails and nothing else happened, so the briefing says it could not derive; resume = the last edited agent.', { runsError: true, alerts: [], approvals: 0 }),
    },
  };
}
