// Synthetic IPC tapes, built from the TS bindings' shapes, for modules shot
// before a real tape has been recorded from the running app. Deterministic:
// every timestamp is an offset from RECORDED_AT, which the shooter also uses
// as the frozen page clock, so "5 min ago" and the Today/Yesterday grouping
// read the same on every run.
//
// A synthetic tape is fixture CODE, not recorded data. Recorded tapes carry
// personal data and live under tmp/ only.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RECORDED_AT = '2026-09-22T15:40:00.000Z';
const T0 = Date.parse(RECORDED_AT);
const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

const PROJECT = 'proj-harness';

function persona(id, name, icon, color, extra = {}) {
  return {
    id, project_id: PROJECT, name, description: null, system_prompt: '', structured_prompt: null,
    icon, color, enabled: true, sensitive: false, headless: false, starred: false,
    max_concurrent: 1, timeout_ms: 300000, notification_channels: null, last_design_result: null,
    last_test_report: null, model_profile: null, max_budget_usd: null, max_turns: null,
    design_context: null, home_team_id: null, source_review_id: null, trust_level: 'verified',
    trust_origin: 'user', trust_verified_at: null, trust_score: 0.9, parameters: null,
    gateway_exposure: 'none', template_category: null, cli_awareness_enabled: false,
    setup_status: 'ready', setup_detail: null, disabled_dims_json: null, lifecycle: 'active',
    created_at: ago(60 * 24 * 30), updated_at: ago(60 * 24 * 2),
    ...extra,
  };
}

const PERSONAS = [
  persona('p-triage', 'Inbox Triage', 'agent-icon:email', '#06b6d4'),
  persona('p-release', 'Release Notes Writer', 'agent-icon:document', '#a855f7'),
  persona('p-monitor', 'Uptime Sentinel', 'agent-icon:monitor', '#10b981'),
  persona('p-research', 'Market Research Analyst With A Long Descriptive Name', 'agent-icon:research', '#f59e0b'),
  persona('p-review', 'Code Review Buddy', 'agent-icon:code', '#3b82f6'),
  persona('p-finance', 'Invoice Reconciler', 'agent-icon:finance', '#ef4444'),
];

// [minutesAgo, event_type, source_type, target persona, status, error]
// Event types are all keys of EVENT_TYPE_COLORS (src/lib/design/eventTokens.ts),
// so none renders the gray unknown-type fallback.
const EVENT_ROWS = [
  [3, 'execution_completed', 'persona', 'p-triage', 'completed', null],
  [7, 'webhook_received', 'webhook', 'p-review', 'processing', null],
  [12, 'trigger_fired', 'scheduler', 'p-monitor', 'completed', null],
  [18, 'health_check_failed', 'health_monitor', 'p-monitor', 'failed', 'Endpoint https://status.example.com returned 503 three times'],
  [26, 'task_created', 'local_drive', 'p-release', 'pending', null],
  [41, 'persona_action', 'user', 'p-research', 'completed', null],
  [55, 'review_submitted', 'review_pipeline', 'p-review', 'skipped', null],
  [73, 'memory_created', 'memory_engine', null, 'processed', null],
  [96, 'credential_rotated', 'vault', null, 'completed', null],
  [128, 'chain_triggered', 'persona', 'p-finance', 'failed', 'Budget cap reached before the reconciliation finished'],
  [190, 'deploy_succeeded', 'cloud_deploy', 'p-release', 'completed', null],
  [260, 'trigger_fired', 'trigger:daily-digest', 'p-triage', 'completed', null],
  [60 * 20, 'trigger_fired', 'scheduler', 'p-monitor', 'completed', null],
  [60 * 21, 'webhook_received', 'webhook', 'p-review', 'failed', 'Signature mismatch on X-Hub-Signature-256'],
  [60 * 23, 'persona_action', 'user', 'p-finance', 'completed', null],
  [60 * 26, 'execution_completed', 'persona', 'p-research', 'completed', null],
  [60 * 30, 'test_event', 'test', null, 'skipped', null],
  [60 * 50, 'task_created', 'local_drive', 'p-release', 'completed', null],
  [60 * 75, 'deploy_started', 'cloud_deploy', 'p-triage', 'completed', null],
  [60 * 100, 'health_check_failed', 'health_monitor', 'p-monitor', 'processed', null],
];

