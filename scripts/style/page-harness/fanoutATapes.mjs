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
  const mk = (module, note, extra = []) => () => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls: [...personaCalls, ...extra] });
  return {
    builders: {
      'agents/editor-activity': mk('agents/editor-activity', 'Synthetic: Inbox Triage with 14 runs and a trigger.'),
      'agents/editor-design': mk('agents/editor-design', 'Synthetic: Inbox Triage, Design tab.'),
      'agents/editor-settings': mk('agents/editor-settings', 'Synthetic: Inbox Triage, Settings tab.'),
      'triggers/live-stream': mk('triggers/live-stream', 'Synthetic: Events live stream, 10 events.'),
      'triggers/studio': mk('triggers/studio', 'Synthetic: Events studio, 5 triggers.'),
      'agents/editor-lab': mk('agents/editor-lab', 'Synthetic: agents/editor-lab.'),
      'agents/editor-matrix': mk('agents/editor-matrix', 'Synthetic: agents/editor-matrix.'),
      'agents/editor-chat': mk('agents/editor-chat', 'Synthetic: agents/editor-chat.'),
      'triggers/rate-limits': mk('triggers/rate-limits', 'Synthetic: triggers/rate-limits.'),
      'triggers/test': mk('triggers/test', 'Synthetic: triggers/test.'),
      'triggers/smee-relay': mk('triggers/smee-relay', 'Synthetic: triggers/smee-relay.'),
      'triggers/dead-letter': mk('triggers/dead-letter', 'Synthetic: triggers/dead-letter.'),
      'triggers/shared': mk('triggers/shared', 'Synthetic: triggers/shared.'),
    },
  };
}
