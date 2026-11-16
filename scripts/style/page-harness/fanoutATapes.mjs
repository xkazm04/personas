// console-style fan-out, partition A: synthetic tape builders for fanoutASurfaces.tsx.
// Owned by the partition-A builder; synthetic-tapes.mjs spreads it. Fixture CODE with fake data only.
//
//   agents/editor-*    persona editor on "Inbox Triage": 14 runs (ok, failed, running), events, a trigger
//   triggers/live-stream, triggers/studio   the Events page with 10 events and 5 triggers
export function fanoutATapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (m) => new Date(T0 - m * 60_000).toISOString();
  const P = PERSONAS[0];
  const ROSTER = PERSONAS.map((p, i) => ({ ...p, description: ['Sorts incoming mail into action, wait and archive.', 'Drafts release notes from merged pull requests.', 'Pings endpoints every minute.', 'Compiles weekly market briefs.', 'Reviews pull requests.', 'Matches invoices to bank lines.'][i] }));

  const STATUS = ['completed', 'completed', 'failed', 'completed', 'running', 'completed', 'completed', 'failed', 'completed', 'completed', 'completed', 'cancelled', 'completed', 'completed'];
  const ORIGIN = ['scheduled', 'manual', 'channel', 'scheduled', 'manual', 'scheduled', 'attention', 'scheduled', 'manual', 'scheduled', 'channel', 'manual', 'scheduled', 'scheduled'];
  const runs = STATUS.map((status, i) => ({
    id: `ex-${i}`, persona_id: P.id, trigger_id: i % 2 ? 'tr-1' : null, use_case_id: null, status,
    input_data: null, output_data: status === 'completed' ? 'Sorted 42 messages: 9 action, 12 wait, 21 archive.' : null,
    claude_session_id: null, log_file_path: null, execution_flows: null, model_used: 'claude-sonnet-4-5', thinking_level: 'medium',
    input_tokens: 4200 + i * 310, output_tokens: 900 + i * 40, cost_usd: 0.04 + i * 0.011,
    cache_read_tokens: 1200, cache_creation_tokens: 300,
    error_message: status === 'failed' ? 'Connector Gmail returned 401: token expired' : null,
    duration_ms: 8000 + i * 2300, tool_steps: null, retry_of_execution_id: null, retry_count: 0,
    started_at: ago(12 + i * 95), completed_at: status === 'running' ? null : ago(11 + i * 95), created_at: ago(12 + i * 95),
    execution_config: null, is_simulation: false, business_outcome: 'unknown', origin: ORIGIN[i], origin_lane: null,
  }));
  const EVENT_TYPES = [['webhook_received', 'webhook', 'delivered'], ['execution_completed', 'persona', 'delivered'], ['schedule_tick', 'schedule', 'delivered'], ['execution_failed', 'persona', 'failed'], ['webhook_received', 'webhook', 'pending'], ['file_changed', 'file_watcher', 'delivered'], ['schedule_tick', 'schedule', 'delivered'], ['execution_completed', 'persona', 'delivered'], ['webhook_received', 'webhook', 'skipped'], ['persona_action', 'persona', 'delivered']];
  const events = EVENT_TYPES.map(([event_type, source_type, status], i) => ({
    id: `ev-${i}`, project_id: 'proj-harness', event_type, source_type, source_id: `src-${i % 3}`,
    target_persona_id: PERSONAS[i % PERSONAS.length].id, payload: JSON.stringify({ ref: `refs/heads/main`, count: i + 3 }),
    status, error_message: status === 'failed' ? 'Target persona timed out' : null,
    processed_at: status === 'pending' ? null : ago(3 + i * 41), created_at: ago(3 + i * 41), use_case_id: null, retry_count: status === 'failed' ? 2 : 0,
  }));
  const trig = (id, personaId, type, config, status, lastMin, nextMin) => ({
    id, persona_id: personaId, trigger_type: type, config: JSON.stringify(config), enabled: status === 'active', status,
    last_triggered_at: lastMin == null ? null : ago(lastMin), next_trigger_at: nextMin == null ? null : new Date(T0 + nextMin * 60_000).toISOString(),
    trigger_version: 3, created_at: ago(60 * 24 * 20), updated_at: ago(60 * 24), use_case_id: null,
  });
  const triggers = [
    trig('tr-1', 'p-triage', 'schedule', { cron: '*/15 * * * *' }, 'active', 4, 11),
    trig('tr-2', 'p-release', 'webhook', { path: '/hooks/release' }, 'active', 130, null),
    trig('tr-3', 'p-monitor', 'polling', { interval_seconds: 60 }, 'active', 1, 0.5),
    trig('tr-4', 'p-review', 'event_listener', { event_type: 'pull_request_opened' }, 'errored', 600, null),
    trig('tr-5', 'p-finance', 'schedule', { cron: '0 8 * * 1' }, 'paused', 60 * 24 * 6, null),
  ];

  const personaCalls = [
    { cmd: 'list_personas', response: ROSTER },
    { cmd: 'get_persona', response: ROSTER[0] },
    { cmd: 'get_persona_detail', response: { ...ROSTER[0], tools: [], triggers: triggers.filter((t) => t.persona_id === 'p-triage'), subscriptions: [], automations: [] } },
    { cmd: 'list_triggers', response: triggers.filter((t) => t.persona_id === 'p-triage') },
    { cmd: 'list_all_triggers', response: triggers },
    { cmd: 'list_executions', response: runs },
    { cmd: 'list_executions_summary', response: runs },
    { cmd: 'count_executions', response: { total: 14, completed: 10, failed: 2, running: 1, cancelled: 1 } },
    { cmd: 'search_events', response: { events, has_more: false } },
    { cmd: 'list_events', response: events },
    { cmd: 'get_trigger_health_map', response: { 'tr-1': 'healthy', 'tr-2': 'healthy', 'tr-3': 'degraded', 'tr-4': 'failing' } },
  ];
  const versions = [3, 2, 1].map((n, i) => ({
    id: `pv-${n}`, persona_id: 'p-triage', version_number: n, structured_prompt: null, system_prompt: 'You triage incoming mail.',
    change_summary: ['Tighter archive rules', 'Add wait bucket', 'First draft'][i], tag: n === 2 ? 'production' : n === 3 ? 'experimental' : 'archived',
    created_at: ago(60 * 24 * (i + 1) * 3), core_profile: null,
  }));
  const labCalls = [
    { cmd: 'lab_get_versions', response: versions },
    { cmd: 'lab_get_version_ratings', response: [] },
    { cmd: 'lab_get_version_economics', response: [] },
    { cmd: 'lab_get_active_progress', response: [] },
    { cmd: 'lab_get_score_weights', response: { toolAccuracy: 0.4, outputQuality: 0.4, protocolCompliance: 0.2 } },
    { cmd: 'list_persona_responsibilities', response: [] },
  ];
  const feeds = [['gh-releases', 'GitHub releases', 'dev', 'Fires when a watched repo cuts a release.'], ['fx-rates', 'ECB FX rates', 'finance', 'Daily euro reference rates.'], ['status-aws', 'AWS status', 'ops', 'Incidents on the public status page.'], ['cve-feed', 'CVE feed', 'security', 'New critical advisories.']].map(([slug, name, category, description], i) => ({
    id: `se-${i}`, slug, name, description, category, publisher: 'Personas Cloud', icon: null, color: null, samplePayload: '{"ref":"main"}', eventSchema: null,
    subscriberCount: 120 + i * 37, isFeatured: i < 2, status: 'active', cloudUpdatedAt: ago(60 * 5), cachedAt: ago(30),
  }));
  const sharedCalls = [
    { cmd: 'shared_events_browse_catalog', response: feeds },
    { cmd: 'shared_events_list_subscriptions', response: [{ id: 'sub-1', catalogEntryId: 'se-0', slug: 'gh-releases', enabled: true, lastCursor: null, eventsRelayed: 14, lastEventAt: ago(90), error: null, createdAt: ago(60 * 24 * 9), updatedAt: ago(90) }] },
    { cmd: 'shared_events_change_activity', response: [{ slug: 'gh-releases', changeCount: 14, lastFiredAt: ago(90), lastPayload: '{"tag":"v2.4.1"}' }, { slug: 'cve-feed', changeCount: 3, lastFiredAt: ago(600), lastPayload: '{"id":"CVE-2026-1042"}' }] },
    { cmd: 'shared_events_list_project_routes', response: [] },
    { cmd: 'list_pending_trigger_fires', response: [] },
  ];
  const mk = (module, note, extra = []) => () => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls: [...personaCalls, ...extra] });
  return {
    builders: {
      'agents/editor-activity': mk('agents/editor-activity', 'Synthetic: Inbox Triage with 14 runs and a trigger.'),
      'agents/editor-design': mk('agents/editor-design', 'Synthetic: Inbox Triage, Design tab.'),
      'agents/editor-settings': mk('agents/editor-settings', 'Synthetic: Inbox Triage, Settings tab.'),
      'triggers/live-stream': mk('triggers/live-stream', 'Synthetic: Events live stream, 10 events.'),
      'triggers/studio': mk('triggers/studio', 'Synthetic: Events studio, 5 triggers.'),
      'agents/editor-lab': mk('agents/editor-lab', 'Synthetic: Inbox Triage, Lab tab, 3 prompt versions.', labCalls),
      'agents/editor-matrix': mk('agents/editor-matrix', 'Synthetic: agents/editor-matrix.'),
      'agents/editor-chat': mk('agents/editor-chat', 'Synthetic: agents/editor-chat.'),
      'triggers/rate-limits': mk('triggers/rate-limits', 'Synthetic: triggers/rate-limits.'),
      'triggers/test': mk('triggers/test', 'Synthetic: triggers/test.'),
      'triggers/smee-relay': mk('triggers/smee-relay', 'Synthetic: triggers/smee-relay.'),
      'triggers/dead-letter': mk('triggers/dead-letter', 'Synthetic: triggers/dead-letter.'),
      'triggers/shared': mk('triggers/shared', 'Synthetic: shared event feeds watchtower.', sharedCalls),
    },
  };
}