const EVENTS = EVENT_ROWS.map(([m, type, source, target, status, error], i) => ({
  id: `evt-${String(i + 1).padStart(3, '0')}`,
  project_id: PROJECT,
  event_type: type,
  source_type: source,
  source_id: source === 'persona' ? target : null,
  target_persona_id: target,
  payload: JSON.stringify({ n: i + 1, summary: `${type} #${i + 1}` }),
  status,
  error_message: error,
  processed_at: status === 'pending' ? null : ago(m - 0.2),
  created_at: ago(m),
  use_case_id: null,
  retry_count: status === 'failed' ? 1 : 0,
}));

const VOCABULARY = [...new Set(EVENT_ROWS.map((r) => r[1]))].sort().map((eventType) => ({
  eventType,
  category: eventType.split('_')[0],
  source: 'builtin',
}));

function subEvents() {
  return {
    version: 1,
    module: 'overview/sub_events',
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note: 'Synthetic: 6 personas, 20 events over ~4 days, mixed status and trigger kinds.',
    calls: [
      { cmd: 'list_personas', response: PERSONAS },
      { cmd: 'get_persona_summaries', response: [] },
      { cmd: 'list_events', response: EVENTS },
      { cmd: 'search_events', response: { events: [], has_more: false } },
      { cmd: 'list_known_event_types', response: VOCABULARY },
      {
        cmd: 'get_event_skipped_stats',
        response: {
          total: 240,
          skipped: 18,
          byEventType: [
            { eventType: 'review_submitted', total: 40, skipped: 11 },
            { eventType: 'test_event', total: 9, skipped: 7 },
          ],
        },
      },
      { cmd: 'list_saved_views_by_type', response: [] },
    ],
  };
}

/** The published roadmap payload, from the sibling personas-web checkout when present. */
function subReleases(repoRoot) {
  const published = resolve(repoRoot, '..', 'personas-web', 'public', 'roadmap', 'v1.json');
  const roadmap = existsSync(published) ? JSON.parse(readFileSync(published, 'utf8')) : null;
  return {
    version: 1,
    module: 'home/sub_releases',
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note: roadmap
      ? 'fetch_roadmap answers with personas-web/public/roadmap/v1.json as a fresh network fetch.'
      : 'personas-web checkout not found: fetch_roadmap fails offline, so the page renders the bundled roadmap.',
    calls: [
      roadmap
        ? { cmd: 'fetch_roadmap', response: { roadmap, fetchedAt: ago(4), source: 'network' } }
        : { cmd: 'fetch_roadmap', error: 'fetch failed: offline (page harness)' },
      // useWhatsNewIndicator reads the running version (Tauri app plugin).
      { cmd: 'plugin:app|version', response: JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version },
    ],
  };
}

// ---------------------------------------------------------------------------
// plugins/dev-tools/sub_triage (module 2): the Backlog panel in Overview ->
// Manual Review hosts the triage instruments. Two corpora, as in the app:
// `dev_tools_triage_ideas` is the pending queue the table shows, and
// `dev_tools_list_ideas` is the project's whole history, which feeds the rule
// suggestions (decided ideas) and the sensor scoreboard (verify states).
// ---------------------------------------------------------------------------

const TRIAGE_PROJECT = 'proj-triage';

function idea(id, title, fields = {}) {
  return {
    id, project_id: TRIAGE_PROJECT, context_id: null, scan_type: 'code_quality', category: 'technical',
    title, description: null, reasoning: null, status: 'pending', effort: 3, impact: 3, risk: 3,
    priority: null, provider: null, model: null, rejection_reason: null, origin: null, use_case_id: null,
    evidence: null, dedup_key: null, goal_id: null, verify_state: null, verify_checked_at: null,
    verify_evidence: null, plan: null, completeness: 'full', created_at: ago(60), updated_at: ago(60),
    ...fields,
  };
}

