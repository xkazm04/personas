// Synthetic tapes for module 5, Teams > Factory (teams/sub_factory, mounted by
// factorySurfaces.tsx). Shapes follow the TS bindings (DevProject,
// DevContextGroup, DevContext, DevKpi, DevKpiMeasurement, DevGoal, DevUseCase,
// DevProjectWallSummary, PersonaCredential, ApiProxyResponse) and the hand-typed
// CrossProjectMetadataMap in src/api/devTools/devTools.ts. Fixture CODE, no
// personal data.
//
//   factory/landing        L1: the portfolio (passport wall) over three projects
//   factory/overview       L2 Overview of "Atlas Web": 6 groups, 17 contexts in
//                          every state (critical, warning, setup, healthy),
//                          proposed KPIs, goals, features, Sentry errors and LLM
//                          spend attributed to contexts
//   factory/select         the same, the second context clicked (pane or drawer)
//   factory/matrix         L2 KPI matrix
//   factory/observability  L2 Observability: LLM spend by feature, Sentry issues
//   factory/group          L3: one group's KPI table (a matrix group opened)
//   factory/console        L4: one KPI's console (a matrix KPI opened)

export function factoryTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const sqlAgo = (minutes) => new Date(T0 - minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);
  const isoAgo = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const H = 60;
  const D = 60 * 24;
  const MAIN = 'p-atlas';

  function project(id, name, stack, extra = {}) {
    return {
      id, name, root_path: `C:/code/${id.slice(2)}`, description: `${name}, a product codebase.`, status: 'active',
      tech_stack: stack, github_url: null, monitoring_credential_id: null, monitoring_project_slug: null,
      static_scan_config: null, auto_pr_on_success: false, pr_credential_id: null, llm_tracking_credential_id: null,
      support_credential_id: null, data_links: null, test_env_url: null, test_env_branch: null, main_branch: 'main',
      standards_config: null, team_id: null, workspace_id: null, kind: 'code', enabled: true,
      created_at: sqlAgo(90 * D), updated_at: sqlAgo(2 * D), ...extra,
    };
  }
  const PROJECTS = [
    project(MAIN, 'Atlas Web', 'TypeScript, React, Vite, Postgres', {
      llm_tracking_credential_id: 'cred-trace', monitoring_credential_id: 'cred-sentry', monitoring_project_slug: 'atlas/atlas-web',
    }),
    project('p-ledger', 'Ledger API', 'Rust, Axum, SQLite'),
    project('p-nova', 'Nova Mobile', 'Kotlin, Jetpack Compose'),
  ];

  // [id, name, domain, color, [[ctxId, name, category, files[]]]]
  const MAP = [
    ['g-auth', 'Authentication', 'feature', '#06b6d4', [
      ['c-login', 'Login flow', 'ui', ['src/auth/login.tsx', 'src/auth/useLogin.ts']],
      ['c-session', 'Session refresh', 'lib', ['src/auth/session.ts']],
      ['c-oauth', 'OAuth connectors', 'api', ['src/auth/oauth/']],
    ]],
    ['g-billing', 'Billing', 'feature', '#10b981', [
      ['c-checkout', 'Checkout', 'ui', ['src/billing/checkout/']],
      ['c-invoices', 'Invoices', 'api', ['src/billing/invoices.ts']],
      ['c-metering', 'Usage metering', 'data', ['src/billing/metering/']],
    ]],
    ['g-search', 'Search', 'feature', '#f59e0b', [
      ['c-parser', 'Query parser', 'lib', ['src/search/parser.ts']],
      ['c-ranking', 'Ranking', 'lib', ['src/search/ranking/']],
      ['c-indexer', 'Indexer', 'data', ['src/search/indexer/']],
    ]],
    ['g-platform', 'Platform', 'infrastructure', '#a855f7', [
      ['c-queue', 'Job queue', 'lib', ['src/platform/queue/']],
      ['c-cache', 'Cache layer', 'lib', ['src/platform/cache.ts']],
      ['c-deploy', 'Deploy pipeline', 'config', ['.github/workflows/']],
    ]],
    ['g-ds', 'Design system', 'shared', '#3b82f6', [
      ['c-forms', 'Buttons and forms', 'ui', ['src/ui/forms/']],
      ['c-tables', 'Data tables', 'ui', ['src/ui/table/']],
    ]],
    [null, null, null, null, [
      ['c-exports', 'Legacy exports', 'api', ['src/legacy/exports.ts']],
      ['c-admin', 'Admin console', 'ui', ['src/admin/']],
      ['c-flags', 'Feature flags', 'config', ['src/flags.ts']],
    ]],
  ];

  const GROUPS = MAP.filter(([id]) => id).map(([id, name, domain, color], i) => ({
    id, project_id: MAIN, name, color, icon: null, group_type: null, domain, position: i,
    health_score: null, last_scan_at: sqlAgo(3 * D), created_at: sqlAgo(60 * D), updated_at: sqlAgo(3 * D),
  }));
  const CONTEXTS = MAP.flatMap(([gid, , , , ctxs]) => ctxs.map(([id, name, category, files]) => ({
    id, project_id: MAIN, group_id: gid, name: id.slice(2), description: null, file_paths: JSON.stringify(files),
    entry_points: null, db_tables: null, keywords: null, api_surface: null, cross_refs: null, tech_stack: null,
    category, business_feature: name, pinned: false, created_at: sqlAgo(60 * D), updated_at: sqlAgo(3 * D),
  })));

  function kpi(id, context, name, category, fields) {
    return {
      id, project_id: MAIN, context_group_id: null, context_id: context, use_case_id: null, name, description: null,
      category, measure_kind: 'codebase', measure_config: '{"cmd":"npm run test:coverage","parse":"coverage"}', unit: '%',
      direction: 'up', baseline_value: 50, target_value: 90, target_date: null, current_value: 70,
      last_measured_at: sqlAgo(5 * H), cadence: 'daily', status: 'active', created_by: 'user', rationale: null,
      needed_connector: null, metric_type: null, tier: 'primary', warn_at: null, crit_at: null, manual_rating: null,
      assessment_pros: null, assessment_cons: null, last_skip_at: null, last_skip_rationale: null,
      created_at: sqlAgo(40 * D), updated_at: sqlAgo(5 * H), ...fields,
    };
  }
  // [id, context, name, category, fields, series oldest -> newest]
  const ACTIVE = [
    ['k-login-conv', 'c-login', 'Login success rate', 'value', { baseline_value: 88, target_value: 98, current_value: 81, unit: '%', tier: 'north_star' }, [90, 89, 87, 86, 84, 82, 81]],
    ['k-login-p95', 'c-login', 'Login p95 latency', 'technical', { unit: 'ms', direction: 'down', baseline_value: 900, target_value: 400, current_value: 520 }, [880, 820, 760, 700, 640, 560, 520]],
    ['k-session-err', 'c-session', 'Refresh failures', 'quality', { unit: 'errors', direction: 'down', baseline_value: 40, target_value: 5, current_value: 4 }, [38, 30, 22, 14, 9, 6, 4]],
    ['k-oauth-cov', 'c-oauth', 'Connector test coverage', 'technical', { current_value: null, last_measured_at: null }, []],
    ['k-checkout-conv', 'c-checkout', 'Checkout conversion', 'value', { unit: '%', baseline_value: 2.1, target_value: 3.5, current_value: 3.6, tier: 'north_star' }, [2.2, 2.5, 2.8, 3.0, 3.2, 3.4, 3.6]],
    ['k-checkout-err', 'c-checkout', 'Payment errors', 'quality', { unit: 'errors', direction: 'down', baseline_value: 30, target_value: 5, current_value: 12 }, [28, 25, 20, 18, 15, 13, 12]],
    ['k-invoice-lag', 'c-invoices', 'Invoice lag', 'traffic', { unit: 'min', direction: 'down', baseline_value: 60, target_value: 10, current_value: 58 }, [55, 57, 60, 59, 61, 60, 58]],
    ['k-metering', 'c-metering', 'Metered events dropped', 'quality', { unit: 'events', direction: 'down', baseline_value: 200, target_value: 0, current_value: 230, skip: true }, [190, 200, 205, 215, 220, 226, 230]],
    ['k-parser-cov', 'c-parser', 'Parser coverage', 'technical', { baseline_value: 60, target_value: 90, current_value: 92 }, [70, 75, 80, 84, 88, 90, 92]],
    ['k-ranking-ndcg', 'c-ranking', 'Ranking nDCG', 'value', { unit: '', baseline_value: 0.62, target_value: 0.8, current_value: 0.71 }, [0.62, 0.64, 0.66, 0.68, 0.69, 0.7, 0.71]],
    ['k-index-age', 'c-indexer', 'Index freshness', 'traffic', { unit: 'min', direction: 'down', baseline_value: 30, target_value: 5, current_value: 7 }, [28, 22, 18, 12, 9, 8, 7]],
    ['k-queue-fail', 'c-queue', 'Failed jobs', 'quality', { unit: 'jobs', direction: 'down', baseline_value: 50, target_value: 5, current_value: 49 }, [45, 47, 50, 52, 51, 50, 49]],
    ['k-cache-hit', 'c-cache', 'Cache hit rate', 'technical', { baseline_value: 70, target_value: 95, current_value: 91 }, [72, 78, 83, 86, 88, 90, 91]],
    ['k-deploy-time', 'c-deploy', 'Deploy duration', 'technical', { unit: 'min', direction: 'down', baseline_value: 25, target_value: 10, current_value: 9 }, [24, 20, 17, 14, 12, 10, 9]],
    ['k-forms-a11y', 'c-forms', 'Accessible form fields', 'quality', { baseline_value: 40, target_value: 100, current_value: 64 }, [40, 44, 50, 55, 58, 62, 64]],
    ['k-exports-use', 'c-exports', 'Export requests', 'traffic', { unit: 'req', baseline_value: 120, target_value: 300, current_value: null, last_measured_at: null }, []],
  ];
  const KPIS = ACTIVE.map(([id, ctx, name, cat, f]) => {
    const { skip, ...fields } = f;
    return kpi(id, ctx, name, cat, skip
      ? { ...fields, last_skip_at: sqlAgo(2 * H), last_skip_rationale: 'The drops come from the upstream billing provider; nothing in this codebase moves them.' }
      : fields);
  });
  const PROPOSED = [
    ['kp-1', 'c-login', 'Login abandon rate', 'value', { unit: '%', direction: 'down', baseline_value: 14, target_value: 6 }],
    ['kp-2', 'c-login', 'Password reset completion', 'value', { unit: '%', baseline_value: 55, target_value: 80 }],
    ['kp-3', 'c-checkout', 'Checkout p95 latency', 'technical', { unit: 'ms', direction: 'down', baseline_value: 1400, target_value: 600 }],
    ['kp-4', 'c-oauth', 'Token refresh errors', 'quality', { unit: 'errors', direction: 'down', baseline_value: 22, target_value: 2, needed_connector: 'sentry' }],
    ['kp-5', 'c-ranking', 'Zero-result searches', 'traffic', { unit: '%', direction: 'down', baseline_value: 9, target_value: 3 }],
    ['kp-6', null, 'Weekly active teams', 'value', { unit: 'teams', baseline_value: 40, target_value: 120 }],
  ].map(([id, ctx, name, cat, f]) => kpi(id, ctx, name, cat, {
    status: 'proposed', created_by: 'scan', current_value: null, last_measured_at: null,
    rationale: 'Proposed by the KPI scan from the context map.', ...f,
  }));

  const MEASUREMENTS = ACTIVE.flatMap(([id, , , , , series]) => series.map((value, i) => ({
    id: `m-${id}-${i}`, kpi_id: id, value, measured_at: sqlAgo((series.length - 1 - i) * D + 5 * H),
    source: 'codebase', env: 'production', evidence: null, note: null,
  })).reverse());

  const goal = (id, ctx, title) => ({
    id, project_id: MAIN, parent_goal_id: null, context_id: ctx, kpi_id: null, order_index: 0, title, description: null,
    status: 'in_progress', progress: 40, target_date: null, started_at: sqlAgo(4 * D), completed_at: null,
    created_at: sqlAgo(6 * D), updated_at: sqlAgo(D),
  });
  const GOALS = [
    goal('go-1', 'c-login', 'Recover login success above 95%'),
    goal('go-2', 'c-login', 'Cut login p95 below 400ms'),
    goal('go-3', 'c-metering', 'Stop dropping metered events'),
    goal('go-4', 'c-queue', 'Retry failed jobs with backoff'),
    goal('go-5', 'c-forms', 'Label every form field'),
  ];

  const useCase = (id, name, ctxIds) => ({
    id, project_id: MAIN, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    description: null, kind: 'feature', primary_context_id: ctxIds[0], status: 'active', created_by: 'scan', pinned: false,
    tier: 'primary', rationale: null, created_at: sqlAgo(30 * D), updated_at: sqlAgo(3 * D), context_ids: ctxIds,
  });
  const USE_CASES = [
    useCase('uc-1', 'Sign in', ['c-login', 'c-session']),
    useCase('uc-2', 'Connect a provider', ['c-oauth', 'c-session']),
    useCase('uc-3', 'Buy a plan', ['c-checkout', 'c-invoices']),
    useCase('uc-4', 'Search the catalog', ['c-parser', 'c-ranking', 'c-indexer']),
    useCase('uc-5', 'Monthly invoice run', ['c-invoices', 'c-metering', 'c-queue']),
    useCase('uc-6', 'Export a report', ['c-exports']),
  ];

  const CREDENTIALS = [
    { id: 'cred-trace', name: 'LightTrack', serviceType: 'tracklight', metadata: null, lastUsedAt: isoAgo(H), scopedResources: null, createdAt: isoAgo(30 * D), updatedAt: isoAgo(D) },
    { id: 'cred-sentry', name: 'Sentry', serviceType: 'sentry', metadata: null, lastUsedAt: isoAgo(H), scopedResources: null, createdAt: isoAgo(30 * D), updatedAt: isoAgo(D) },
  ];
  const api = (rows) => ({ status: 200, status_text: 'OK', headers: {}, body: JSON.stringify(rows), duration_ms: 84, content_type: 'application/json', truncated: false });
  const since = new Date(T0 - 30 * 86_400_000).toISOString();
  const TRACE_ROWS = [
    ['Buy a plan', 'anthropic', 'claude-sonnet-4-5', 1840, 21.4],
    ['Search the catalog', 'openai', 'gpt-4.1-mini', 5210, 9.8],
    ['Monthly invoice run', 'anthropic', 'claude-haiku-4-5', 620, 4.1],
    ['Sign in', 'openai', 'gpt-4.1-mini', 2400, 2.6],
    ['Connect a provider', 'anthropic', 'claude-haiku-4-5', 310, 0.9],
    [null, 'google', 'gemini-2.5-flash', 150, 0.4],
  ].map(([name, provider, model, calls, cost]) => ({ name, provider, model, calls, input_tokens: calls * 1800, output_tokens: calls * 420, cost_usd: cost }));
  const SENTRY_ROWS = [
    ['A-1', 'TypeError: Cannot read properties of undefined (reading "token")', 'src/auth/login.tsx in submitLogin', 48],
    ['A-2', 'PaymentIntentError: card_declined was not handled', 'src/billing/checkout/confirm.ts', 21],
    ['A-3', 'QueueTimeoutError: job exceeded 120s', 'src/platform/queue/worker.ts in runJob', 14],
    ['A-4', 'RangeError: Invalid time value', 'src/billing/invoices.ts in formatPeriod', 6],
    ['A-5', 'ChunkLoadError: Loading chunk 412 failed', null, 3],
  ].map(([shortId, title, culprit, count]) => ({ id: shortId, shortId: `ATLAS-${shortId}`, title, culprit, count: String(count), lastSeen: isoAgo(2 * H) }));

  // L1: cross-project metadata (one row per project) and the batched wall summary.
  const meta = (p, contexts, groups, goals, caps, layers) => ({
    project_id: p.id, name: p.name, root_path: p.root_path, description: p.description, github_url: null, status: 'active',
    declared_tech_stack: p.tech_stack, summary: `${p.name} ships the product surface.`, capabilities: caps.map(([name, color, n]) => ({ name, color, group_type: null, context_count: n })),
    keywords: ['billing', 'auth', 'search'], tech_layers: layers, entry_points: ['src/main.tsx'], db_tables: ['users', 'invoices'],
    api_surface: ['/api/v1'], cross_refs: [], hot_directories: ['src/'], context_count: contexts, group_count: groups, active_goal_count: goals,
  });
  const METADATA = {
    projects: [
      meta(PROJECTS[0], 17, 5, 5, [['Authentication', '#06b6d4', 3], ['Billing', '#10b981', 3], ['Search', '#f59e0b', 3]], ['frontend', 'backend', 'database', 'ci']),
      meta(PROJECTS[1], 9, 3, 2, [['Ledger core', '#a855f7', 4], ['Reports', '#3b82f6', 3]], ['backend', 'database']),
      meta(PROJECTS[2], 0, 0, 0, [], ['mobile']),
    ],
    cross_project: { shared_keywords: [], similarity_matrix: [], tech_distribution: [], relations: [] },
    generated_at: isoAgo(35),
    total_projects: 3,
  };
  const WALL = [
    { projectId: MAIN, contextsCount: 17, activeKpis: KPIS, milestones: [] },
    { projectId: 'p-ledger', contextsCount: 9, activeKpis: [], milestones: [] },
    { projectId: 'p-nova', contextsCount: 0, activeKpis: [], milestones: [] },
  ];

  const byProject = (cmd, main, other, extraArgs = {}) => [
    { cmd, args: { projectId: MAIN, ...extraArgs }, response: main },
    { cmd, response: other },
  ];
  const calls = [
    { cmd: 'dev_tools_list_projects', response: PROJECTS },
    { cmd: 'dev_tools_get_project', args: { id: MAIN }, response: PROJECTS[0] },
    { cmd: 'dev_tools_get_project', response: PROJECTS[1] },
    { cmd: 'dev_tools_get_cross_project_metadata', response: METADATA },
    { cmd: 'dev_tools_generate_cross_project_metadata', response: METADATA },
    { cmd: 'dev_tools_project_wall_summary', response: WALL },
    { cmd: 'dev_tools_get_project_favicon', response: null },
    { cmd: 'dev_tools_probe_repo_evidence', response: null },
    { cmd: 'skill_files_list', response: [] },
    { cmd: 'skill_files_list_global', response: [] },
    { cmd: 'skill_usage_overview', response: [] },
    { cmd: 'skill_usage_scan', response: { exhausted: false } },
    { cmd: 'doc_rot_overview', response: [] },
    { cmd: 'doc_rot_scan', response: null },
    { cmd: 'memory_health_overview', response: [] },
    { cmd: 'memory_health_scan', response: { projects_scanned: 0 } },
    { cmd: 'list_credentials', response: CREDENTIALS },
    // The wall's per-project session chips read the Fleet registry (passportFleet.tsx).
    { cmd: 'fleet_list_sessions', response: { sessions: [], hookPort: 17321, hooksInstalled: true } },
    { cmd: 'fleet_set_auto_hibernate', response: null },
    { cmd: 'fleet_set_state_cutoffs', response: null },
    ...byProject('dev_tools_list_context_groups', GROUPS, []),
    { cmd: 'dev_tools_list_contexts', args: { projectId: MAIN, groupId: null, limit: null }, response: CONTEXTS },
    { cmd: 'dev_tools_list_contexts', response: [] },
    { cmd: 'dev_tools_list_use_cases', args: { projectId: MAIN, status: null }, response: USE_CASES },
    { cmd: 'dev_tools_list_use_cases', response: [] },
    { cmd: 'dev_tools_list_kpis', args: { projectId: MAIN, status: null }, response: [...KPIS, ...PROPOSED] },
    { cmd: 'dev_tools_list_kpis', response: [] },
    { cmd: 'dev_tools_list_kpi_measurements_bulk', response: MEASUREMENTS },
    ...byProject('dev_tools_list_goals', GOALS, []),
    { cmd: 'get_project_pulse_snapshots', response: [] },
    {
      cmd: 'execute_api_request',
      args: { credentialId: 'cred-trace', method: 'GET', path: `/v1/usecases?since=${encodeURIComponent(since)}`, headers: {}, body: null },
      response: api(TRACE_ROWS),
    },
    {
      cmd: 'execute_api_request',
      args: { credentialId: 'cred-sentry', method: 'GET', path: '/api/0/projects/atlas/atlas-web/issues/?query=is:unresolved&statsPeriod=14d&limit=25', headers: {}, body: null },
      response: api(SENTRY_ROWS),
    },
  ];
  const base = (module, note) => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls });
  const L2 = 'Synthetic: Atlas Web with 6 groups, 17 contexts in every state, 16 active and 6 proposed KPIs, 5 goals, 6 features, 5 Sentry issues and 6 traced LLM use cases.';

  return {
    builders: {
      'factory/landing': () => base('factory/landing', 'Synthetic: three projects on the passport wall (one rich, one partial, one bare).'),
      'factory/overview': () => base('factory/overview', `${L2} The Overview tab.`),
      'factory/select': () => base('factory/select', `${L2} The Overview tab, second context clicked.`),
      'factory/matrix': () => base('factory/matrix', `${L2} The KPI matrix tab.`),
      'factory/observability': () => base('factory/observability', `${L2} The Observability tab.`),
      'factory/group': () => base('factory/group', `${L2} The Authentication group's KPI table.`),
      'factory/console': () => base('factory/console', `${L2} The Login success rate console.`),
    },
  };
}
