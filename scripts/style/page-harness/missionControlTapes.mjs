// Synthetic IPC tape for Overview > Mission Control (`overview/sub_missionControl`,
// mounted by missionControlSurfaces.tsx). The page itself fetches almost
// nothing: it reads the overview store, which the route's pipeline
// (hooks/overview/useExecutionDashboardPipeline) fills before the page mounts.
// The harness's `prepare` drives that same pipeline, so every number below
// arrives through the store exactly as it does in the app — plus the handful of
// commands the page's own children self-fetch (status monitor, leaderboard,
// heatmap, healing ledger, routines, vault, attention loop).
//
// Shapes follow the TS bindings: Persona, GlobalExecutionListItem,
// ExecutionCounts, ExecutionDashboardData (DashboardDailyPoint /
// DashboardTopPersona / DashboardCostAnomaly / PersonaCostEntry), OverviewBundle
// (MetricsSummary / MetricsChartData / MonthlySpendResult), PersonaHealingIssue,
// AlertRule, FiredAlert, SlaDashboardData (PersonaSlaStats / GlobalSlaStats /
// HealingSummary / SlaDailyPoint), HealthBundle (PersonaMonthlySpend /
// PersonaReliability / PersonaDailyReliability / ProviderUsageStats /
// HealthBundleErrors), ExecutionHeatmapData (HeatmapDay / HeatmapInsights),
// HealingEffectivenessReport (HealingStrategyStat), HealingAuditEntry,
// PersonaTrigger, CredentialAuditEntry, AttentionLoopStatus
// (AttentionLoopSummary / AttentionLedgerEntry). `bigint` fields travel as JSON
// numbers, which every consumer Number()s. Fixture CODE, no personal data.
//
//   overview/sub_missionControl  the whole dashboard: 6 personas, 40 executions
//                                over 30 days in six statuses, a 30-day daily
//                                series with one cost anomaly, per-persona SLA
//                                and reliability (so the status monitor grades
//                                and the leaderboard ranks), a 365-day heatmap,
//                                the healing-effectiveness ledger, 6 scheduled
//                                routines, 10 vault audit rows and a live
//                                attention loop.