// [id, title, origin, category, effort, impact, risk, minutesAgo, evidence]
const PENDING_ROWS = [
  ['i-01', 'Sentry: TypeError in useBacklogQueue reload after project switch', 'sentry_spike', 'technical', 3, 5, 2, 8, { count: 142, users: 17, shortId: 'PERSONAS-4K' }],
  ['i-02', 'LLM spend on "athena-chat" crossed the weekly threshold', 'llm_cost', 'business', 2, 4, 1, 22, { costUsd: 12.4, calls: 318, windowDays: 7 }],
  ['i-03', 'Readiness passport: CI gate missing for the tier builds', 'passport_gap', 'technical', 4, 4, 2, 35, { dimension: 'ci', tier: 1 }],
  ['i-04', 'Standards: 14 components exceed the 200 line limit', 'standards_finding', 'technical', 5, 3, 2, 50, { violations: 14, rule: 'component-loc' }],
  ['i-05', 'KPI "weekly active agents" is off track for the third week', 'kpi_offtrack', 'business', 6, 5, 3, 80, { current: 41, target: 60 }],
  ['i-06', 'Skill "record-demo" has not run in 45 days', 'skill_dormant', 'user', 1, 2, 1, 110, { daysIdle: 45 }],
  ['i-07', 'Doc rot: build.md still describes the retired ORT fetch', 'doc_rot', 'technical', 2, 3, 1, 140, { staleDays: 61, dirtyReads: 9 }],
  ['i-08', 'Simulated KPI run: churn rises if the onboarding tour is skipped', 'kpi_sim', 'business', 7, 4, 6, 200, { deltaPct: 8.5 }],
  ['i-09', 'Athena memory disputed: "tiers ship from one bundle"', 'memory_disputed', 'user', 2, 3, 2, 260, { disputes: 3 }],
  ['i-10', 'Adopt the shared FormField across vault forms', 'workspace_practice', 'technical', 4, 3, 2, 320, null],
  ['i-11', 'Scan sweep: bindingless catch on three IO paths', 'scan_sweep', 'technical', 3, 4, 4, 400, { sites: 3 }],
  ['i-12', 'Cache the connector catalogue between vault visits', null, 'technical', 3, 4, 2, 600, null],
  ['i-13', 'Let the companion summarise a long execution log', null, 'user', 5, 4, 3, 900, null],
  ['i-14', 'Split the fleet grid into lanes by project', null, 'user', 8, 3, 7, 1300, null],
];

const PENDING_IDEAS = PENDING_ROWS.map(([id, title, origin, category, effort, impact, risk, m, evidence]) =>
  idea(id, title, {
    origin, category, effort, impact, risk,
    scan_type: origin ? 'finding' : 'code_quality',
    evidence: evidence ? JSON.stringify(evidence) : null,
    description: `${title}. Synthetic fixture for the page harness.`,
    created_at: ago(m), updated_at: ago(m),
  }));

// The decided history: enough heavy rejections, quick accepts and verdicts that
// the rule suggestions and every scoreboard column render.
const HISTORY = [
  ...[1, 2, 3, 4, 5].map((n) => idea(`h-heavy-${n}`, `Rewrite subsystem ${n}`, { status: 'rejected', effort: 7, impact: 3, category: 'performance' })),
  ...[1, 2, 3, 4].map((n) => idea(`h-quick-${n}`, `Quick fix ${n}`, { status: 'accepted', effort: 1, impact: 5 })),
  idea('h-std-1', 'Standards 1', { status: 'accepted', origin: 'standards_finding', verify_state: 'cleared' }),
  idea('h-std-2', 'Standards 2', { status: 'accepted', origin: 'standards_finding', verify_state: 'cleared' }),
  idea('h-std-3', 'Standards 3', { status: 'accepted', origin: 'standards_finding', verify_state: 'moved' }),
  idea('h-std-4', 'Standards 4', { status: 'accepted', origin: 'standards_finding', verify_state: 'unchanged' }),
  idea('h-sen-1', 'Sentry 1', { status: 'accepted', origin: 'sentry_spike', verify_state: 'unchanged' }),
  idea('h-sen-2', 'Sentry 2', { status: 'accepted', origin: 'sentry_spike', verify_state: 'unchanged' }),
  idea('h-sen-3', 'Sentry 3', { status: 'accepted', origin: 'sentry_spike', verify_state: 'regressed' }),
  idea('h-llm-1', 'LLM 1', { status: 'accepted', origin: 'llm_cost', verify_state: 'cleared' }),
  idea('h-llm-2', 'LLM 2', { status: 'accepted', origin: 'llm_cost', verify_state: 'unchanged' }),
];

