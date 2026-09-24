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

const BUILDERS = {
  'overview/sub_events': () => subEvents(),
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
