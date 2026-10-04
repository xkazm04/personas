// Synthetic tapes for module 4, Overview > Observability
// (overview/sub_observability, mounted by observabilitySurfaces.tsx). Shapes
// follow the TS bindings (OverviewBundle, MetricsChartData, PersonaHealingIssue,
// HealingTimelineEvent, HealingAuditEntry, AlertRule, FiredAlert, AthenaHealth,
// AthenaSpendRow, ToolPerformanceSummary); bigint fields travel as JSON numbers,
// which every consumer Number()s. Fixture CODE, no personal data.
//
//   observability/dashboard  the main view: 30 days of metrics with one cost
//                            anomaly, 9 health issues in every state, Athena
//                            health and spend, tool performance
//   observability/alerts     the same page with the alert rules and history open
//   observability/charts     the Metrics card opened into cost, health and the persona split
//   observability/timeline   the health issues switched to the healing timeline
//   observability/issue      the first health issue opened in full
//   observability/select     the second health issue clicked

export function observabilityTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const isoAgo = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const day = (daysAgo) => new Date(T0 - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const H = 60;
  const D = 60 * 24;
  const pid = (i) => PERSONAS[i % PERSONAS.length].id;

  // 30 daily points, oldest first. A weekday rhythm, a slow cost climb and a
  // cost spike eight days ago (the anomaly below).
  const chartPoints = Array.from({ length: 30 }, (_, i) => {
    const ago = 29 - i;
    const weekend = [0, 6].includes(new Date(T0 - ago * 86_400_000).getUTCDay());
    const executions = (weekend ? 22 : 58) + ((i * 7) % 13);
    const failed = [3, 5, 1, 7, 2, 4, 0, 6][i % 8] + (ago === 8 ? 9 : 0);
    const cost = Number(((executions * 0.021) + i * 0.018 + (ago === 8 ? 2.6 : 0)).toFixed(2));
    return {
      date: day(ago), cost, executions, success: executions - failed, failed,
      tokens: executions * 11_400, active_personas: weekend ? 3 : 5 + (i % 2),
    };
  });
  const totals = chartPoints.reduce((a, p) => ({
    executions: a.executions + p.executions, success: a.success + p.success, failed: a.failed + p.failed, cost: a.cost + p.cost,
  }), { executions: 0, success: 0, failed: 0, cost: 0 });

  const bundle = {
    metricsSummary: {
      totalExecutions: totals.executions, successfulExecutions: totals.success, failedExecutions: totals.failed,
      totalCostUsd: Number(totals.cost.toFixed(2)), activePersonas: 6, periodDays: 30,
    },
    metricsChartData: {
      chart_points: chartPoints,
      persona_breakdown: [
        { persona_id: pid(0), executions: 512, cost: 9.84 },
        { persona_id: pid(2), executions: 377, cost: 4.1 },
        { persona_id: pid(4), executions: 241, cost: 6.72 },
        { persona_id: pid(1), executions: 158, cost: 3.05 },
        { persona_id: pid(5), executions: 96, cost: 2.4 },
        { persona_id: pid(3), executions: 41, cost: 5.9 },
      ],
      anomalies: [
        { date: day(8), metric: 'cost', value: chartPoints[21].cost, baseline: 1.42, deviation_pct: 187.4, execution_id: 'exec-spike-1' },
      ],
    },
    monthlySpend: { periodStartUtc: '2026-09-01T00:00:00.000Z', items: [] },
  };

  function issue(id, persona, minutesAgo, fields) {
    return {
      id, persona_id: persona, execution_id: null, title: '', description: '', is_circuit_breaker: false,
      severity: 'medium', category: 'timeout', suggested_fix: null, auto_fixed: false, status: 'open',
      created_at: isoAgo(minutesAgo), resolved_at: null, source: null, ...fields,
    };
  }

  const ISSUES = [
    issue('hi-1', pid(5), 40, {
      title: 'Invoice Reconciler paused after 5 consecutive budget failures', severity: 'critical', category: 'budget',
      is_circuit_breaker: true, description: 'Five runs in a row stopped at the budget cap before the reconciliation finished.',
      suggested_fix: 'Raise the per-run budget to $0.80 or split the reconciliation by month.',
    }),
    issue('hi-2', pid(2), 95, {
      title: 'Status page probe times out on the EU endpoint', severity: 'high', category: 'timeout', status: 'auto_fix_pending',
      execution_id: 'exec-retry-2', description: 'The probe waited 30s for https://status.example.com/eu and gave up.',
      suggested_fix: 'Raise the probe timeout to 45s and retry once with backoff.',
    }),
    issue('hi-3', pid(0), 3 * H, {
      title: 'Gmail connector token expired during triage', severity: 'high', category: 'credential', source: 'oauth',
      description: 'The OAuth refresh token was revoked; every mailbox read returns 401.',
    }),
    issue('hi-4', pid(4), 5 * H, {
      title: 'Review comments exceed the model context on large diffs', severity: 'medium', category: 'context',
      description: 'Diffs above 180k tokens are truncated, so the review misses files at the end.',
      suggested_fix: 'Chunk the diff per file and summarise before the review pass.', source: 'director',
    }),
    issue('hi-5', pid(2), 9 * H, {
      title: 'Uptime check retried the same endpoint three times', severity: 'medium', category: 'timeout', auto_fixed: true,
      status: 'resolved', execution_id: 'exec-retry-5', resolved_at: isoAgo(8 * H),
      description: 'A transient 503 cleared on the third attempt.',
    }),
    issue('hi-6', pid(1), 26 * H, {
      title: 'Release notes draft missing the changelog section', severity: 'low', category: 'output',
      description: 'The draft ended before the Changelog heading on two runs.',
    }),
    issue('hi-7', pid(3), 2 * D + 4 * H, {
      title: 'Market research run hit the rate limit on the search tool', severity: 'medium', category: 'rate_limit',
      auto_fixed: true, status: 'resolved', execution_id: 'exec-retry-7', resolved_at: isoAgo(2 * D),
      description: 'The search tool returned 429 after 40 queries in a minute.',
    }),
    issue('hi-8', pid(0), 4 * D, {
      title: 'Triage run exceeded its 5 minute timeout', severity: 'low', category: 'timeout',
      description: 'A mailbox with 900 unread threads took 6m 12s.',
    }),
    issue('hi-9', pid(4), 10 * D, {
      title: 'Code review could not parse the model response', severity: 'medium', category: 'parse', status: 'resolved',
      resolved_at: isoAgo(9 * D), description: 'The response ended mid-JSON.',
    }),
  ];

  function ev(id, chainId, type, minutesAgo, title, fields = {}) {
    return {
      id, chainId, eventType: type, timestamp: isoAgo(minutesAgo), title, description: fields.description ?? title,
      severity: null, category: null, status: null, executionId: chainId, issueId: null, knowledgeId: null,
      autoFixed: false, isCircuitBreaker: false, retryCount: null, suggestedFix: null, ...fields,
    };
  }

  const TIMELINE = [
    ev('t-1a', 'c-budget', 'trigger', 40, ISSUES[0].title, { severity: 'critical', category: 'budget', issueId: 'hi-1', isCircuitBreaker: true }),
    ev('t-1b', 'c-budget', 'classify', 39, 'Classified as a budget failure', { category: 'budget' }),
    ev('t-1c', 'c-budget', 'outcome', 38, 'Persona paused by the circuit breaker', { status: 'failed' }),
    ev('t-2a', 'c-probe', 'trigger', 95, ISSUES[1].title, { severity: 'high', category: 'timeout', issueId: 'hi-2' }),
    ev('t-2b', 'c-probe', 'classify', 94, 'Classified as a transient timeout', { category: 'timeout' }),
    ev('t-2c', 'c-probe', 'retry', 93, 'Retry with a 45s timeout', { status: 'running', retryCount: 1 }),
    ev('t-3a', 'c-uptime', 'trigger', 9 * H, ISSUES[4].title, { severity: 'medium', category: 'timeout', issueId: 'hi-5' }),
    ev('t-3b', 'c-uptime', 'retry', 9 * H - 2, 'Retry 1 returned 503', { status: 'failed', retryCount: 1 }),
    ev('t-3c', 'c-uptime', 'retry', 9 * H - 4, 'Retry 2 succeeded', { status: 'completed', retryCount: 2 }),
    ev('t-3d', 'c-uptime', 'outcome', 9 * H - 5, 'Healed by retry', { status: 'resolved', autoFixed: true }),
    ev('t-4a', 'c-review', 'trigger', 5 * H, ISSUES[3].title, { severity: 'medium', category: 'context', issueId: 'hi-4' }),
    ev('t-4b', 'c-review', 'ai_heal', 5 * H - 3, 'Suggested chunking the diff per file', { suggestedFix: ISSUES[3].suggested_fix }),
    ev('t-k1', 'k-1', 'knowledge', 3 * D, 'Status probes on EU endpoints need 45s', { knowledgeId: 'kn-1', description: 'Learned from 4 healed timeouts.' }),
    ev('t-k2', 'k-2', 'knowledge', 6 * D, 'Search tool allows 30 queries a minute', { knowledgeId: 'kn-2', description: 'Learned from 2 rate-limit retries.' }),
  ];

  const AUDIT = [
    { id: 'au-1', personaId: pid(4), executionId: 'exec-a1', eventType: 'ai_heal_parse_failed', subsystem: 'ai_healing', message: 'The fix proposal was not valid JSON', detail: 'Unexpected end of input at 412', createdAt: isoAgo(6 * H) },
    { id: 'au-2', personaId: pid(2), executionId: null, eventType: 'dedup_skipped', subsystem: 'healing_analysis', message: 'Duplicate timeout issue skipped', detail: null, createdAt: isoAgo(11 * H) },
    { id: 'au-3', personaId: null, executionId: null, eventType: 'knowledge_persist_error', subsystem: 'knowledge_extraction', message: 'Knowledge row not written: database busy', detail: 'SQLITE_BUSY after 3 attempts', createdAt: isoAgo(2 * D) },
  ];

  const rule = (id, name, metric, operator, threshold, severity, persona, enabled) => ({
    id, name, metric, operator, threshold, severity, persona_id: persona, enabled,
    created_at: isoAgo(20 * D), updated_at: isoAgo(3 * D),
  });
  const RULES = [
    rule('ar-1', 'Error rate above 10%', 'error_rate', '>', 10, 'critical', null, true),
    rule('ar-2', 'Daily cost spike', 'cost_spike', '>', 150, 'warning', null, true),
    rule('ar-3', 'Uptime Sentinel success below 95%', 'success_rate', '<', 95, 'warning', pid(2), true),
    rule('ar-4', 'Execution volume under 10 a day', 'executions', '<', 10, 'info', null, false),
  ];
  const fired = (id, r, minutesAgo, message, value, dismissed) => ({
    id, rule_id: r.id, rule_name: r.name, metric: r.metric, severity: r.severity, message, value, threshold: r.threshold,
    persona_id: r.persona_id, fired_at: isoAgo(minutesAgo), dismissed,
  });
  const FIRED = [
    fired('fa-1', RULES[1], 8 * D, 'Cost reached 287% of the 7-day baseline', 287, false),
    fired('fa-2', RULES[2], 95, 'Uptime Sentinel succeeded on 91.2% of runs', 91.2, false),
    fired('fa-3', RULES[0], 3 * D, 'Error rate reached 12.4%', 12.4, true),
  ];

  const HEALTH = {
    triage: { passes: 412, parseFailures: 3, drop: 268, digest: 97, attention: 38, deepDive: 9 },
    proactive: { delivered: 64, engaged: 29, dismissed: 22, expired: 13, budgetUsedToday: 4, budgetCap: 12 },
    jobs: { completed: 188, failed: 6 },
    errors: 5,
    turns: 1_204,
  };
  const SPEND = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
    { day: day(d), origin: 'chat', ledger: 'turn', costUsd: Number((0.42 + d * 0.07).toFixed(2)), turnCount: 38 - d * 3 },
    ...(d % 2 === 0 ? [{ day: day(d), origin: 'headless', ledger: 'turn', costUsd: Number((0.18 + d * 0.02).toFixed(2)), turnCount: 61 - d * 4 }] : []),
  ]);

  const TOOLS = [
    { tool_name: 'http_request', tool_type: 'builtin', total_runs: 1_842, error_runs: 37, avg_duration_ms: 412.6, max_duration_ms: 30_004 },
    { tool_name: 'gmail_search', tool_type: 'connector', total_runs: 961, error_runs: 58, avg_duration_ms: 780.1, max_duration_ms: 9_120 },
    { tool_name: 'web_search', tool_type: 'mcp', total_runs: 604, error_runs: 21, avg_duration_ms: 1_390.4, max_duration_ms: 12_870 },
    { tool_name: 'read_file', tool_type: 'builtin', total_runs: 588, error_runs: 0, avg_duration_ms: 14.2, max_duration_ms: 210 },
    { tool_name: 'github_pr_diff', tool_type: 'connector', total_runs: 233, error_runs: 4, avg_duration_ms: 2_210.9, max_duration_ms: 18_400 },
    { tool_name: 'slack_post', tool_type: 'connector', total_runs: 120, error_runs: 11, avg_duration_ms: 356.0, max_duration_ms: 4_100 },
  ];

  const calls = [
    { cmd: 'list_personas', response: PERSONAS },
    { cmd: 'get_persona_summaries', response: [] },
    { cmd: 'list_credentials', response: [] },
    { cmd: 'get_overview_bundle', response: bundle },
    { cmd: 'list_healing_issues', response: ISSUES },
    { cmd: 'get_healing_timeline', response: TIMELINE },
    { cmd: 'list_healing_audit_log', response: AUDIT },
    { cmd: 'list_alert_rules', response: RULES },
    { cmd: 'list_fired_alerts', response: FIRED },
    { cmd: 'companion_get_health', response: HEALTH },
    { cmd: 'companion_get_spend_rollup', response: SPEND },
    { cmd: 'get_tool_performance_summary', response: TOOLS },
    { cmd: 'get_prompt_versions_bulk', response: {} },
    { cmd: 'get_rotation_history_bulk', response: {} },
    // evaluateAlertRules persists what it fires; the page does not read the answer.
    { cmd: 'create_fired_alert', response: null },
  ];
  const base = (module, note) => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls });

  return {
    builders: {
      'observability/dashboard': () => base('observability/dashboard', 'Synthetic: 30 days of metrics with one cost anomaly, 9 health issues in every state, Athena health and spend, 6 tools.'),
      'observability/alerts': () => base('observability/alerts', 'Synthetic: the dashboard tape, alert rules and history open.'),
      'observability/charts': () => base('observability/charts', 'Synthetic: the dashboard tape, the Metrics card opened into its charts and the per-persona split.'),
      'observability/timeline': () => base('observability/timeline', 'Synthetic: the dashboard tape, health issues on the healing timeline (4 chains, 2 knowledge patterns).'),
      'observability/issue': () => base('observability/issue', 'Synthetic: the dashboard tape, first health issue opened in full.'),
      'observability/select': () => base('observability/select', 'Synthetic: the dashboard tape, second health issue clicked.'),
    },
  };
}
