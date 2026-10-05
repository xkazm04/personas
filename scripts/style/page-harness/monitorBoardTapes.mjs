// Synthetic tapes for spark board-monitor (monitorBoardSurfaces.tsx): the
// Persona Monitor opened on its Board. Fixture CODE, no personal data.
//
// THE REAL-SHAPED FLEET mirrors the operator's database as scouted on
// 2026-10-05 - 30 personas: one team of 12, one of 2, eleven singletons and
// five teamless, plus two workspace groups nobody is filed in (the Board must
// not draw them). Its states follow the same scout: unread messages on most
// of the fleet (they count as "needs you" by the owner's decision), two
// pending reviews, one failed last run, six personas switched off. Running
// work is not IPC-shaped (it arrives as events), so the surface's `prepare`
// puts two runs and one app-level process into the store.
//
// The simulation variants need only the shell's boot commands: their fleet is
// the test build's own 100-persona load fleet.

const NAMES = [
  'Release Noter', 'PR Reviewer', 'Incident Scribe', 'Blog Drafter', 'Security Scanner', 'Cash Forecaster',
  'Landing Runner', 'Status Poster', 'Clause Librarian', 'Dataset Cleaner', 'Escalation Router', 'Cohort Slicer',
  'Review Collector', 'Leave Planner', 'Contract Redliner', 'Pulse Reader', 'DNS Auditor', 'Culture Digest',
  'Log Sifter', 'Referral Tracker', 'Invoice Reconciler', 'Ledger Closer', 'Tax Digest', 'Budget Watcher',
  'Expense Auditor', 'Payroll Checker', 'FX Rate Scout', 'Receipt Matcher', 'Payment Chaser', 'Vendor Onboarder',
];
const ICONS = ['agent-icon:document', 'agent-icon:code', 'agent-icon:monitor', 'agent-icon:research', 'agent-icon:email', 'agent-icon:finance'];
const COLORS = ['#06b6d4', '#a855f7', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899', '#84cc16'];
const TEAMS = [
  ['personas-desktop', 'Personas Desktop', 12], ['docs', 'Docs', 2], ['legal', 'Legal', 1], ['research', 'Research', 1],
  ['people', 'People', 1], ['growth', 'Growth', 1], ['support', 'Support', 1], ['data', 'Data', 1], ['marketing', 'Marketing', 1],
  ['finance', 'Finance', 1], ['infra', 'Infra', 1], ['sales', 'Sales', 1], ['ops', 'Ops', 1],
];
/** Persona index -> its state. Everything not listed rests. */
const UNREAD = { 0: 12, 1: 3, 2: 44, 4: 59, 5: 7, 6: 2, 8: 25, 9: 46, 12: 41, 13: 9, 14: 29, 15: 18, 17: 12, 18: 5, 19: 55, 21: 4, 24: 38, 26: 1, 28: 61 };
const REVIEWS = { 3: 'warning', 16: 'info' };
const FAILED = new Set([20]);
const OFF = new Set([7, 11, 22, 23, 27, 28]);
export const BOARD_RUNNING = [10, 25];

export function monitorBoardTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const pid = (i) => `p-board-${i}`;

  const homeOf = [];
  for (const [id, , size] of TEAMS) for (let k = 0; k < size; k++) homeOf.push(`t-${id}`);
  while (homeOf.length < NAMES.length) homeOf.push(null);

  const personas = NAMES.map((name, i) => ({
    id: pid(i), project_id: 'proj-board', name, description: null, system_prompt: '', structured_prompt: null,
    icon: ICONS[i % ICONS.length], color: COLORS[i % COLORS.length], enabled: !OFF.has(i),
    sensitive: false, headless: false, starred: false, max_concurrent: 1, timeout_ms: 300000,
    notification_channels: null, last_design_result: null, last_test_report: null, model_profile: null,
    max_budget_usd: null, max_turns: null, design_context: null, home_team_id: homeOf[i], source_review_id: null,
    trust_level: 'verified', trust_origin: 'user', trust_verified_at: null, trust_score: 0.9, parameters: null,
    gateway_exposure: 'none', template_category: null, cli_awareness_enabled: false, setup_status: 'ready',
    setup_detail: null, disabled_dims_json: null, lifecycle: 'active', athena_auto_flag: false,
    created_at: ago(60 * 24 * 40), updated_at: ago(60 * 24),
  }));
  const team = (id, name, color, workspace_id) => ({
    id, project_id: workspace_id ? null : 'proj-board', workspace_id, parent_team_id: null, name, description: null,
    canvas_data: null, team_config: null, icon: null, color, enabled: true, shared_instructions: null,
    default_model_profile: null, default_max_budget_usd: null, default_max_turns: null,
    created_at: ago(60 * 24 * 60), updated_at: ago(60 * 24),
  });
  const teams = [
    ...TEAMS.map(([id, name], i) => team(`t-${id}`, name, COLORS[(i + 3) % COLORS.length], undefined)),
    team('t-ws-a', 'Workspace A', '#64748b', 'ws-a'), team('t-ws-b', 'Workspace B', '#64748b', 'ws-b'),
  ];

  const statuses = (i) => (FAILED.has(i)
    ? ['failed', 'completed', 'failed', 'completed']
    : ['completed', i % 4 === 0 ? 'failed' : 'completed', 'completed', 'completed', i % 5 === 0 ? 'cancelled' : 'completed', 'completed']);
  const summaries = NAMES.map((_, i) => {
    const s = statuses(i);
    const ok = s.filter((x) => x === 'completed').length;
    return {
      personaId: pid(i), enabledTriggerCount: 1, lastRunAt: ago(30 + i * 7),
      health: {
        status: OFF.has(i) ? 'dormant' : FAILED.has(i) ? 'failing' : ok / s.length < 0.8 ? 'degraded' : 'healthy',
        recentStatuses: s, successRate: ok / s.length, totalRecent: s.length, runsToday: (i * 7) % 6,
        sparkline: [1, 2, 0, 3, 1, 2, (i * 7) % 6],
      },
    };
  });
  const hourly = NAMES.map((_, i) => ({
    personaId: pid(i), buckets: Array.from({ length: 24 }, (_, h) => ((i * 13 + h * 7) % 9 < 4 ? 0 : (i + h) % 4)),
  })).filter((_, i) => !OFF.has(i));
  const reviewCounts = Object.entries(REVIEWS).map(([i, sev]) => ({
    personaId: pid(Number(i)), pending: 1, critical: 0, warning: sev === 'warning' ? 1 : 0, info: sev === 'info' ? 1 : 0,
  }));
  const unread = Object.fromEntries(Object.entries(UNREAD).map(([i, n]) => [pid(Number(i)), n]));
  const usage = {
    available: true, reason: null, subscriptionType: 'max', rateLimitTier: null, fetchedAtMs: T0 - 60_000,
    windows: [
      { key: 'five_hour', utilizationPct: 34, resetsAtMs: T0 + 3 * 3_600_000, windowMs: 5 * 3_600_000 },
      { key: 'seven_day', utilizationPct: 41, resetsAtMs: T0 + 4 * 86_400_000, windowMs: 7 * 86_400_000 },
    ],
  };

  const shell = [
    { cmd: 'dev_tools_workspace_list', response: [] },
    { cmd: 'dev_tools_list_projects', response: [] },
    { cmd: 'dev_tools_workspace_set_active', response: null },
    { cmd: 'fleet_list_sessions', response: { sessions: [], hookPort: null, hooksInstalled: true } },
    { cmd: 'get_app_settings_bulk', response: { max_parallel_executions: '4', 'fleet.max_parallel_sessions': '4' } },
    { cmd: 'fleet_claude_usage', response: usage },
    {
      cmd: 'fleet_claude_accounts_list',
      response: {
        activeAccountId: null, liveEmail: null, liveCaptured: false, livePresent: false, accounts: [],
        autoRotate: { enabled: false, thresholdPct: 90, cooldownSecs: 600 }, lastRotation: null, profiles: [],
      },
    },
    { cmd: 'list_manual_reviews_page', response: { rows: [], hasMore: false, nextCursor: null } },
    // The Activity board's desk feeds (the Monitor opens on Activity first).
    { cmd: 'dev_tools_undispatched_ideas', response: [] },
    { cmd: 'dev_tools_list_pending_acceptance', response: [] },
    { cmd: 'evolution_list_promotion_proposals', response: [] },
    { cmd: 'policy_tuning_list', response: [] },
    { cmd: 'dev_tools_triage_ideas', response: { ideas: [], cursor: null, hasMore: false, counts: { pending: 0, accepted: 0, rejected: 0 } } },
  ];
  const fleet = [
    ...shell,
    { cmd: 'list_personas', response: personas },
    { cmd: 'list_teams', response: teams },
    { cmd: 'get_team_counts', response: [] },
    { cmd: 'get_persona_summaries', response: summaries },
    { cmd: 'get_pending_review_counts_by_persona', response: reviewCounts },
    { cmd: 'get_unread_report_counts_by_persona', response: unread },
    { cmd: 'get_persona_runs_hourly', response: hourly },
  ];
  // The simulated board substitutes its own fleet, but the Monitor's feeds still
  // read: answer them empty so the feed-status banner does not report a failure.
  const simShell = [
    ...shell,
    { cmd: 'get_persona_summaries', response: [] },
    { cmd: 'get_pending_review_counts_by_persona', response: [] },
    { cmd: 'get_unread_report_counts_by_persona', response: {} },
    { cmd: 'list_teams', response: [] },
    { cmd: 'get_team_counts', response: [] },
  ];
  const base = (module, note, calls) => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls });
  const REAL = 'Synthetic: 30 personas shaped like the operator fleet (12 / 2 / 11 singletons / 5 teamless, 2 empty workspace groups).';
  const SIM = 'Synthetic shell only: the fleet is the test build simulation (100-persona load fleet).';
  return {
    builders: {
      'monitor/board': () => base('monitor/board', REAL, fleet),
      'monitor/board/zoom': () => base('monitor/board/zoom', `${REAL} Biggest team zoomed.`, fleet),
      'monitor/board/hover': () => base('monitor/board/hover', `${REAL} Hover card on the first needs tile.`, fleet),
      'monitor/board/sim': () => base('monitor/board/sim', SIM, simShell),
      'monitor/board/sim/zoom': () => base('monitor/board/sim/zoom', `${SIM} One project zoomed.`, simShell),
    },
  };
}