const TRIAGE_RULES = [
  { id: 'rule-1', project_id: TRIAGE_PROJECT, name: 'Auto-accept quick wins', conditions: JSON.stringify([{ field: 'effort', op: 'lte', value: 2 }, { field: 'impact', op: 'gte', value: 4 }]), action: 'accept', enabled: true, times_fired: 12, created_at: ago(60 * 24 * 9) },
  { id: 'rule-2', project_id: TRIAGE_PROJECT, name: 'Reject risky rewrites', conditions: JSON.stringify([{ field: 'risk', op: 'gte', value: 7 }]), action: 'reject', enabled: false, times_fired: 3, created_at: ago(60 * 24 * 4) },
];

function subTriage() {
  const byOrigin = {};
  for (const i of PENDING_IDEAS) byOrigin[i.origin ?? 'scanner'] = (byOrigin[i.origin ?? 'scanner'] ?? 0) + 1;
  const byCategory = {};
  for (const i of PENDING_IDEAS) byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
  const project = {
    id: TRIAGE_PROJECT, name: 'personas', root_path: 'C:/work/personas', description: null, status: 'active',
    tech_stack: 'tauri,react', github_url: null, monitoring_credential_id: null, monitoring_project_slug: null,
    static_scan_config: null, auto_pr_on_success: false, pr_credential_id: null, llm_tracking_credential_id: null,
    support_credential_id: null, data_links: null, test_env_url: null, test_env_branch: null, main_branch: 'master',
    standards_config: null, team_id: null, workspace_id: null, kind: 'code', enabled: true,
    created_at: ago(60 * 24 * 90), updated_at: ago(60 * 24),
  };
  return {
    version: 1,
    module: 'plugins/dev-tools/sub_triage',
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note: 'Synthetic: 14 pending backlog ideas (11 sensor origins + 3 scanner), a decided history that yields rule suggestions and every scoreboard column, 2 triage rules.',
    calls: [
      { cmd: 'dev_tools_list_projects', response: [project] },
      { cmd: 'dev_tools_list_ideas', response: [...PENDING_IDEAS, ...HISTORY] },
      {
        cmd: 'dev_tools_triage_ideas',
        response: {
          ideas: PENDING_IDEAS, cursor: null, hasMore: false,
          counts: { total: PENDING_IDEAS.length + HISTORY.length, pending: PENDING_IDEAS.length, accepted: 13, rejected: 5, archived: 2, byOrigin, byCategory },
        },
      },
      { cmd: 'dev_tools_list_triage_rules', response: TRIAGE_RULES },
      { cmd: 'dev_tools_run_triage_rules', response: { applied: 2, ideas_affected: 5 } },
      // usePassportForProject (SweepButton): no passport assessed yet.
      { cmd: 'dev_tools_get_cross_project_metadata', response: null },
    ],
  };
}

const BUILDERS = {
  'overview/sub_events': () => subEvents(),
  'plugins/dev-tools/sub_triage': () => subTriage(),
  'plugins/dev-tools/sub_triage/leaves': () => ({ ...subTriage(), module: 'plugins/dev-tools/sub_triage/leaves' }),
  'home/sub_releases': (repoRoot) => subReleases(repoRoot),
  // WP4b tone surfaces (toneSurfaces.tsx): props are synthetic, no IPC.
  ...Object.fromEntries(['tone/health-cards', 'tone/n8n-footer', 'tone/query-toolbar'].map((id) => [
    id, () => ({ version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note: 'Synthetic props, no IPC.', calls: [] }),
  ])),
  // shoot.mjs --self-test probes: no data needed.
  '__selftest/empty': () => ({ version: 1, source: 'synthetic', recordedAt: RECORDED_AT, calls: [] }),
  '__selftest/console-error': () => ({ version: 1, source: 'synthetic', recordedAt: RECORDED_AT, calls: [] }),
};

export function syntheticModules() {
  return Object.keys(BUILDERS);
}

export function buildSyntheticTape(moduleId, repoRoot) {
  const build = BUILDERS[moduleId];
  if (!build) {
    throw new Error(`no synthetic tape for "${moduleId}" (have: ${Object.keys(BUILDERS).join(', ')}); record one with record-tape.mjs`);
  }
  return build(repoRoot);
}
