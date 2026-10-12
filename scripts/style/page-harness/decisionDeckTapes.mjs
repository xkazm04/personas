// Synthetic tape for the LIVE Decision Deck (decisionDeckSurfaces.tsx). Fixture
// CODE, no personal data. Every card the deck shows is dealt by the real roster
// (`useDecisionRoster`) from these IPC answers through the real adapters — the
// harness only opens the deck. Shapes are the ts-rs bindings' (AuditIncident,
// PersonaReport, CouncilSubjectState, CouncilRunDetail, DevIdea / TriagePage,
// PendingApproval, PersonaTeam, TeamChannelItem); the copy echoes the R2-C
// design record (docs/design/decision-center/r2c/) so before/after compare the
// same stories.
//
//   decision-center/deck   one module; `--kit <shot>` picks the request:
//     approval  gates chip (Athena's companion approval)
//     backlog   backlog chip (a scanner idea with scores + evidence)
//     incident  incidents chip (critical, with its branches and run link)
//     council   council chip (the verdict document, approve / send back)
//     report    reports chip, the markdown report
//     html      reports chip, focused on the HTML report
//     chat      chat chip (a team thread ending on a question)

const REPORT_MD = `# Weekly pipeline health — Growth team

The Growth team shipped **14 of 17** planned runs this week. Three runs were held at review gates, two of them for more than a day.

## Throughput

| Persona | Runs | Success | Median cost |
|---|---|---|---|
| Outreach Writer | 42 | 95% | $0.04 |
| Lead Researcher | 31 | 87% | $0.11 |
| CRM Sync | 120 | 99% | $0.01 |

## What needs you

1. **Lead Researcher** keeps failing on LinkedIn rate limits — consider a slower schedule.
2. The **Outreach Writer** draft for ACME has been waiting 26h at a gate.

> Recommendation: approve the schedule change below and clear the ACME gate today.

## Detail

Each failure was traced to one of three causes: provider rate limits (61%), expired credentials (27%), and a prompt regression in the qualification step (12%). The regression was introduced on Tuesday and rolled back on Thursday.
`;

const COUNCIL_MD = `# Council verdict — Unified Decision Center (architecture)

**Overall: 7.4 / 10 — ready, with two must-address items.**

## Members

| Member | Dimension | Score | Stance |
|---|---|---|---|
| Value | user value | 8.5 | strong yes |
| Craft | design quality | 7.0 | yes, if the modal is one family |
| Robustness | failure modes | 7.5 | yes |
| Economics | cost to build | 6.0 | concerned |

## Must address

1. **One roster or none.** Three item models coexist today; shipping a fourth would make the counts disagree.
2. **Failed is not empty.** A source that did not answer must not render as zero.

## Synthesis

The council supports the consolidation. The strongest objection (Economics) is about the round's size, not its direction.
`;

const REPORT_HTML = `<!doctype html><html><head><style>
  body{font-family:Georgia,serif;margin:0;padding:48px 56px;color:#1d2433;background:#fbfaf7;line-height:1.6}
  h1{font-size:34px;margin:0 0 4px;letter-spacing:-.01em}
  .kicker{text-transform:uppercase;letter-spacing:.14em;font:600 11px system-ui;color:#8a6d3b}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}
  .stat{background:#fff;border:1px solid #e7e2d6;border-radius:12px;padding:16px}
  .stat b{display:block;font:700 28px system-ui;color:#1d2433}
  .stat span{font:12px system-ui;color:#6b7280}
  blockquote{border-left:3px solid #8a6d3b;margin:24px 0;padding:4px 16px;color:#4a5568;font-style:italic}
  table{border-collapse:collapse;width:100%;font:14px system-ui}
  td,th{border-bottom:1px solid #e7e2d6;padding:8px;text-align:left}
</style></head><body>
  <div class="kicker">Market scan · Q4</div>
  <h1>Competitor pricing moved twice this month</h1>
  <p>Three of five tracked competitors changed their entry tier. Two moved <em>down</em>, which narrows our headroom on the Team plan.</p>
  <div class="grid">
    <div class="stat"><b>−18%</b><span>Avg. entry price change</span></div>
    <div class="stat"><b>3 / 5</b><span>Competitors repriced</span></div>
    <div class="stat"><b>72%</b><span>Confidence in the scan</span></div>
  </div>
  <blockquote>Suggested next step: hold our price, add a usage-based add-on, and re-scan in two weeks.</blockquote>
  <table><tr><th>Competitor</th><th>Old</th><th>New</th></tr>
  <tr><td>Northwind</td><td>$29</td><td>$24</td></tr>
  <tr><td>Contoso</td><td>$35</td><td>$27</td></tr>
  <tr><td>Fabrikam</td><td>$19</td><td>$22</td></tr></table>
</body></html>`;

