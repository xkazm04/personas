// console-style fan-out, partition E: synthetic tape builders for fanoutESurfaces.tsx.
// Owned by the partition-E builder; synthetic-tapes.mjs spreads it (wired by the Director).
// Vault pages reuse the vault/credentials tape; the templates tabs add a populated design-review
// catalog and recipe list; settings tabs render from local state, so their tapes carry little IPC.
import { consoleStyleTapes } from './consoleStyleTapes.mjs';

export function fanoutETapes({ RECORDED_AT, PERSONAS }) {
  const base = consoleStyleTapes({ RECORDED_AT, PERSONAS }).builders;
  const T0 = Date.parse(RECORDED_AT);
  const ago = (d) => new Date(T0 - d * 86_400_000).toISOString();

  const NAMES = [
    ['Inbox Triage', 'email', ['gmail', 'slack'], 'manual'], ['Release Notes Writer', 'development', ['github', 'notion'], 'webhook'],
    ['Uptime Watch', 'monitoring', ['sentry', 'slack'], 'schedule'], ['Invoice Matcher', 'finance', ['stripe', 'postgres'], 'schedule'],
    ['PR Reviewer', 'development', ['github'], 'webhook'], ['Support First Line', 'support', ['slack', 'notion'], 'event'],
    ['Weekly Metrics Digest', 'analytics', ['supabase', 'slack'], 'schedule'], ['Competitor Brief', 'research', ['notion', 'openai'], 'schedule'],
  ];
  const REVIEWS = NAMES.map(([name, category, connectors, trigger], i) => ({
    id: `rv-${i}`, test_case_id: `tc-${i}`, test_case_name: name, instruction: `${name}: a persona template that handles the routine end to end.`,
    status: 'passed', structural_score: 80 + i, semantic_score: 74 + i * 2, connectors_used: JSON.stringify(connectors),
    trigger_types: JSON.stringify([trigger]), design_result: null, structural_evaluation: null, semantic_evaluation: null,
    test_run_id: 'run-1', had_references: false, suggested_adjustment: null, adjustment_generation: 0, use_case_flows: null,
    reviewed_at: ago(i + 1), created_at: ago(30 - i), adoption_count: [42, 18, 31, 7, 25, 12, 9, 3][i], last_adopted_at: ago(i), category,
  }));
  const templates = (id) => () => ({
    ...base['vault/credentials'](), module: id,
    note: 'Synthetic: 8 design reviews with connectors/categories, 6 recipes, credentials and connector definitions.',
    calls: [
      ...base['vault/credentials']().calls,
      { cmd: 'list_design_reviews_paginated', response: { items: REVIEWS, total: REVIEWS.length } },
      { cmd: 'count_design_reviews', response: REVIEWS.length },
      { cmd: 'list_review_connectors', response: [{ name: 'slack', count: 4 }, { name: 'github', count: 3 }, { name: 'notion', count: 3 }, { name: 'sentry', count: 1 }] },
      { cmd: 'list_review_categories', response: [{ name: 'development', count: 2 }, { name: 'monitoring', count: 1 }, { name: 'email', count: 1 }, { name: 'finance', count: 1 }] },
      { cmd: 'get_trending_templates', response: REVIEWS.slice(0, 3) },
      { cmd: 'list_recipes', response: ['Summarise a thread', 'Draft a changelog', 'Triage an alert', 'Match invoice lines', 'Review a diff', 'Weekly digest'].map((name, i) => ({
        id: `rc-${i}`, project_id: 'p', credential_id: null, use_case_id: null, name, description: `${name} from the recipe library.`, category: ['writing', 'development', 'monitoring', 'finance', 'development', 'analytics'][i],
        prompt_template: 'Do the thing.', input_schema: null, output_contract: null, tool_requirements: null, credential_requirements: null, model_preference: null, sample_inputs: null,
        tags: JSON.stringify(['starter']), icon: null, color: null, is_builtin: i < 4, created_at: ago(20), updated_at: ago(2), source_template_id: null, source_use_case_id: null, source_use_case_name: null, source_version: null,
      })) },
    ],
  });
  const DEVICES = [['peer-laptop', 'Studio laptop', true], ['peer-tower', 'Desk tower', false]].map(([peerId, displayName, isHome], i) => ({
    peerId, deviceGroupId: 'grp-1', displayName, addedAt: ago(30 - i * 5), lastSyncedAt: ago(0.01 * (i + 1)), isHome, pairedAt: ago(30 - i * 5), publicKey: 'pk-' + peerId,
  }));
  const devices = (id) => () => ({
    version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note: 'Synthetic: two owned devices, one peer discovered.',
    calls: [
      { cmd: 'get_network_status', response: { is_running: true, listening_port: 4242, discovered_peer_count: 1, connected_peer_count: 1, local_peer_id: 'peer-local', identity_degraded: false } },
      { cmd: 'get_local_identity', response: { peer_id: 'peer-local', public_key_b64: 'cGs=', display_name: 'This machine', created_at: ago(60) } },
      { cmd: 'list_owned_devices', response: DEVICES },
      { cmd: 'list_pending_device_pairings', response: [] },
      { cmd: 'get_discovered_peers', response: [] },
    ],
  });
  const withSettings = (id) => () => ({
    version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note: 'Settings tab: app settings answered empty, chart data empty.',
    calls: [
      { cmd: 'get_app_settings_bulk', response: {} },
      { cmd: 'get_metrics_chart_data', response: { chart_points: [], persona_breakdown: [], anomalies: [] } },
    ],
  });
  const vault = (id) => () => ({ ...base['vault/credentials'](), module: id });
  const bare = (id, note) => () => ({ version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note, calls: [] });
  return {
    builders: {
      'vault/catalog': vault('vault/catalog'),
      'vault/add-new': vault('vault/add-new'),
      'vault/databases': vault('vault/databases'),
      'templates/generated': templates('templates/generated'),
      'templates/recipes': templates('templates/recipes'),
      'templates/n8n': templates('templates/n8n'),
      'settings/notifications': withSettings('settings/notifications'),
      'settings/api-keys': bare('settings/api-keys', 'Settings tab.'),
      'settings/devices': devices('settings/devices'),
      'settings/limits': withSettings('settings/limits'),
    },
  };
}
