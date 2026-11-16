// console-style fan-out, partition D: synthetic tape builders for fanoutDSurfaces.tsx.
// Owned by the partition-D builder; synthetic-tapes.mjs spreads it (wired by the Director).
// Fixture CODE with fake data only; every page is shot POPULATED.
export function fanoutDTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (m) => new Date(T0 - m * 60_000).toISOString();

  // ---- overview/sub_reports: the Messages list --------------------------------
  const report = (i, persona, title, priority, read, minutes) => ({
    id: `rep-${i}`, persona_id: persona.id, execution_id: `exec-${i}`, title,
    content: `${title}\n\nA short body for the synthetic report.`, content_type: i % 3 === 0 ? 'html' : 'markdown',
    priority, is_read: read, metadata: null, created_at: ago(minutes), read_at: read ? ago(minutes - 5) : null,
    thread_id: null, use_case_id: null,
  });
  const TITLES = [
    ['Weekly pipeline health: Growth team', 'high', false, 12],
    ['Competitor pricing moved twice this month', 'normal', false, 55],
    ['Invoice mismatch of $4,210 on two lines', 'critical', false, 140],
    ['Release notes draft for 4.2', 'normal', true, 360],
    ['Uptime probe recovered after 3 failures', 'low', true, 900],
    ['Support backlog down 18% week over week', 'normal', true, 1500],
    ['Credential for stripe-live expires in 6 days', 'high', false, 2100],
    ['Monday product metrics digest', 'low', true, 3000],
  ];
  const reports = TITLES.map(([t, p, r, m], i) => report(i + 1, PERSONAS[i % PERSONAS.length], t, p, r, m));
  const reportsPage = () => ({
    version: 1, module: 'overview/sub_reports', source: 'synthetic', recordedAt: RECORDED_AT,
    note: 'Synthetic: 8 messages, mixed priority and read state.',
    calls: [
      { cmd: 'list_personas', response: PERSONAS },
      { cmd: 'list_reports', response: reports },
      { cmd: 'get_unread_report_count', response: reports.filter((r) => !r.is_read).length },
      { cmd: 'get_report_count', response: reports.length },
    ],
  });

  return { builders: { 'overview/sub_reports': reportsPage } };
}
