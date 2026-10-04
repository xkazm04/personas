// Synthetic IPC tapes for the Overview > Executions surface (kit batch
// overview-1): the Activity ledger, the per-call LLM table and the Metrics
// dashboard, all three lenses over the same `list_all_executions` stream.
//
// Shapes come from the bindings: `GlobalExecutionListItem` (the lean row the
// two tables draw) and `ExecutionCounts` (the filter-bar badges). Every
// timestamp is an offset from RECORDED_AT, which the shooter also uses as the
// frozen page clock, so the Today / Yesterday grouping and every "5 min ago"
// read the same on every run.
//
// `get_execution_dashboard` is deliberately absent: the Metrics tab's data is
// an ExecutionDashboardData tree whose own fixture is a separate piece of work,
// and the tape player answers an absent command with a neutral default, so the
// Metrics view renders its chrome plus its KPI ghosts. That is enough to judge
// the shared header on that tab, which is what batch overview-1 changed. Enrich
// this builder when the Metrics body itself comes up for a gate.

/** [minutesAgo, personaId, status, model, thinking, inTok, outTok, costUsd, durationMs] */
const EXEC_ROWS = [
  [2, 'p-triage', 'running', 'claude-opus-4-20250514', 'high', 18400, 0, null, null],
  [6, 'p-review', 'running', 'claude-sonnet-4-20250514', null, 9100, 0, null, null],
  [11, 'p-release', 'completed', 'claude-sonnet-4-20250514', 'medium', 24300, 3120, 0.1842, 41200],
  [19, 'p-monitor', 'failed', 'claude-haiku-4-20250514', null, 2100, 180, 0.0041, 8600],
  [28, 'p-research', 'completed', 'claude-opus-4-20250514', 'high', 118700, 14900, 2.4713, 213400],
  [37, 'p-finance', 'completed', 'claude-sonnet-4-20250514', null, 15600, 2210, 0.0981, 27400],
  [52, 'p-triage', 'completed', 'claude-haiku-4-20250514', null, 3400, 410, 0.0062, 5100],
  [68, 'p-review', 'cancelled', 'claude-sonnet-4-20250514', 'low', 7200, 0, null, 3200],
  [84, 'p-release', 'completed', 'claude-sonnet-4-20250514', null, 31800, 5240, 0.2614, 63900],
  [103, 'p-monitor', 'completed', null, null, 1800, 240, 0.0028, 4300],
  [126, 'p-research', 'incomplete', 'claude-opus-4-20250514', 'max', 94200, 1100, 1.4208, 184600],
  [154, 'p-finance', 'failed', 'claude-sonnet-4-20250514', null, 6400, 90, 0.0213, 11800],
  [188, 'p-triage', 'completed', 'claude-haiku-4-20250514', null, 2900, 380, 0.0054, 4800],
  [240, 'p-review', 'completed', 'claude-sonnet-4-20250514', 'medium', 22100, 4030, 0.1733, 48200],
  [60 * 19, 'p-release', 'completed', 'claude-sonnet-4-20250514', null, 28400, 4810, 0.2281, 57300],
  [60 * 21, 'p-monitor', 'failed', 'claude-haiku-4-20250514', null, 2200, 120, 0.0039, 9100],
  [60 * 23, 'p-research', 'completed', 'claude-opus-4-20250514', 'high', 102300, 12700, 2.1104, 198700],
  [60 * 25, 'p-finance', 'completed', 'claude-sonnet-4-20250514', null, 17900, 2480, 0.1142, 31600],
  [60 * 27, 'p-triage', 'completed', 'claude-haiku-4-20250514', null, 3100, 420, 0.0058, 5200],
  [60 * 44, 'p-review', 'completed', 'claude-sonnet-4-20250514', null, 19800, 3340, 0.1521, 42900],
  [60 * 49, 'p-release', 'cancelled', 'claude-sonnet-4-20250514', null, 4200, 0, null, 2100],
  [60 * 52, 'p-monitor', 'completed', 'claude-haiku-4-20250514', null, 1900, 260, 0.0031, 4500],
  [60 * 70, 'p-research', 'completed', 'claude-opus-4-20250514', 'medium', 88400, 10200, 1.8346, 171300],
  [60 * 74, 'p-finance', 'incomplete', 'claude-sonnet-4-20250514', null, 12300, 640, 0.0712, 24800],
  [60 * 96, 'p-triage', 'completed', 'claude-haiku-4-20250514', null, 3300, 440, 0.0061, 5400],
];

/**
 * @param {{ RECORDED_AT: string, PERSONAS: Array<{ id: string, name: string, icon: string | null, color: string | null }> }} ctx
 */
export function activityTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const byId = new Map(PERSONAS.map((p) => [p.id, p]));

  const rows = EXEC_ROWS.map(([m, personaId, status, model, thinking, inTok, outTok, cost, duration], i) => {
    const p = byId.get(personaId);
    return {
      id: `exec-${String(i + 1).padStart(3, '0')}`,
      personaId,
      status,
      modelUsed: model,
      thinkingLevel: thinking,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: cost,
      durationMs: duration,
      startedAt: ago(m),
      createdAt: ago(m + 0.1),
      personaName: p?.name ?? null,
      personaIcon: p?.icon ?? null,
      personaColor: p?.color ?? null,
    };
  });

  const counts = {
    total: rows.length,
    running: rows.filter((r) => r.status === 'running' || r.status === 'pending').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    incomplete: rows.filter((r) => r.status === 'incomplete').length,
  };

  const tape = (moduleId, note) => ({
    version: 1,
    module: moduleId,
    source: 'synthetic',
    recordedAt: RECORDED_AT,
    note,
    calls: [
      { cmd: 'list_personas', response: PERSONAS },
      { cmd: 'get_persona_summaries', response: [] },
      // Wildcard: the list is re-requested per status filter / page, and every
      // window answers from the same 25 rows (the table filters client-side on
      // top of the status param).
      { cmd: 'list_all_executions', response: rows },
      { cmd: 'count_executions', response: counts },
    ],
  });

  const NOTE = 'Synthetic: 6 personas, 25 executions over ~4 days, every status bucket, two runs still in flight, unknown cost and unknown model each represented.';

  return {
    builders: {
      'overview/sub_activity': () => tape('overview/sub_activity', `${NOTE} Activity tab.`),
      'overview/sub_activity/calls': () => tape('overview/sub_activity/calls', `${NOTE} Calls tab.`),
      'overview/sub_activity/metrics': () => tape(
        'overview/sub_activity/metrics',
        `${NOTE} Metrics tab; get_execution_dashboard is absent on purpose (see the file header), so the body shows its KPI ghosts.`,
      ),
    },
  };
}