export function missionControlTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const isoAgo = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const isoIn = (minutes) => new Date(T0 + minutes * 60_000).toISOString();
  const day = (daysAgo) => new Date(T0 - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const H = 60;
  const D = 60 * 24;
  const p = (i) => PERSONAS[i % PERSONAS.length];
  const round = (n, d = 2) => Number(n.toFixed(d));

  // ── Executions ───────────────────────────────────────────────────────────
  // 40 rows across six statuses and all six personas, newest first (the order
  // `list_all_executions` returns). 26 completed / 40 => the success ring reads
  // 65%, a measured number rather than a flattering 100.
  // [status, repeats] laid out so failures cluster the way real ones do.
  const STATUS_CYCLE = [
    'completed', 'completed', 'failed', 'completed', 'running',
    'completed', 'completed', 'completed', 'cancelled', 'completed',
    'completed', 'failed', 'completed', 'completed', 'completed',
    'incomplete', 'completed', 'completed', 'failed', 'completed',
    'completed', 'completed', 'pending', 'completed', 'failed',
    'completed', 'completed', 'completed', 'running', 'completed',
    'completed', 'failed', 'completed', 'cancelled', 'completed',
    'completed', 'incomplete', 'completed', 'failed', 'pending',
  ];
  const MODELS = [
    ['claude-opus-5', 'high'],
    ['claude-sonnet-4-6', 'medium'],
    ['gpt-5.2', null],
    ['claude-haiku-4-5', 'low'],
  ];
  const EXECUTIONS = STATUS_CYCLE.map((status, i) => {
    const persona = p(i % 6 === 5 ? 5 : (i * 3) % 6);
    const [modelUsed, thinkingLevel] = MODELS[i % MODELS.length];
    // Spread over the whole 30-day window, densest in the last two days.
    const minutesAgo = i < 8 ? 4 + i * 23 : Math.round(((i - 7) ** 1.7) * 48);
    const terminal = status !== 'running' && status !== 'pending';
    const inputTokens = 1_800 + ((i * 617) % 9_400);
    const outputTokens = 420 + ((i * 271) % 2_600);
    return {
      id: `mc-exec-${String(i + 1).padStart(3, '0')}`,
      personaId: persona.id,
      status,
      modelUsed,
      thinkingLevel,
      inputTokens,
      outputTokens,
      // An unrecorded cost stays absent rather than becoming a measured $0
      // (census rule `unknown-money-as-zero`) — two rows exercise that path.
      costUsd: i === 12 || i === 29 ? null : round((inputTokens * 0.000003) + (outputTokens * 0.000015) + 0.004, 4),
      durationMs: terminal ? 2_400 + ((i * 1_931) % 46_000) : null,
      startedAt: isoAgo(minutesAgo + 1),
      createdAt: isoAgo(minutesAgo),
      personaName: persona.name,
      personaIcon: persona.icon,
      personaColor: persona.color,
    };
  });

  // The authoritative server-side totals — deliberately much larger than the
  // 40 loaded rows, which is the real relationship (the list is one page).
  // Every bucket sums to `total`, the invariant `count_all_global` asserts.
  const COUNTS = { total: 1_284, running: 3, completed: 1_102, failed: 131, cancelled: 34, incomplete: 14 };

  // ── 30 daily points ──────────────────────────────────────────────────────
  // A weekday rhythm, a slow cost climb, and a cost spike YESTERDAY. The day
  // matters: `generateFleetRecommendation` only treats an anomaly as a live
  // critical inside `ANOMALY_RECENCY_DAYS` (3), so an older spike leaves the
  // fleet card on its "running smoothly" insight instead of the attributed
  // cost-spike recommendation the card is really for.
  const PERSONA_WEIGHTS = [0.27, 0.11, 0.24, 0.07, 0.19, 0.12];
  const DAILY_POINTS = Array.from({ length: 30 }, (_, i) => {
    const ago = 29 - i;
    const date = day(ago);
    const weekend = [0, 6].includes(new Date(T0 - ago * 86_400_000).getUTCDay());
    const total = (weekend ? 21 : 54) + ((i * 7) % 13);
    const failed = [3, 5, 1, 7, 2, 4, 0, 6][i % 8] + (ago === 1 ? 8 : 0);
    const completed = total - failed;
    const cost = round((total * 0.0215) + i * 0.017 + (ago === 1 ? 2.4 : 0));
    return {
      date,
      total_cost: cost,
      total_executions: total,
      completed,
      failed,
      success_rate: round(completed / total, 4),
      p50_duration_ms: 3_100 + ((i * 97) % 900),
      p95_duration_ms: 17_400 + ((i * 311) % 6_000),
      p99_duration_ms: 31_900 + ((i * 523) % 11_000),
      total_tokens: total * 11_400,
      persona_costs: PERSONAS.map((persona, k) => ({
        persona_id: persona.id,
        persona_name: persona.name,
        cost: round(cost * PERSONA_WEIGHTS[k], 4),
      })),
    };
  });
  const DAILY_TOTALS = DAILY_POINTS.reduce((a, d) => ({
    executions: a.executions + d.total_executions,
    completed: a.completed + d.completed,
    failed: a.failed + d.failed,
    cost: a.cost + d.total_cost,
  }), { executions: 0, completed: 0, failed: 0, cost: 0 });

  const TOP_PERSONAS = PERSONAS.map((persona, k) => {
    const total_executions = Math.round(DAILY_TOTALS.executions * PERSONA_WEIGHTS[k]);
    const total_cost = round(DAILY_TOTALS.cost * PERSONA_WEIGHTS[k]);
    return {
      persona_id: persona.id,
      persona_name: persona.name,
      total_cost,
      total_executions,
      avg_cost_per_exec: round(total_cost / total_executions, 4),
    };
  }).sort((a, b) => b.total_cost - a.total_cost);

  const SPIKE = DAILY_POINTS.find((d) => d.date === day(1));
  const EXECUTION_DASHBOARD = {
    daily_points: DAILY_POINTS,
    top_personas: TOP_PERSONAS,
    cost_anomalies: [{
      date: day(1),
      cost: SPIKE.total_cost,
      moving_avg: 1.42,
      std_dev: 0.31,
      deviation_sigma: 4.9,
      execution_ids: ['mc-exec-018', 'mc-exec-019', 'mc-exec-021'],
    }],
    total_executions: DAILY_TOTALS.executions,
    successful_executions: DAILY_TOTALS.completed,
    failed_executions: DAILY_TOTALS.failed,
    total_cost: round(DAILY_TOTALS.cost),
    overall_success_rate: round(DAILY_TOTALS.completed / DAILY_TOTALS.executions, 4),
    avg_latency_ms: 8_640,
    active_personas: 6,
    projected_monthly_cost: round(DAILY_TOTALS.cost / 30 * 30),
    burn_rate: round(DAILY_TOTALS.cost / 30, 3),
  };

  // ── The observability bundle (wave 2) ────────────────────────────────────
  const CHART_POINTS = DAILY_POINTS.map((d, i) => ({
    date: d.date,
    cost: d.total_cost,
    executions: d.total_executions,
    success: d.completed,
    failed: d.failed,
    tokens: d.total_tokens,
    active_personas: [0, 6].includes(new Date(T0 - (29 - i) * 86_400_000).getUTCDay()) ? 3 : 5 + (i % 2),
  }));
  const MONTHLY_SPEND_ITEMS = PERSONAS.map((persona, k) => ({
    id: persona.id,
    name: persona.name,
    spend: round(DAILY_TOTALS.cost * PERSONA_WEIGHTS[k] * 1.4),
    max_budget_usd: [12, null, 8, 4, 15, 6][k],
  }));
  const OVERVIEW_BUNDLE = {
    metricsSummary: {
      totalExecutions: DAILY_TOTALS.executions,
      successfulExecutions: DAILY_TOTALS.completed,
      failedExecutions: DAILY_TOTALS.failed,
      totalCostUsd: round(DAILY_TOTALS.cost),
      activePersonas: 6,
      periodDays: 30,
    },
    metricsChartData: {
      chart_points: CHART_POINTS,
      persona_breakdown: PERSONAS.map((persona, k) => ({
        persona_id: persona.id,
        executions: Math.round(DAILY_TOTALS.executions * PERSONA_WEIGHTS[k]),
        cost: round(DAILY_TOTALS.cost * PERSONA_WEIGHTS[k]),
      })),
      anomalies: [{
        date: day(1),
        metric: 'cost',
        value: SPIKE.total_cost,
        baseline: 1.42,
        deviation_pct: 187.4,
        execution_id: 'mc-exec-018',
      }],
    },
    monthlySpend: { periodStartUtc: '2026-09-01T00:00:00.000Z', items: MONTHLY_SPEND_ITEMS },
  };

  // ── Healing issues ───────────────────────────────────────────────────────
  function issue(id, personaId, minutesAgo, fields) {
    return {
      id, persona_id: personaId, execution_id: null, title: '', description: '',
      is_circuit_breaker: false, severity: 'medium', category: 'timeout', suggested_fix: null,
      auto_fixed: false, status: 'open', created_at: isoAgo(minutesAgo), resolved_at: null,
      source: null, ...fields,
    };
  }
  const HEALING_ISSUES = [
    issue('mc-hi-1', p(5).id, 40, {
      title: 'Invoice Reconciler paused after 5 consecutive budget failures',
      severity: 'critical', category: 'budget', is_circuit_breaker: true,
      description: 'Five runs in a row stopped at the budget cap before the reconciliation finished.',
      suggested_fix: 'Raise the per-run budget to $0.80 or split the reconciliation by month.',
    }),
    issue('mc-hi-2', p(2).id, 95, {
      title: 'Status page probe times out on the EU endpoint',
      severity: 'high', category: 'timeout', status: 'auto_fix_pending', execution_id: 'mc-exec-004',
      description: 'The probe waited 30s for https://status.example.com/eu and gave up.',
      suggested_fix: 'Raise the probe timeout to 45s and retry once with backoff.',
    }),
    issue('mc-hi-3', p(0).id, 3 * H, {
      title: 'Gmail connector token expired during triage',
      severity: 'high', category: 'credential', source: 'oauth',
      description: 'The OAuth refresh token was revoked; every mailbox read returns 401.',
    }),
    issue('mc-hi-4', p(4).id, 5 * H, {
      title: 'Review comments exceed the model context on large diffs',
      severity: 'medium', category: 'context', source: 'director',
      description: 'Diffs above 180k tokens are truncated, so the review misses files at the end.',
      suggested_fix: 'Chunk the diff per file and summarise before the review pass.',
    }),
    issue('mc-hi-5', p(2).id, 9 * H, {
      title: 'Uptime check retried the same endpoint three times',
      severity: 'medium', category: 'timeout', auto_fixed: true, status: 'resolved',
      execution_id: 'mc-exec-011', resolved_at: isoAgo(8 * H),
      description: 'A transient 503 cleared on the third attempt.',
    }),
    issue('mc-hi-6', p(1).id, 26 * H, {
      title: 'Release notes draft missing the changelog section',
      severity: 'low', category: 'output',
      description: 'The draft ended before the Changelog heading on two runs.',
    }),
    issue('mc-hi-7', p(3).id, 2 * D + 4 * H, {
      title: 'Market research run hit the rate limit on the search tool',
      severity: 'medium', category: 'rate_limit', auto_fixed: true, status: 'resolved',
      resolved_at: isoAgo(2 * D), description: 'The search tool returned 429 after 40 queries in a minute.',
    }),
    issue('mc-hi-8', p(0).id, 4 * D, {
      title: 'Triage run exceeded its 5 minute timeout',
      severity: 'low', category: 'timeout', description: 'A mailbox with 900 unread threads took 6m 12s.',
    }),
  ];

  // ── Alerts ───────────────────────────────────────────────────────────────
  const rule = (id, name, metric, operator, threshold, severity, personaId, enabled) => ({
    id, name, metric, operator, threshold, severity, persona_id: personaId, enabled,
    created_at: isoAgo(20 * D), updated_at: isoAgo(3 * D),
  });
  const ALERT_RULES = [
    rule('mc-ar-1', 'Error rate above 10%', 'error_rate', '>', 10, 'critical', null, true),
    rule('mc-ar-2', 'Daily cost spike', 'cost_spike', '>', 150, 'warning', null, true),
    rule('mc-ar-3', 'Uptime Sentinel success below 95%', 'success_rate', '<', 95, 'warning', p(2).id, true),
    rule('mc-ar-4', 'Execution volume under 10 a day', 'executions', '<', 10, 'info', null, false),
  ];
  const fired = (id, r, minutesAgo, message, value, dismissed) => ({
    id, rule_id: r.id, rule_name: r.name, metric: r.metric, severity: r.severity, message,
    value, threshold: r.threshold, persona_id: r.persona_id, fired_at: isoAgo(minutesAgo), dismissed,
  });
  // Two undismissed → the Vitals alert tile reads 2 (useAttention active_alerts).
  const FIRED_ALERTS = [
    fired('mc-fa-1', ALERT_RULES[1], 1 * D, 'Cost reached 287% of the 7-day baseline', 287, false),
    fired('mc-fa-2', ALERT_RULES[2], 95, 'Uptime Sentinel succeeded on 91.2% of runs', 91.2, false),
    fired('mc-fa-3', ALERT_RULES[0], 3 * D, 'Error rate reached 12.4%', 12.4, true),
  ];

  // ── SLA dashboard (the status monitor's per-persona grades) ──────────────
  // Deliberately uneven: one critical, one degraded, four healthy, so the
  // monitor's worst-first ordering and every grade chip has a row to draw.
  // [personaIndex, decided, successRate, avgMs, p95Ms, consecutiveFailures]
  const SLA_ROWS = [
    [0, 318, 0.948, 7_400, 19_800, 0],
    [1, 112, 0.982, 5_200, 12_400, 0],
    [2, 287, 0.861, 9_100, 28_600, 2],
    [3, 64, 0.766, 14_800, 46_200, 4],
    [4, 221, 0.958, 6_300, 15_900, 0],
    [5, 143, 0.643, 11_700, 38_400, 7],
  ];
  const PERSONA_SLA = SLA_ROWS.map(([k, decided, rate, avgMs, p95Ms, streak]) => {
    const successful = Math.round(decided * rate);
    const failed = decided - successful;
    return {
      persona_id: p(k).id,
      persona_name: p(k).name,
      total_executions: decided + 4,
      successful,
      failed,
      cancelled: 4,
      success_rate: rate,
      avg_duration_ms: avgMs,
      p95_duration_ms: p95Ms,
      total_cost_usd: round(DAILY_TOTALS.cost * PERSONA_WEIGHTS[k]),
      mtbf_seconds: failed >= 2 ? Math.round(30 * 86_400 / failed) : null,
      consecutive_failures: streak,
      consecutive_failure_lookback: 20,
      auto_healed_count: [1, 0, 3, 1, 0, 2][k],
    };
  }).sort((a, b) => b.total_executions - a.total_executions);
  const SLA_GLOBAL = PERSONA_SLA.reduce((a, r) => ({
    total_executions: a.total_executions + r.total_executions,
    successful: a.successful + r.successful,
    failed: a.failed + r.failed,
    cancelled: a.cancelled + r.cancelled,
    total_cost_usd: round(a.total_cost_usd + r.total_cost_usd),
  }), { total_executions: 0, successful: 0, failed: 0, cancelled: 0, total_cost_usd: 0 });
  const SLA_DASHBOARD = {
    persona_stats: PERSONA_SLA,
    global: {
      ...SLA_GLOBAL,
      success_rate: round(SLA_GLOBAL.successful / (SLA_GLOBAL.successful + SLA_GLOBAL.failed), 4),
      avg_duration_ms: 8_640,
      active_persona_count: 6,
    },
    healing_summary: { open_issues: 6, auto_fixed_count: 7, circuit_breaker_count: 1, knowledge_patterns: 4 },
    daily_trend: DAILY_POINTS.map((d) => ({
      date: d.date,
      total: d.total_executions + 1,
      successful: d.completed,
      failed: d.failed,
      cancelled: 1,
      success_rate: d.success_rate,
    })),
  };

  // ── Health bundle (the leaderboard's heartbeat signals) ─────────────────
  const PERSONA_RELIABILITY = SLA_ROWS.map(([k, decided, rate, avgMs]) => ({
    persona_id: p(k).id,
    total_decided: decided,
    success_rate: rate,
    avg_duration_ms: avgMs,
  }));
  // 14 days of per-persona success series: the failure-trend regression needs a
  // real per-persona series or every row renders the same prediction.
  const PERSONA_DAILY = SLA_ROWS.flatMap(([k, , rate]) =>
    Array.from({ length: 14 }, (_, j) => {
      const ago = 13 - j;
      // A gentle per-persona drift so no two personas trend identically.
      const drift = ((k % 3) - 1) * 0.004 * (13 - ago);
      const r = Math.min(1, Math.max(0, rate + drift + (((k + j) % 5) - 2) * 0.012));
      return { persona_id: p(k).id, date: day(ago), success_rate: round(r, 4), decided: 6 + ((k * 3 + j) % 11) };
    }),
  );
  const PROVIDER_STATS = [
    { engine_kind: 'claude_cli', execution_count: 712, total_cost_usd: 18.42, avg_duration_ms: 8_120, failover_count: 3 },
    { engine_kind: 'openai_api', execution_count: 341, total_cost_usd: 9.87, avg_duration_ms: 6_440, failover_count: 1 },
    { engine_kind: 'local_llm', execution_count: 96, total_cost_usd: 0, avg_duration_ms: 14_900, failover_count: 0 },
  ];
  const HEALTH_BUNDLE = {
    monthlySpend: { periodStartUtc: '2026-09-01T00:00:00.000Z', items: MONTHLY_SPEND_ITEMS },
    healingIssues: HEALING_ISSUES,
    byomPolicy: null,
    providerStats: PROVIDER_STATS,
    personaStats: PERSONA_RELIABILITY,
    personaDaily: PERSONA_DAILY,
    // Every source clean: a `Some(reason)` here would send the health pipeline
    // down its per-source retry path and raise a staleness banner.
    errors: {
      monthlySpend: null, healingIssues: null, byomPolicy: null,
      providerStats: null, personaStats: null, personaDaily: null,
    },
  };

  // ── 365-day heatmap ─────────────────────────────────────────────────────
  // Sparse before the last 60 days, dense inside it, with a dormant gap so the
  // insight row has a streak, a peak and a week-over-week delta to report.
  const HEATMAP_DAYS = [];
  for (let ago = 364; ago >= 0; ago--) {
    const dow = new Date(T0 - ago * 86_400_000).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const dormant = ago >= 96 && ago <= 110;
    const base = ago > 180 ? 0 : ago > 60 ? (weekend ? 0 : 3) : (weekend ? 2 : 9);
    const count = dormant ? 0 : Math.max(0, base + ((ago * 7) % 5) - 2);
    if (count === 0) continue;
    HEATMAP_DAYS.push({ date: day(ago), count, cost: round(count * 0.0218, 4) });
  }
  const HEATMAP_TOTAL = HEATMAP_DAYS.reduce((s, d) => s + d.count, 0);
  const HEATMAP_PEAK = HEATMAP_DAYS.reduce((a, b) => (b.count > a.count ? b : a), HEATMAP_DAYS[0]);
  const inWindow = (from, to) => HEATMAP_DAYS
    .filter((d) => { const ago = Math.round((T0 - Date.parse(`${d.date}T00:00:00.000Z`)) / 86_400_000); return ago >= from && ago <= to; })
    .reduce((s, d) => s + d.count, 0);
  const THIS_WEEK = inWindow(0, 6);
  const PREV_WEEK = inWindow(7, 13);
  const HEATMAP = {
    days: HEATMAP_DAYS,
    insights: {
      longest_streak_days: 31,
      dormant_days: 0,
      peak_day_date: HEATMAP_PEAK.date,
      peak_day_count: HEATMAP_PEAK.count,
      current_week_executions: THIS_WEEK,
      previous_week_executions: PREV_WEEK,
      week_over_week_pct: PREV_WEEK > 0 ? round(((THIS_WEEK - PREV_WEEK) / PREV_WEEK) * 100, 1) : null,
      total_executions: HEATMAP_TOTAL,
      total_cost: round(HEATMAP_TOTAL * 0.0218),
      intensity_thresholds: [2, 5, 8, 11],
    },
    window_days: 365,
    generated_at: isoAgo(3),
  };

  // ── Self-healing effectiveness ledger ───────────────────────────────────
  const EFFECTIVENESS_CATEGORIES = [
    { category: 'timeout', attempted: 21, confirmed: 17 },
    { category: 'rate_limit', attempted: 11, confirmed: 8 },
    { category: 'credential', attempted: 9, confirmed: 4 },
    { category: 'budget', attempted: 5, confirmed: 1 },
  ].map((c) => ({
    ...c,
    reverted: c.attempted - c.confirmed,
    success_rate: round(c.confirmed / c.attempted, 4),
  }));
  const EFFECTIVENESS = {
    window_days: 30,
    attempted: EFFECTIVENESS_CATEGORIES.reduce((s, c) => s + c.attempted, 0),
    confirmed: EFFECTIVENESS_CATEGORIES.reduce((s, c) => s + c.confirmed, 0),
    reverted: EFFECTIVENESS_CATEGORIES.reduce((s, c) => s + c.reverted, 0),
    success_rate: round(
      EFFECTIVENESS_CATEGORIES.reduce((s, c) => s + c.confirmed, 0)
      / EFFECTIVENESS_CATEGORIES.reduce((s, c) => s + c.attempted, 0), 4,
    ),
    by_category: EFFECTIVENESS_CATEGORIES,
  };
  const HEALING_AUDIT = [
    { id: 'mc-au-1', personaId: p(4).id, executionId: 'mc-exec-007', eventType: 'ai_heal_parse_failed', subsystem: 'ai_healing', message: 'The fix proposal was not valid JSON', detail: 'Unexpected end of input at 412', createdAt: isoAgo(2 * H) },
    { id: 'mc-au-2', personaId: p(2).id, executionId: null, eventType: 'dedup_skipped', subsystem: 'healing_analysis', message: 'Duplicate timeout issue skipped', detail: null, createdAt: isoAgo(6 * H) },
    { id: 'mc-au-3', personaId: null, executionId: null, eventType: 'knowledge_persist_error', subsystem: 'knowledge_extraction', message: 'Knowledge row not written: database busy', detail: 'SQLITE_BUSY after 3 attempts', createdAt: isoAgo(11 * H) },
    { id: 'mc-au-4', personaId: p(5).id, executionId: 'mc-exec-003', eventType: 'ai_heal_unknown_target', subsystem: 'ai_healing', message: 'The proposal targeted a field the persona does not have', detail: 'target: budget_ceiling_usd', createdAt: isoAgo(26 * H) },
    { id: 'mc-au-5', personaId: p(0).id, executionId: null, eventType: 'knowledge_parse_error', subsystem: 'knowledge_extraction', message: 'Pattern text could not be parsed', detail: null, createdAt: isoAgo(2 * D) },
    { id: 'mc-au-6', personaId: p(3).id, executionId: 'mc-exec-025', eventType: 'ai_heal_section_missing', subsystem: 'ai_healing', message: 'The prompt had no section to patch', detail: 'expected ## Constraints', createdAt: isoAgo(3 * D) },
  ];

  // ── Scheduled routines ──────────────────────────────────────────────────
  // `next_trigger_at` must be in the FUTURE of the frozen clock: the card drops
  // past runs as "the scheduler never advanced them", which is exactly right in
  // the app and would empty this card in a shot.
  const trigger = (id, personaIndex, type, inMinutes, cron) => ({
    id, persona_id: p(personaIndex).id, trigger_type: type,
    config: cron ? JSON.stringify({ cron, timezone: 'UTC' }) : null,
    enabled: true, status: 'active',
    last_triggered_at: isoAgo(inMinutes * 3 + 60),
    next_trigger_at: isoIn(inMinutes),
    trigger_version: 4, created_at: isoAgo(40 * D), updated_at: isoAgo(2 * H),
    use_case_id: null, responsibility_id: null, unattended_mode: 'auto',
  });
  const TRIGGERS = [
    trigger('mc-tr-1', 0, 'schedule', 14, '*/15 * * * *'),
    trigger('mc-tr-2', 2, 'polling', 42, null),
    trigger('mc-tr-3', 1, 'cron', 3 * H + 20, '0 18 * * 1-5'),
    trigger('mc-tr-4', 4, 'schedule', 9 * H, '0 2 * * *'),
    trigger('mc-tr-5', 5, 'cron', 2 * D + 5 * H, '0 9 1 * *'),
    trigger('mc-tr-6', 3, 'schedule', 4 * D, '0 7 * * 1'),
    // A webhook trigger the card must filter out (not a schedule kind).
    { ...trigger('mc-tr-7', 0, 'webhook', 30, null), trigger_type: 'webhook' },
  ];

  // ── Vault activity ──────────────────────────────────────────────────────
  // [operation, credentialName, personaIndex|null, detail, minutesAgo]
  const AUDIT_ROWS = [
    ['healthcheck', 'Gmail (work)', 0, 'Token valid, expires in 54m', 11],
    ['decrypt', 'OpenAI API key', 4, null, 23],
    ['create', 'Slack bot token', null, 'Added from the connector catalog', 70],
    ['update', 'GitHub PAT', null, 'Scope narrowed to repo:read', 4 * H],
    ['decrypt', 'Gmail (work)', 0, null, 5 * H],
    ['healthcheck', 'Stripe restricted key', 5, 'Returned 401 — rotation queued', 9 * H],
    ['decrypt', 'Postgres (analytics)', 3, null, 27 * H],
    ['delete', 'Legacy Zapier hook', null, 'Unused for 90 days', 2 * D],
    ['update', 'Stripe restricted key', null, 'Rotated by the vault scheduler', 3 * D],
    ['create', 'Linear API key', null, null, 5 * D],
  ];
  const CREDENTIAL_AUDIT = AUDIT_ROWS.map(([operation, credentialName, personaIndex, detail, minutesAgo], i) => ({
    id: `mc-ca-${String(i + 1).padStart(2, '0')}`,
    credentialId: `cred-${credentialName.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`,
    credentialName,
    operation,
    personaId: personaIndex === null ? null : p(personaIndex).id,
    personaName: personaIndex === null ? null : p(personaIndex).name,
    detail,
    createdAt: isoAgo(minutesAgo),
  }));

  // ── Attention loop ──────────────────────────────────────────────────────
  const ATTENTION_LOOP = {
    enabled: true,
    summary: {
      latest: {
        id: 'mc-al-1',
        personaId: p(2).id,
        responsibilityId: 'resp-uptime-watch',
        kind: 'attention',
        lane: 'incident_scan',
        verdict: 'dispatched',
        reason: 'Two open timeout issues on the EU probe crossed the dispatch threshold',
        consumedThrough: isoAgo(21),
        statsJson: JSON.stringify({ episodes: 14, lanes: 3 }),
        costUsd: 0.0184,
        startedAt: isoAgo(19),
        completedAt: isoAgo(18),
      },
      dispatchedToday: 7,
      refusedToday: 2,
      consolidationsToday: 3,
      personasServedToday: 4,
    },
  };

  // ── Memory suggestions (localStorage-backed, seeded by `prepare`) ───────
  const MEMORY_ACTIONS = [
    {
      id: 'mc-ma-1', memoryId: 'mem-1', memoryTitle: 'EU status probes need a 45s timeout',
      kind: 'config', rule: 'Raise the probe timeout to 45s for endpoints under status.example.com/eu.',
      reasoning: 'Four healed timeouts in the window all cleared on a retry with a longer deadline.',
      score: 0.86, agentId: p(2).id, dismissed: false, createdAt: isoAgo(3 * H),
    },
    {
      id: 'mc-ma-2', memoryId: 'mem-2', memoryTitle: 'Search tool allows 30 queries a minute',
      kind: 'throttle', rule: 'Cap the research persona at 28 search calls per minute.',
      reasoning: 'Two rate-limit retries both fired above 40 queries in a minute.',
      score: 0.74, agentId: p(3).id, dismissed: false, createdAt: isoAgo(18 * H),
    },
    {
      id: 'mc-ma-3', memoryId: 'mem-3', memoryTitle: 'Reconciliation runs long at month end',
      kind: 'schedule', rule: 'Split the invoice reconciliation into per-month chunks on the 1st.',
      reasoning: 'Every budget-cap failure in the window landed in the first two days of a month.',
      score: 0.69, agentId: p(5).id, dismissed: false, createdAt: isoAgo(2 * D),
    },
  ];

  const calls = [
    // Boot / route preloads.
    { cmd: 'list_personas', response: PERSONAS },
    { cmd: 'get_persona_summaries', response: [] },
    // Pipeline wave 1.
    { cmd: 'get_execution_dashboard', response: EXECUTION_DASHBOARD },
    { cmd: 'list_all_executions', response: EXECUTIONS },
    { cmd: 'count_executions', response: COUNTS },
    // Pipeline wave 2.
    { cmd: 'get_overview_bundle', response: OVERVIEW_BUNDLE },
    { cmd: 'list_healing_issues', response: HEALING_ISSUES },
    // Pipeline, mount-only (alerts feed the Vitals alert tile via useAttention).
    { cmd: 'list_alert_rules', response: ALERT_RULES },
    { cmd: 'list_fired_alerts', response: FIRED_ALERTS },
    // Attention counts that are not part of the dashboard pipeline.
    { cmd: 'get_pending_review_count', response: 3 },
    { cmd: 'get_unread_report_count', response: 5 },
    // MissionStatusMonitor (useStatusPageData) + LeaderboardSection
    // (refreshHealthDashboard -> computePersonaHealth).
    { cmd: 'get_sla_dashboard', response: SLA_DASHBOARD },
    { cmd: 'get_health_bundle', response: HEALTH_BUNDLE },
    // ExecutionHeatmap.
    { cmd: 'get_execution_heatmap', response: HEATMAP },
    // HealingEffectivenessPanel.
    { cmd: 'get_healing_effectiveness', response: EFFECTIVENESS },
    { cmd: 'list_healing_audit_log', response: HEALING_AUDIT },
    // UpcomingRoutinesCard.
    { cmd: 'list_all_triggers', response: TRIGGERS },
    // VaultActivityCard.
    { cmd: 'credential_audit_log_global', response: CREDENTIAL_AUDIT },
    // AttentionLoopCard.
    { cmd: 'get_attention_loop_status', response: ATTENTION_LOOP },
    // Not IPC: the memory-suggestion pane reads localStorage, so the seed
    // travels on the tape and `prepare` writes it into the store.
    { cmd: '__harness_seed', response: { memoryActions: MEMORY_ACTIONS } },
  ];

  return {
    builders: {
      'overview/sub_missionControl': () => ({
        version: 1,
        module: 'overview/sub_missionControl',
        source: 'synthetic',
        recordedAt: RECORDED_AT,
        note: 'Synthetic: 6 personas, 40 executions in six statuses over 30 days (65% success), a 30-day daily series with one cost anomaly, per-persona SLA + reliability so the status monitor grades and the leaderboard ranks 6 agents, a 365-day heatmap, the healing-effectiveness ledger, 6 scheduled routines, 10 vault audit rows, a live attention loop and 3 memory suggestions.',
        calls,
      }),
    },
  };
}