export function decisionDeckTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

  const counts = {
    goalAcceptance: 0, manualReviews: 0, ideas: 2, policyProposals: 0, promotionProposals: 0,
    openIncidents: 2, blockingIncidents: 1, unreadReports: 2, companionApprovals: 2,
    councilDecidable: 1, decisionTotal: 0, total: 0,
  };

  const approvals = [
    { id: 'ap-1', action: 'create_goal', rationale: 'The retry budget keeps coming up in three teams this week. A goal would give it one owner and one deadline instead of three half-fixes.', paramsJson: '{"title":"Cap retries at 3 per run","project":"Growth"}', humanReviewId: null, createdAt: ago(47) },
    { id: 'ap-2', action: 'write_fact', rationale: 'You said the staging deploys move to Thursdays.', paramsJson: '{}', humanReviewId: null, createdAt: ago(180) },
  ];

  const incident = (id, severity, title, detail, minutes, over = {}) => ({
    id, sourceTable: 'tool_execution_audit_log', sourceId: `src-${id}`, dedupKey: `audit:${id}`,
    personaId: 'p-research', personaName: 'Market Research Analyst With A Long Descriptive Name', executionId: `exec-${id}`,
    severity, kind: 'credential_expired', title, detail, status: 'open',
    acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolutionNote: null, continuedAt: null,
    createdAt: ago(minutes), ...over,
  });
  const incidents = [
    incident('inc-1', 'critical', 'Lead Researcher: credential expired (LinkedIn)', 'Three consecutive runs failed with `401 Unauthorized` from the LinkedIn connector. The OAuth token expired at 09:12.', 240),
    incident('inc-2', 'medium', 'Invoice Reconciler: slow responses from the ledger API', 'Median latency rose from 400 ms to 2.1 s over the last hour.', 35, { personaId: 'p-finance', personaName: 'Invoice Reconciler', kind: 'latency' }),
  ];

  const report = (id, personaId, title, content, contentType, priority, minutes) => ({
    id, persona_id: personaId, execution_id: `exec-${id}`, title, content, content_type: contentType,
    priority, is_read: false, metadata: null, created_at: ago(minutes), read_at: null, thread_id: null, use_case_id: null,
  });
  const reports = [
    report('rep-md', 'p-release', 'Weekly pipeline health — Growth team', REPORT_MD, 'markdown', 'high', 95),
    report('rep-html', 'p-research', 'Competitor pricing moved twice this month', REPORT_HTML, 'html', 'normal', 300),
  ];

  const subject = {
    id: 'cs-1', projectId: 'proj-harness', kind: 'architecture', useCaseId: null, slug: 'decision-center',
    title: 'Unified Decision Center (architecture)', state: 'ready', tier: 'major', roundNo: 2, latestRunId: 'run-2',
    outcome: 'ready', overall: 0.74, coverage: 0.9, trustState: 'trusted', floorHits: 0, hardFailures: 0, drift: 'none',
    projectName: 'Personas', registrySubjects: [], runDir: null, finishedAt: ago(130), decidedAt: null, rejectionReason: null,
  };
  const runDetail = {
    run: {
      id: 'run-2', subjectId: 'cs-1', roundNo: 2, supersedesRunId: 'run-1', rubricVersion: 'v3', trustState: 'trusted',
      outcome: 'ready', overall: 0.74, coverage: 0.9, headSha: 'abc123', spanDigest: 'span-1', spannedPathsJson: '[]',
      hardFailuresJson: '[]', mustAddressJson: '[]', summary: COUNCIL_MD, summaryIsSubjectFallback: false,
      runDir: 'councils/cs-1/run-2', startedAt: ago(150), finishedAt: ago(130), ingestedAt: ago(129),
    },
    subject: { id: 'cs-1', projectId: 'proj-harness', kind: 'architecture', slug: 'decision-center', title: subject.title },
    verdicts: [],
    sawDigest: 'digest-run-2',
    isLatest: true,
    decision: null,
  };

  const idea = (id, title, description, effort, impact, risk, minutes, over = {}) => ({
    id, project_id: 'proj-harness', context_id: null, scan_type: 'architecture', category: 'performance', title, description,
    reasoning: 'Raised by the weekly architecture scan after the third timeout on the same query.', status: 'pending',
    effort, impact, risk, priority: null, provider: 'claude', model: 'opus', rejection_reason: null, origin: 'scan',
    use_case_id: null, evidence: 'src/features/overview/sub_usage/useUsageRollup.ts:88\n  const rows = await listExecutions({ limit: 5000 });',
    dedup_key: null, goal_id: null, verify_state: null, verify_checked_at: null, verify_evidence: null, plan: null,
    completeness: null, created_at: ago(minutes), updated_at: ago(minutes), ...over,
  });
  const ideas = [
    idea('idea-1', 'Roll usage up in SQL instead of loading 5,000 executions', 'The usage dashboard loads every execution of the last 30 days into the webview and sums them in JavaScript. A grouped query returns the same rollup in one round trip and keeps the tab responsive past 10k runs.', 3, 8, 2, 600),
    idea('idea-2', 'Cache connector catalog icons', 'Icons are re-fetched on every catalog open.', 2, 4, 1, 1400),
  ];

  const team = {
    id: 'team-growth', project_id: 'proj-harness', parent_team_id: null, name: 'Growth team', description: null,
    canvas_data: null, team_config: null, icon: null, color: '#06b6d4', enabled: true, shared_instructions: null,
    default_model_profile: null, default_max_budget_usd: null, default_max_turns: null,
    created_at: ago(60 * 24 * 40), updated_at: ago(60 * 24),
  };
  const line = (id, kind, minutes, body, personaId = null, label = '') => ({
    id, kind, at: ago(minutes), personaId, label, body, assignmentId: null, stepId: null, extra: null,
    replyTo: null, deliberationId: null, importance: null, consumers: null,
  });
  // Newest first, as `list_team_channel` returns it.
  const channel = [
    line('tc-5', 'persona', 6, 'Draft is ready. Before I send it: do you want the **pricing table** in the first email, or only after they reply? Sending it up front doubled replies last quarter but also doubled unsubscribes.', 'p-release', 'Release Notes Writer'),
    line('tc-4', 'athena', 18, 'I checked the CRM: ACME opened the last two emails but did not click. A shorter subject line may help.'),
    line('tc-3', 'directive', 25, 'Go ahead with the ACME follow-up, keep it under 120 words.'),
    line('tc-2', 'persona', 70, 'ACME has not answered the proposal in five days. I can draft a follow-up.', 'p-release', 'Release Notes Writer'),
    line('tc-1', 'persona', 140, 'Weekly outreach batch sent: 42 emails, 3 replies so far.', 'p-triage', 'Inbox Triage'),
  ];

  const calls = [
    { cmd: 'list_personas', response: PERSONAS },
    { cmd: 'dev_tools_pending_counts', response: counts },
    { cmd: 'companion_list_pending_approvals', response: approvals },
    { cmd: 'list_audit_incidents', response: incidents },
    { cmd: 'list_unread_reports', response: reports },
    { cmd: 'dev_tools_council_list_subjects', response: [subject] },
    { cmd: 'dev_tools_council_get_run', response: runDetail },
    { cmd: 'dev_tools_triage_ideas', response: { ideas, cursor: null, hasMore: false, counts: {} } },
    { cmd: 'list_teams', response: [team] },
    { cmd: 'get_team_counts', response: [{ team_id: team.id, member_count: 3, connection_count: 2 }] },
    { cmd: 'list_team_channel', response: channel },
  ];

  return {
    builders: {
      'decision-center/deck': () => ({
        version: 1,
        module: 'decision-center/deck',
        source: 'synthetic',
        recordedAt: RECORDED_AT,
        note: 'Synthetic: every decision source the roster reads, one or two rows each; --kit <approval|backlog|incident|council|report|html|chat> picks the deck request.',
        calls,
      }),
    },
  };
}
