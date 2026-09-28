// Synthetic tapes for kit batch home-2, Home > Cockpit and the two other places its widgets
// render (Athena chat inline cards, the Curator council evidence well); the views are in
// homeCockpitSurfaces.tsx. Shapes follow the TS bindings (Persona, MetricsSummary,
// PersonaExecution, PersonaManualReview, PersonaMemory, CouncilMedia) and the companion API
// types (CompanionCockpitSpec, CompanionTemplateMatch, CompanionDesignDecision). Widget
// configs follow each widget's own parser and the compose_cockpit / explain_in_cockpit
// doctrine in src-tauri/src/companion/templates/constitution.md. Counts are the LARGEST
// realistic ones (doctrine 8a): a 40-persona fleet, 31 inbox items, 12 issues.
// Fixture CODE, no personal data.
import { deflateSync } from 'node:zlib';

const PROJECT = 'proj-harness';

// [id, name, model, trust, setup, enabled, budget]
const FLEET = [
  ['p-triage', 'Inbox Triage', 'claude-haiku-4-5', 0.94, 'ready', true, 0.5],
  ['p-release', 'Release Notes Writer', 'claude-sonnet-4-6', 0.91, 'ready', true, 2],
  ['p-monitor', 'Uptime Sentinel', 'claude-haiku-4-5', 0.88, 'ready', true, 0.25],
  ['p-research', 'Market Research Analyst With A Long Descriptive Name', 'claude-opus-4-7', 0.83, 'ready', true, 12],
  ['p-review', 'Code Review Buddy', 'claude-sonnet-4-6', 0.9, 'ready', true, 4],
  ['p-finance', 'Invoice Reconciler', 'claude-sonnet-4-6', 0.62, 'ready', true, 3],
  ['p-support', 'Support Ticket Router', 'claude-haiku-4-5', 0.86, 'ready', true, 1],
  ['p-digest', 'Morning Digest', 'claude-sonnet-4-6', 0.95, 'ready', true, 0.8],
  ['p-sentry', 'Sentry Spike Watcher', 'claude-haiku-4-5', 0.79, 'ready', true, 0.4],
  ['p-standup', 'Standup Summariser', 'claude-haiku-4-5', 0.92, 'ready', true, 0.3],
  ['p-hiring', 'Candidate Screener', 'claude-opus-4-7', 0.74, 'needs_credentials', true, 6],
  ['p-social', 'Social Listening Scout', 'claude-sonnet-4-6', 0.81, 'ready', true, 2.5],
  ['p-seo', 'SEO Content Auditor', 'claude-sonnet-4-6', 0.77, 'ready', false, 2],
  ['p-legal', 'Contract Clause Checker', 'claude-opus-4-7', 0.85, 'ready', true, 9],
  ['p-churn', 'Churn Risk Forecaster', 'claude-opus-4-7', 0.44, 'ready', true, 8],
  ['p-deps', 'Dependency Upgrade Scout', 'claude-haiku-4-5', 0.89, 'ready', true, 0.6],
  ['p-calendar', 'Calendar Gatekeeper', 'claude-haiku-4-5', 0.93, 'ready', true, 0.2],
  ['p-expense', 'Expense Report Checker', 'claude-sonnet-4-6', 0.87, 'needs_credentials', true, 1.5],
  ['p-docs', 'Docs Drift Detector', 'claude-sonnet-4-6', 0.84, 'ready', true, 1.8],
  ['p-onboard', 'Customer Onboarding Guide', 'claude-sonnet-4-6', 0.9, 'ready', true, 2.2],
  ['p-ads', 'Ad Spend Optimiser', 'claude-opus-4-7', 0.71, 'ready', false, 10],
  ['p-incident', 'Incident Commander', 'claude-opus-4-7', 0.96, 'ready', true, 15],
  ['p-backup', 'Backup Verifier', 'claude-haiku-4-5', 0.97, 'ready', true, 0.1],
  ['p-pricing', 'Competitor Pricing Tracker', 'claude-sonnet-4-6', 0.8, 'ready', true, 3.5],
  ['p-feedback', 'Feedback Theme Miner', 'claude-sonnet-4-6', 0.83, 'ready', true, 2.4],
  ['p-translate', 'Release Translator', 'claude-sonnet-4-6', 0.88, 'ready', true, 1.2],
  ['p-a11y', 'Accessibility Linter', 'claude-haiku-4-5', 0.9, 'ready', true, 0.5],
  ['p-perf', 'Performance Regression Hunter', 'claude-opus-4-7', 0.82, 'ready', true, 7],
  ['p-crm', 'CRM Hygiene Keeper', 'claude-haiku-4-5', 0.39, 'ready', true, 0.7],
  ['p-grants', 'Grant Deadline Tracker', 'claude-sonnet-4-6', 0.86, 'needs_credentials', true, 1],
  ['p-vendor', 'Vendor Risk Reviewer', 'claude-opus-4-7', 0.8, 'ready', false, 5],
  ['p-newsletter', 'Newsletter Curator', 'claude-sonnet-4-6', 0.91, 'ready', true, 1.6],
  ['p-okr', 'OKR Progress Reporter', 'claude-sonnet-4-6', 0.87, 'ready', true, 1.4],
  ['p-security', 'Secret Leak Scanner', 'claude-haiku-4-5', 0.95, 'ready', true, 0.3],
  ['p-meeting', 'Meeting Notes Distiller', 'claude-haiku-4-5', 0.9, 'ready', true, 0.4],
  ['p-infra', 'Cloud Cost Watchdog', 'claude-sonnet-4-6', 0.84, 'ready', true, 2.8],
  ['p-qa', 'Regression Test Planner', 'claude-sonnet-4-6', 0.78, 'ready', false, 2],
  ['p-partner', 'Partner Lead Qualifier', 'claude-sonnet-4-6', 0.83, 'ready', true, 1.9],
  ['p-archive', 'Archive Librarian', null, 0.86, 'ready', true, null],
  ['p-voice', 'Voicemail Transcriber', 'claude-haiku-4-5', 0.89, 'ready', true, 0.15],
];

const ICONS = ['email', 'document', 'monitor', 'research', 'code', 'finance', 'support', 'calendar', 'chart', 'shield'];
const COLORS = ['#06b6d4', '#a855f7', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899', '#14b8a6'];

// Credential links per persona index (drives connected_services usage counts).
const CRED_IDS = ['cred-github', 'cred-slack', 'cred-google', 'cred-notion', 'cred-sentry', 'cred-stripe', 'cred-hubspot', 'cred-linear', 'cred-aws', 'cred-openai', 'cred-drive', 'cred-messages', 'cred-postgres', 'cred-jira'];

export function homeCockpitTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();

  const PERSONAS = FLEET.map(([id, name, model, trust, setup, enabled, budget], i) => ({
    id, project_id: PROJECT, name, description: `${name}: synthetic fleet member ${i + 1}.`, system_prompt: '',
    structured_prompt: null, icon: `agent-icon:${ICONS[i % ICONS.length]}`, color: COLORS[i % COLORS.length],
    enabled, sensitive: false, headless: false, starred: i < 4, max_concurrent: 1, timeout_ms: 300000,
    notification_channels: null, last_design_result: null, last_test_report: null, model_profile: model,
    max_budget_usd: budget, max_turns: null,
    design_context: JSON.stringify({ credentialLinks: { a: CRED_IDS[i % 4], b: CRED_IDS[(i * i + 3) % CRED_IDS.length] } }),
    home_team_id: null, source_review_id: null, trust_level: trust >= 0.75 ? 'verified' : 'manual', trust_origin: 'user',
    trust_verified_at: null, trust_score: trust, parameters: null, gateway_exposure: 'none', template_category: null,
    cli_awareness_enabled: false, setup_status: setup, setup_detail: setup === 'ready' ? null : 'Connect a credential to finish setup',
    disabled_dims_json: null, lifecycle: 'active',
    created_at: ago(60 * 24 * (90 - i)), updated_at: ago(i < 10 ? 60 * (i + 1) * 5 : 60 * 24 * (i - 8)),
  }));
  const P = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));

  // 36 runs over the last day (GlobalExecutionListItem, lean), 5 failed, the newest failure 40 min ago.
  const RUNS = Array.from({ length: 36 }, (_, i) => {
    const failed = [2, 9, 15, 22, 30].includes(i);
    const personaId = failed ? ['p-finance', 'p-churn', 'p-crm', 'p-monitor', 'p-finance'][[2, 9, 15, 22, 30].indexOf(i)] : PERSONAS[(i * 7) % 40].id;
    const m = i === 2 ? 40 : 6 + i * 38;
    return {
      id: `exec-r${String(i + 1).padStart(3, '0')}`, personaId, status: failed ? 'failed' : 'completed', modelUsed: 'claude-sonnet-4-6',
      thinkingLevel: null, inputTokens: 4200, outputTokens: 900, costUsd: 0.04, durationMs: 41_000, startedAt: ago(m), createdAt: ago(m),
      personaName: null, personaIcon: null, personaColor: null,
    };
  });

  const METRICS = { totalExecutions: 1284, successfulExecutions: 1163, failedExecutions: 121, totalCostUsd: 48.72, activePersonas: 36, periodDays: 7 };

  const CREDENTIALS = [
    ['cred-github', 'GitHub', 'github'], ['cred-slack', 'Slack', 'slack'], ['cred-google', 'Google Workspace', 'google_workspace'],
    ['cred-notion', 'Notion', 'notion'], ['cred-sentry', 'Sentry', 'sentry'], ['cred-stripe', 'Stripe', 'stripe'],
    ['cred-hubspot', 'HubSpot CRM (sales pipeline, EU workspace)', 'hubspot'], ['cred-linear', 'Linear', 'linear'],
    ['cred-aws', 'AWS Cost Explorer', 'aws'], ['cred-openai', 'OpenAI', 'openai'], ['cred-drive', 'Local Drive', 'local_drive'],
    ['cred-messages', 'Messages', 'personas_messages'], ['cred-postgres', 'Postgres (analytics replica)', 'postgres'], ['cred-jira', 'Jira', 'jira'],
  ].map(([id, name, service_type], i) => ({
    id, name, service_type, metadata: null, healthcheck_last_success: i !== 4 && i !== 12,
    healthcheck_last_message: i === 4 ? 'Token expired 2 days ago' : i === 12 ? 'Connection refused' : null,
    healthcheck_last_tested_at: ago(60 + i), healthcheck_last_success_at: ago(60 + i * 30), last_used_at: ago(20 + i * 45),
    created_at: ago(60 * 24 * (60 - i)), updated_at: ago(60 * 24),
  }));

  // ── the execution a message, a verdict and the evidence all point at ────────────
  const EXEC_ID = 'exec-finance-0412';
  const EXECUTION = {
    id: EXEC_ID, persona_id: 'p-finance', trigger_id: 'trg-nightly', use_case_id: null, status: 'failed',
    input_data: null, output_data: null, claude_session_id: null, log_file_path: null, execution_flows: null,
    model_used: 'claude-sonnet-4-6', thinking_level: null, input_tokens: 184_220, output_tokens: 12_904, cost_usd: 1.8421,
    cache_read_tokens: 90_112, cache_creation_tokens: 4_096, error_message: 'Budget cap reached before the reconciliation finished',
    duration_ms: 412_300, tool_steps: null, retry_of_execution_id: null, retry_count: 1, started_at: ago(47), completed_at: ago(40),
    created_at: ago(47), execution_config: null, log_truncated: false, is_simulation: false, business_outcome: 'partial',
    director_score: 0.58, director_review_md: null,
  };
  const REVIEWS = [
    ['Approve the 14 matched invoices', 'high'], ['Write off 3 cents rounding on INV-2291', 'low'],
    ['Escalate the duplicate Stripe payout to finance', 'critical'], ['Raise the nightly budget cap to $4', 'medium'],
  ].map(([title, severity], i) => ({
    id: `rev-${i + 1}`, execution_id: EXEC_ID, persona_id: 'p-finance', title,
    description: 'The reconciliation paused and needs a human decision before it can continue.', severity,
    context_data: null, suggested_actions: null, status: 'pending', reviewer_notes: null, resolved_at: null,
    created_at: ago(44 - i), updated_at: ago(44 - i), use_case_id: null, assignment_id: null, step_id: null,
  }));
  const MEMORIES = [
    ['Stripe payouts arrive T+2', 'fact'], ['INV prefix means the EU ledger', 'fact'], ['Rounding under 5 cents is written off', 'policy'],
    ['Duplicate payouts go to finance, never auto-resolved', 'policy'], ['The nightly run peaks near 190k input tokens', 'observation'],
    ['Vendor ACME invoices in EUR and USD', 'fact'], ['Budget cap was $2 since August', 'observation'], ['Ask before touching Q3 closed periods', 'preference'],
  ].map(([title, category], i) => ({
    id: `mem-${i + 1}`, persona_id: 'p-finance', title, content: `Seen in run ${EXEC_ID} and ${i + 2} earlier nightly runs; confirmed against the ledger export.`, category,
    source_execution_id: EXEC_ID, tier: i < 3 ? 'core' : 'working', access_count: 12 - i, last_accessed_at: ago(40 + i),
    created_at: ago(60 * 24 * (i + 2)), updated_at: ago(60 * (i + 1)), use_case_id: null, home_team_id: null,
    derived_from: null, open_claim_count: i === 1 ? 2 : 0, fact_key: null,
  }));

  const TEMPLATES = [
    ['tpl-inbox', 'Inbox Zero Assistant', 'productivity', ['gmail', 'slack'], 'Reads new mail every 15 minutes, labels by intent and drafts replies for the ones that need you.'],
    ['tpl-invoice', 'Invoice Reconciliation', 'finance', ['stripe', 'google_workspace'], 'Matches payouts against open invoices nightly and raises a review for anything that does not balance.'],
    ['tpl-standup', 'Async Standup Collector', 'team', ['slack', 'linear'], 'Asks each teammate three questions at 9:00 and posts one digest to the channel.'],
    ['tpl-sentry', 'Error Spike Triage', 'engineering', ['sentry', 'github'], 'Watches for issue spikes, groups them by release and opens a GitHub issue with the stack trace.'],
    ['tpl-research', 'Competitive Research Brief', 'research', ['web', 'notion'], 'Collects competitor pricing and launches weekly and writes a one-page brief to Notion.'],
  ].map(([id, name, category, connectors, snippet]) => ({ id, name, snippet, category, connectors }));

  const DESIGN_DECISIONS = [
    ['Trigger grain', 'One trigger per inbound invoice', 'A batch trigger hid which invoice failed.'],
    ['Model tier', 'Sonnet', 'Reasoning over line items, but volume is modest.'],
    ['Failure path', 'Manual review queue', 'Money never resolves silently.'],
    ['Memory scope', 'Persona-only', 'Ledger facts must not leak to other agents.'],
    ['Budget cap', '$4 per night', 'The August cap of $2 cut runs short.'],
  ].map(([label, choice, rationale], i) => ({
    id: `dd-${i + 1}`, sessionId: 'sess-7', personaContext: 'p-finance', label, choice, rationale,
    decisionTimestamp: ago(60 * 24 + i * 12), createdAt: ago(60 * 24 + i * 12),
  }));

  const baseCalls = (extra = []) => [
    { cmd: 'list_personas', response: PERSONAS },
    { cmd: 'get_persona_summaries', response: [] },
    { cmd: 'get_metrics_summary', response: METRICS },
    { cmd: 'list_credentials', response: CREDENTIALS },
    { cmd: 'get_execution', response: EXECUTION },
    { cmd: 'list_manual_reviews_by_execution', response: REVIEWS },
    { cmd: 'list_memories_by_execution', response: MEMORIES },
    { cmd: 'companion_match_templates', response: TEMPLATES },
    { cmd: 'companion_list_design_decisions', response: DESIGN_DECISIONS },
    { cmd: 'dev_tools_council_read_media', response: { mime: 'image/png', bytes: [...screenshotPng()] } },
    // The Home spine (resume signal): the lean run list, the event window, incidents.
    { cmd: 'list_all_executions', response: RUNS },
    { cmd: 'list_events_in_range', response: { events: [], total: 0, has_more: false } },
    { cmd: 'get_audit_incidents_summary', response: { open: 2, acknowledged: 0, in_progress: 1, openBySource: [['executions', 2]] } },
    ...extra,
  ];
  const specs = composedSpecs({ ago, P, EXEC_ID });
  const seeds = harnessSeeds({ ago, specs, EXEC_ID, PERSONAS });

  // Store state the app holds when a user reaches the view (inbox rows, chat cards, a council
  // seat, a contextual overlay) rides on the tape as ONE pseudo-call the view reads in its
  // `prepare`; nothing invokes it, so the shooter never counts it as a hit.
  const tape = (module, note, extra, override = {}) => ({
    version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
    calls: [...(override.calls ?? baseCalls(extra)), { cmd: '__harness_seed', response: seeds[module] ?? {} }],
  });
  const composed = (spec) => ({ cmd: 'companion_get_cockpit', response: { specJson: JSON.stringify(spec), updatedAt: ago(35) } });
  const never = { cmd: 'companion_get_cockpit', response: null };

  return {
    PERSONAS,
    builders: {
      'home/cockpit': () => tape('home/cockpit', 'Synthetic: returning operator, 40 personas (3 need setup, 4 paused, 2 low trust), 1,284 runs in 7 days, never composed by Athena, so the deterministic default cockpit shows; resume banner on a failure 40 min ago.', [never]),
      'home/cockpit/composed-a': () => tape('home/cockpit/composed-a', 'Synthetic: Athena-composed operations landing (8 kinds): callout, 3 KPI tiles, stat grid, 40-persona overview, 25 of 31 decisions, 12 of 14 services, 12 issues, 10-event timeline.', [composed(specs.a)]),
      'home/cockpit/composed-b': () => tape('home/cockpit/composed-b', 'Synthetic: Athena-composed failure explanation (9 kinds): verdict, flow, comparison, 20-line log, message summary, execution facts, 4 linked decisions, 8 memories, council screenshot.', [composed(specs.b)]),
      'home/cockpit/composed-c': () => tape('home/cockpit/composed-c', 'Synthetic: a composed persona-design arc (6 kinds, chat-first kinds pinned into the grid): use cases, triggers, model tier, observability, decision log, persona ready.', [composed(specs.c)]),
      'home/cockpit/composed-d': () => tape('home/cockpit/composed-d', 'Synthetic: composed onboarding and QA kinds (7): creation offer, walkthrough offer, design capabilities, walkthrough, 5 template matches, 5 recent decisions, browser test report.', [composed(specs.d)]),
      'home/cockpit/contextual-explain': () => tape('home/cockpit/contextual-explain', 'Synthetic: explain_in_cockpit overlay for a pending approval (verdict with 3 live option chips, timeline, log excerpt, stat grid).', [never]),
      'home/cockpit/contextual-briefing': () => tape('home/cockpit/contextual-briefing', 'Synthetic: Morning Director briefing overlay composed by Athena (stat grid, callout, issue list with actions, verdict, persona overview).', [never]),
      'home/cockpit/contextual-message': () => tape('home/cockpit/contextual-message', 'Synthetic: Overview > Messages "Play in chat" overlay (message summary, execution facts, 4 linked decisions, 8 linked memories).', [never]),
      'home/cockpit/states': () => tape('home/cockpit/states', 'Synthetic: a fresh profile, no personas, never composed: the Get Started band and the talk-to-Athena empty state.', null, {
        calls: [
          { cmd: 'list_personas', response: [] }, { cmd: 'get_persona_summaries', response: [] },
          { cmd: 'get_metrics_summary', response: { ...METRICS, totalExecutions: 0, successfulExecutions: 0, failedExecutions: 0, totalCostUsd: 0, activePersonas: 0 } },
          { cmd: 'list_all_executions', response: [] },
          { cmd: 'list_events_in_range', response: { events: [], total: 0, has_more: false } },
          { cmd: 'get_audit_incidents_summary', response: { open: 0, acknowledged: 0, in_progress: 0, openBySource: [] } },
          never,
        ],
      }),
      'home/cockpit/states/error': () => tape('home/cockpit/states/error', 'Synthetic: the cockpit fetch rejects (database is locked) for a returning operator.', null, {
        calls: baseCalls([{ cmd: 'companion_get_cockpit', error: 'database is locked' }]),
      }),
      'home/cockpit/states/loading': () => tape('home/cockpit/states/loading', 'Synthetic: the cockpit fetch never settles (held by the view), so the ghost grid shows.', [never]),
      'athena/inline-cards': () => tape('athena/inline-cards', 'Synthetic: Athena chat card stack at the expanded panel width (912 px): KPI, issue list, use-case set, trigger set, model tier, persona ready.', []),
      'curator/evidence-well': () => tape('curator/evidence-well', 'Synthetic: one council member reading (ux seat): 5 findings, 2 metrics, 1 url, 2 files, 2 screenshots.', []),
      'curator/evidence-well/rivalry': () => tape('curator/evidence-well/rivalry', 'Synthetic: the rivalry seat, whose evidence composes a comparison card of 4 named rivals.', []),
    },
  };
}

// ── composed specs ─────────────────────────────────────────────────────────────
function composedSpecs({ ago, P, EXEC_ID }) {
  const issues = [
    ['Sentry: TypeError in useBacklogQueue after project switch', '142 events, 17 users, since release 2.14', 'bad'],
    ['Invoice Reconciler failed 3 nights in a row', 'Budget cap reached before the reconciliation finished', 'bad'],
    ['Candidate Screener is waiting on a Greenhouse credential', 'Setup required since Tuesday', 'warn'],
    ['Churn Risk Forecaster trust dropped to 44%', 'Two rejected outputs this week', 'bad'],
    ['Postgres (analytics replica) healthcheck failing', 'Connection refused at 03:10', 'warn'],
    ['Sentry token expires in 2 days', 'Rotate before Thursday to keep spike alerts', 'warn'],
    ['PR #812 waiting on review for 4 days', 'personas/desktop: cockpit grid row spans', 'info'],
    ['Cloud cost up 38% week over week', 'Mostly Opus runs from Market Research Analyst', 'warn'],
    ['Docs drift: build.md still describes the retired ORT fetch', '61 days stale', 'info'],
    ['Webhook signature mismatch on X-Hub-Signature-256', 'Code Review Buddy, 2 deliveries dropped', 'bad'],
    ['Ad Spend Optimiser paused by you on Sep 18', 'Resume when the Q4 budget lands', 'info'],
    ['Release Translator finished 14 locales', 'Ready to publish with 2.15', 'good'],
  ].map(([title, sublabel, severity], i) => ({ id: `iss-${i + 1}`, title, sublabel, severity, href: i % 3 === 0 ? 'https://example.com/issue/' + (i + 1) : undefined }));

  const timeline = [
    ['Nightly reconciliation started', 'Triggered by the 02:00 schedule', 47 * 60, 'info'],
    ['Stripe payouts fetched', '212 payouts, 3 currencies', 46 * 60, 'good'],
    ['Invoice match pass', '198 matched, 14 need a look', 45 * 60, 'good'],
    ['Duplicate payout detected', 'po_3NfX appears twice', 44 * 60, 'warn'],
    ['Manual review raised', 'Escalate the duplicate Stripe payout', 44 * 60 - 5, 'warn'],
    ['Budget at 90%', '$1.80 of $2.00', 42 * 60, 'warn'],
    ['Run stopped: budget cap', 'Budget cap reached before the reconciliation finished', 40 * 60, 'bad'],
    ['Retry scheduled', 'Next attempt at 02:00 tomorrow', 40 * 60 - 1, 'info'],
    ['You opened the run', 'From the Morning Digest', 30, 'info'],
    ['Athena explained the failure', 'Composed this cockpit', 5, 'info'],
  ].map(([label, detail, m, intent]) => ({ label, detail, timestamp: ago(m), intent }));

  const LOG = [
    '02:00:01 INFO  reconcile.start trigger=nightly budget_usd=2.00',
    '02:00:03 INFO  stripe.payouts.fetch count=212 currencies=[EUR,USD,GBP]',
    '02:01:12 INFO  ledger.open_invoices count=231',
    '02:03:40 INFO  match.pass matched=198 unmatched=14',
    '02:04:02 WARN  match.duplicate payout=po_3NfX invoice=INV-2291',
    '02:04:02 INFO  review.raise id=rev-3 severity=critical',
    '02:05:10 INFO  tokens.in=121044 tokens.out=8210 cost_usd=1.21',
    '02:06:30 INFO  match.fuzzy candidates=14 window_days=3',
    '02:06:31 DEBUG fuzzy.score INV-2291 po_3NfX 0.97',
    '02:06:31 DEBUG fuzzy.score INV-2302 po_3Ng1 0.64',
    '02:06:58 INFO  tokens.in=164310 tokens.out=11020 cost_usd=1.64',
    '02:07:15 WARN  budget.threshold used=0.90 cap_usd=2.00',
    '02:07:40 INFO  match.fuzzy resolved=9',
    '02:07:41 INFO  tokens.in=184220 tokens.out=12904 cost_usd=1.84',
    '02:07:41 ERROR budget.exceeded projected_usd=2.31 cap_usd=2.00',
    '02:07:41 ERROR run.abort reason=budget_cap remaining=5',
    '02:07:42 INFO  review.raise id=rev-4 title="Raise the nightly budget cap"',
    '02:07:42 INFO  retry.schedule at=2026-09-23T02:00:00Z',
    '02:07:43 INFO  memory.write key=budget_cap_history',
    '02:07:43 INFO  reconcile.end status=failed outcome=partial',
  ];

  const message = {
    id: 'msg-recon', persona_id: 'p-finance', execution_id: EXEC_ID, title: 'Nightly reconciliation: 198 of 212 payouts matched',
    content: '## Summary\n198 of 212 Stripe payouts matched open invoices. 14 need a look; 9 were resolved by fuzzy matching before the run hit its **$2.00 budget cap**. One duplicate payout (po_3NfX against INV-2291) is escalated to finance.\n\n```\nunmatched: 5\n```\nThe remaining five are listed in the review queue.',
    content_type: 'output', priority: 'high', is_read: false, metadata: null, created_at: ago(40), read_at: null, thread_id: null,
    use_case_id: null, persona_name: 'Invoice Reconciler', persona_icon: 'agent-icon:finance', persona_color: '#ef4444',
  };

  const a = {
    title: 'Monday operations',
    widgets: [
      { id: 'a-lead', kind: 'text_callout', title: 'What I see this morning', span: 12, config: { intent: 'warn', body: 'Your fleet ran **1,284 times** this week at a 90.6% success rate. Three things need you: the **Invoice Reconciler** keeps hitting its budget cap, the **Sentry token** expires in two days, and **Candidate Screener** is still waiting on a credential.\n\n- Cost is up 38%, mostly Opus research runs\n- 25 decisions are waiting, 4 of them critical' } },
      { id: 'a-k1', kind: 'metric_spark', span: 4, config: { label: 'Runs this week', value: 1284, delta: '+212 vs last week', trend: 'up', intent: 'default' } },
      { id: 'a-k2', kind: 'metric_spark', span: 4, config: { label: 'Spend (7d)', value: '$48.72', delta: '+38%', trend: 'up', intent: 'warn' } },
      { id: 'a-k3', kind: 'metric_spark', span: 4, config: { label: 'Unresolved Sentry issues', value: 12, unit: 'issues', delta: '+3', trend: 'up', intent: 'bad' } },
      { id: 'a-stats', kind: 'stat_grid', title: 'Fleet vitals', span: 12, config: { columns: 4, stats: [
        { label: 'Active personas', value: 36, unit: 'of 40' }, { label: 'Success rate', value: 90.6, unit: '%', intent: 'good', delta: '-1.2', trend: 'down' },
        { label: 'Failures (7d)', value: 121, intent: 'bad', delta: '+18', trend: 'up' }, { label: 'Median run', value: '41', unit: 's' },
        { label: 'Needs attention', value: 9, intent: 'warn' }, { label: 'Tokens (7d)', value: '31.4M', delta: '+4.1M', trend: 'up' },
      ] } },
      { id: 'a-roster', kind: 'persona_overview', title: 'Your fleet', span: 12, config: { limit: 40, filter: 'all', hero: 'p-incident' } },
      { id: 'a-decisions', kind: 'decisions_panel', title: 'Decisions to make', span: 7, config: { limit: 25 } },
      { id: 'a-services', kind: 'connected_services', title: 'Connected services', span: 5, config: { limit: 12 } },
      { id: 'a-issues', kind: 'issue_list', title: 'Needs attention', span: 7, config: { items: issues, empty_label: 'Nothing needs you.' } },
      { id: 'a-timeline', kind: 'timeline', title: 'Last night, in order', span: 5, config: { events: timeline } },
    ],
  };

  const b = {
    title: 'Why the reconciliation keeps failing',
    widgets: [
      { id: 'b-verdict', kind: 'verdict', span: 6, config: { headline: 'Raise the cap to $4', reasoning: 'The run needs about **$2.30** at current volume; the $2.00 cap stops it with 5 payouts unmatched every night since the August change.', confidence: 'high', intent: 'good', recommended_option: 1, caveat: 'Volume doubles at month end; revisit on Oct 1.' } },
      { id: 'b-flow', kind: 'flow_steps', title: 'What happens on each path', span: 6, config: { steps: [
        { label: 'Nightly run starts', detail: '212 payouts, 231 open invoices', status: 'done' },
        { label: 'Exact and fuzzy match', detail: '207 resolved before the cap', status: 'done' },
        { label: 'Budget cap stops the run', detail: '$1.84 spent, $2.31 projected', status: 'blocked' },
        { label: 'You raise the cap', detail: 'One setting on the persona', status: 'current' },
        { label: 'Tomorrow night completes', detail: 'All 212 payouts reconciled', status: 'pending' },
        { label: 'Month-end review', detail: 'Check the cap against volume', status: 'pending' },
      ] } },
      { id: 'b-compare', kind: 'comparison_cards', title: 'Your options', span: 12, config: { options: [
        { label: 'Raise the cap to $4', summary: 'Finish every night at current volume', pros: ['No manual follow-up', 'Covers month-end spikes', 'One setting'], cons: ['About $0.40 more per night'], recommended: true, intent: 'good' },
        { label: 'Split into two runs', summary: 'EU and US ledgers separately', pros: ['Each run stays under $2', 'Failures isolate by region'], cons: ['Two schedules to maintain', 'Cross-ledger duplicates slip through'], intent: 'info' },
        { label: 'Keep $2 and review by hand', summary: 'Accept 5 unmatched a night', pros: ['No extra spend'], cons: ['About 20 minutes a day for you', 'Duplicates wait until morning', 'Trust score keeps falling'], intent: 'warn' },
      ] } },
      { id: 'b-log', kind: 'log_excerpt', title: 'Run log', span: 7, config: { lines: LOG, highlight_lines: [5, 12, 15, 16], highlight_intent: 'bad', caption: 'The run stopped with 5 payouts left once the projected cost passed the cap.', source: 'exec-finance-0412 · run.log' } },
      { id: 'b-media', kind: 'council_media', title: 'Review queue after the run', span: 5, config: { runId: 'run-ux-17', relPath: 'evidence/review-queue.png', media: 'screenshot', caption: 'Five payouts left unmatched in the review queue.' } },
      { id: 'b-msg', kind: 'message_summary', span: 12, config: { messageId: message.id, snapshot: message } },
      { id: 'b-facts', kind: 'execution_facts', span: 6, config: { executionId: EXEC_ID, personaId: 'p-finance' } },
      { id: 'b-linked', kind: 'linked_decisions', span: 6, config: { executionId: EXEC_ID, personaId: 'p-finance' } },
      { id: 'b-mem', kind: 'linked_memories', span: 12, config: { executionId: EXEC_ID } },
    ],
  };

  const intent = 'Reconcile Stripe payouts against open invoices every night';
  const c = {
    title: 'Designing the Invoice Reconciler',
    widgets: [
      { id: 'c-uc', kind: 'use_case_set', span: 6, config: { intent, use_cases: [
        { label: 'Exact payout-invoice match', role: 'golden', description: 'Amount, currency and reference agree; mark paid and move on.' },
        { label: 'Multi-invoice payout', role: 'golden', description: 'One payout settles several invoices from the same customer.' },
        { label: 'Currency conversion drift', role: 'variant', description: 'EUR invoice paid in USD within a 0.5% FX tolerance.' },
        { label: 'Partial payment', role: 'variant', description: 'Payout covers part of an invoice; leave the remainder open.' },
        { label: 'Duplicate payout', role: 'variant', description: 'Same payout id twice; raise a critical review, never auto-resolve.' },
        { label: 'Closed-period adjustments', role: 'out_of_scope', description: 'Anything touching a closed quarter goes to finance.' },
      ] } },
      { id: 'c-tr', kind: 'trigger_set', span: 6, config: { intent, triggers: [
        { label: 'Nightly reconciliation', source: 'schedule', condition: 'Every day at 02:00 Europe/Prague', grain: 'One run per ledger per night', idempotency_note: 'Re-running the same night is a no-op on already matched invoices.' },
        { label: 'Payout webhook', source: 'webhook', condition: 'Stripe payout.paid', grain: 'One payout per event', idempotency_note: 'Keyed on the payout id.' },
        { label: 'Month-end close', source: 'schedule', condition: 'Last business day at 18:00', grain: 'One close per month' },
        { label: 'Manual re-run', source: 'manual', condition: 'You press Run on the persona' },
        { label: 'Finance review answered', source: 'event', condition: 'review_submitted for this persona', idempotency_note: 'Only the answered review is re-processed.' },
      ] } },
      { id: 'c-tier', kind: 'model_tier_choice', span: 12, config: { intent, recommended: 'sonnet', tiers: [
        { tier: 'haiku', rationale: 'Fast and cheap for exact matches, but misses fuzzy references and multi-invoice payouts.' },
        { tier: 'sonnet', rationale: 'Reasons over line items and FX tolerance at a cost that fits a nightly run of about 200 payouts.' },
        { tier: 'opus', rationale: 'Best on ambiguous references, but at 4x the cost it only pays off for month-end close.' },
      ] } },
      { id: 'c-obs', kind: 'observability_plan', span: 6, config: { intent, error_handling: { triggers: ['Budget cap reached', 'Stripe API 5xx three times', 'Ledger locked by another job', 'Duplicate payout detected'], escalation: 'Raise a manual review in the finance queue with the unmatched payouts attached; never retry silently more than once.' }, success_metric: { kind: 'count_by_status', description: 'Share of payouts matched without a manual review', target: '95% or more each night' } } },
      { id: 'c-log', kind: 'decision_log', span: 6, config: { intent, decisions: [
        { label: 'Trigger grain', choice: 'One run per ledger per night', rationale: 'A single batch hid which ledger failed.', timestamp: ago(60 * 26) },
        { label: 'Model tier', choice: 'Sonnet', rationale: 'Line-item reasoning at a nightly cost under $4.', timestamp: ago(60 * 25) },
        { label: 'Failure path', choice: 'Manual review queue', rationale: 'Money never resolves silently.', timestamp: ago(60 * 25 - 20) },
        { label: 'Memory scope', choice: 'Persona-only', rationale: 'Ledger facts must not leak to other agents.', timestamp: ago(60 * 24) },
        { label: 'Budget cap', choice: '$4 per night', rationale: 'The $2 cap cut the run short every night.', timestamp: ago(60 * 3) },
        { label: 'FX tolerance', choice: '0.5%', rationale: 'Matches the bank spread seen in August.', timestamp: ago(60 * 2) },
        { label: 'Duplicate handling', choice: 'Critical review, never auto-resolve', rationale: 'A wrong auto-merge double-books revenue.', timestamp: ago(60) },
        { label: 'Closed periods', choice: 'Out of scope', rationale: 'Finance owns anything after the quarter closes.', timestamp: ago(30) },
      ] } },
      { id: 'c-ready', kind: 'persona_ready', span: 12, config: { recommended_action: 'interactive', summary: {
        intent_line: intent, system_prompt_outline: 'You reconcile Stripe payouts against open invoices. Match exactly first, then fuzzy within 3 days and 0.5% FX. Never resolve a duplicate or a closed period yourself.',
        use_cases: ['Exact payout-invoice match', 'Multi-invoice payout', 'Currency conversion drift', 'Partial payment', 'Duplicate payout'],
        triggers: ['Nightly at 02:00', 'Stripe payout.paid webhook', 'Month-end close', 'Finance review answered'],
        model_tier: 'sonnet', observability: 'Manual review on budget cap, API failures and duplicates; track the no-review match rate (target 95%).',
      } } },
    ],
  };

  const d = {
    title: 'Getting more from your fleet',
    widgets: [
      { id: 'd-offer', kind: 'persona_creation_offer', span: 6, config: { intent: 'An agent that screens inbound job applications against the role scorecard and books the first call' } },
      { id: 'd-walk-offer', kind: 'walkthrough_offer', span: 6, config: { topic: 'persona_creation', summary: 'Five steps from an idea to a running agent, with the credential step explained.' } },
      { id: 'd-caps', kind: 'design_capabilities', span: 6, config: { intro: 'Tell me what you want an agent to do and I will design it with you, one decision at a time.' } },
      { id: 'd-recent', kind: 'recent_decisions', span: 6, config: { persona_context: 'p-finance', limit: 5 } },
      { id: 'd-walk', kind: 'persona_walkthrough', span: 12, config: { intent: 'Candidate Screener', content: '## 1. Pin the scorecard\nWrite the five must-haves for the role as plain sentences. The screener grades each application against them, one line per criterion.\n\n## 2. Connect the ATS\nCandidate Screener needs a **Greenhouse** credential with read access to applications and write access to notes.\n\n## 3. Pick the trigger\nUse the `application.created` webhook so each applicant is screened once, keyed on the application id.\n\n## 4. Choose the tier\nOpus reads long CVs well; at about 30 applications a week the cost stays under $6.\n\n## 5. Route the borderline ones\nAnything scoring 3 of 5 goes to your review queue with the reasoning attached, never to an automatic rejection.' } },
      { id: 'd-tpl', kind: 'template_suggestions', span: 6, config: { intent: 'reconcile invoices and payouts', limit: 5 } },
      { id: 'd-browser', kind: 'browser_test_report', span: 6, config: {
        url: 'https://staging.example.com/checkout', project_name: 'Storefront',
        steps: [
          { label: 'Open the cart', result: 'pass', evidence: 'Cart shows 3 items, total 128.40 EUR' },
          { label: 'Apply the AUTUMN10 coupon', result: 'pass', evidence: 'Total drops to 115.56 EUR' },
          { label: 'Switch currency to USD', result: 'warn', evidence: 'Total re-renders after 2.8 s with a layout jump' },
          { label: 'Pay with the test card', result: 'fail', evidence: 'Submit button stays disabled after the card form validates' },
          { label: 'Receipt email', result: 'fail', evidence: 'Not reached' },
        ],
        defects: [
          { title: 'Pay button never enables after card validation', severity: 'high', detail: 'The disabled state listens to the old card field id.', fix: 'Bind the enable check to the new PaymentElement ready event.' },
          { title: 'Layout jump when switching currency', severity: 'medium', detail: 'The totals column collapses while prices refetch.', fix: 'Reserve the column width during the refetch.' },
          { title: 'Coupon field has no visible label', severity: 'low', detail: 'Only a placeholder names it.', fix: 'Add a label element.' },
        ],
        console_errors: ['TypeError: Cannot read properties of null (reading "mount") at checkout.js:412', 'Warning: Each child in a list should have a unique "key" prop.'],
        security_notes: ['Card iframe served from the provider domain; no card data touches the page.'],
      } },
    ],
  };

  return { a, b, c, d, issues, timeline, LOG, message };
}

// ── store seeds per view (read by homeCockpitSurfaces.tsx `prepare`) ─────────────
function harnessSeeds({ ago, specs, EXEC_ID, PERSONAS }) {
  const pid = (i) => PERSONAS[i % PERSONAS.length].id;
  const pname = (i) => PERSONAS[i % PERSONAS.length].name;
  // The unified inbox the decisions panel reads: 14 pending approvals, 11 unread messages
  // (5 of them outputs), 6 open healing issues = 31 items; the panel shows 25.
  const approvals = [
    'Send the weekly digest to 1,240 subscribers', 'Merge the dependency bump for react-router 7.4', 'Refund order #88213 (duplicate charge)',
    'Post the release notes to #announcements', 'Escalate the duplicate Stripe payout to finance', 'Book a first call with candidate A. Novak',
    'Pause ad set "Autumn retargeting" (CPA 3x target)', 'Publish the SEO audit to Notion', 'Rotate the Sentry token before it expires',
    'Approve 14 matched invoices', 'Reply to the enterprise renewal thread', 'Archive 312 stale CRM contacts',
    'Open a GitHub issue for the checkout TypeError', 'Raise the nightly budget cap to $4',
  ].map((title, i) => ({
    id: `mr-${i + 1}`, persona_id: pid(i * 3), execution_id: `exec-a${i}`, review_type: 'approval', content: `${title}. The agent paused for your decision.`,
    severity: ['critical', 'high', 'medium', 'low'][i % 4], status: 'pending', reviewer_notes: null, context_data: null, suggested_actions: null,
    title, description: null, created_at: ago(8 + i * 37), resolved_at: null, persona_name: pname(i * 3),
  }));
  const reports = [
    ['Weekly churn digest', 'output'], ['Standup summary for Tuesday', 'markdown'], ['Heads up: vendor contract renews in 9 days', 'text'],
    ['Competitor pricing brief', 'output'], ['Two candidates look strong', 'text'], ['Release notes draft for 2.15', 'output'],
    ['Cloud cost analysis (Sep)', 'output'], ['Question about the refund policy', 'text'], ['OKR progress: 3 of 5 on track', 'text'],
    ['Meeting notes: pricing sync', 'text'], ['Backup verification passed', 'text'],
  ].map(([title, content_type], i) => ({
    id: `rp-${i + 1}`, persona_id: pid(i * 5 + 1), execution_id: null, title, content: `${title}. Synthetic message body for the harness.`,
    content_type, priority: i % 4 === 0 ? 'high' : 'normal', is_read: false, metadata: null, created_at: ago(15 + i * 53), read_at: null,
    thread_id: null, use_case_id: null, persona_name: pname(i * 5 + 1),
  }));
  const healingIssues = [
    ['Webhook signature mismatch', 'high'], ['Rate limited by the HubSpot API', 'medium'], ['Timeout calling the Postgres replica', 'high'],
    ['Budget cap reached three nights in a row', 'critical'], ['Tool call loop detected', 'medium'], ['Credential expired: Sentry', 'high'],
  ].map(([title, severity], i) => ({
    id: `hi-${i + 1}`, persona_id: pid(i * 7 + 2), execution_id: null, title, description: `${title}. Open since the last run.`,
    is_circuit_breaker: i === 3, severity, category: 'runtime', suggested_fix: 'Retry after rotating the credential.', auto_fixed: false,
    status: 'open', created_at: ago(22 + i * 90), resolved_at: null, source: null,
  }));
  const inbox = { manualReviews: approvals, reports, healingIssues };

  const explain = {
    source: { kind: 'explain', decisionId: 'dec-approval-mr-5', decisionTitle: 'Escalate the duplicate Stripe payout to finance' },
    spec: {
      title: 'Should the duplicate payout go to finance?',
      widgets: [
        { id: 'x-verdict', kind: 'verdict', span: 6, config: { headline: 'Escalate it to finance', reasoning: 'The same payout id **po_3NfX** was booked against INV-2291 twice. Auto-resolving would double-count 1,840 EUR of revenue.', confidence: 'high', intent: 'warn', recommended_option: 1, caveat: 'Finance closes September on Friday.' } },
        { id: 'x-stats', kind: 'stat_grid', title: 'Track record', span: 6, config: { columns: 3, stats: [
          { label: 'Duplicates (90d)', value: 4 }, { label: 'Auto-resolved', value: 0, intent: 'good' }, { label: 'Amount', value: '1,840', unit: 'EUR', intent: 'warn' },
          { label: 'Finance SLA', value: '2', unit: 'days' }, { label: 'Last duplicate', value: '19', unit: 'days ago' }, { label: 'Trust', value: 62, unit: '%', intent: 'warn', delta: '-8', trend: 'down' },
        ] } },
        { id: 'x-timeline', kind: 'timeline', title: 'How it happened', span: 6, config: { events: specs.timeline.slice(0, 7) } },
        { id: 'x-log', kind: 'log_excerpt', title: 'Evidence', span: 6, config: { lines: specs.LOG.slice(2, 10), highlight_lines: [3, 4], highlight_intent: 'bad', caption: 'Both rows carry the same payout id.', source: 'exec-finance-0412 · run.log' } },
      ],
    },
    pendingDecision: {
      id: 'dec-approval-mr-5', prompt: 'Escalate the duplicate Stripe payout to finance?', source: 'approval', sourceRef: 'mr-5',
      options: [{ key: 'approve', label: 'Escalate to finance' }, { key: 'reject', label: 'Resolve it myself', danger: true }, { key: 'later', label: 'Ask me tomorrow', hint: 'Snooze for 24 hours' }],
    },
  };
  const failing = ['p-finance', 'p-churn', 'p-crm', 'p-monitor', 'p-hiring'];
  const briefing = {
    source: { kind: 'briefing', generatedAt: ago(6), composedBy: 'athena' },
    spec: {
      title: 'While you were away',
      widgets: [
        { id: 'br-stats', kind: 'stat_grid', title: 'Since yesterday 18:40', span: 12, config: { columns: 4, stats: [
          { label: 'Runs', value: 186 }, { label: 'Failed', value: 14, intent: 'bad' }, { label: 'Alerts', value: 3, intent: 'warn' },
          { label: 'Approvals waiting', value: 14, intent: 'warn' }, { label: 'Open incidents', value: 2, intent: 'warn' },
        ] } },
        { id: 'br-lead', kind: 'text_callout', title: 'The short version', span: 12, config: { intent: 'warn', body: 'A quiet night except for **finance**: the Invoice Reconciler hit its budget cap again and the Churn Risk Forecaster produced two outputs you rejected last week. Everything else ran clean.' } },
        { id: 'br-broken', kind: 'issue_list', title: 'Broke overnight', span: 7, config: { items: failing.map((id, i) => ({ id, title: PERSONAS.find((p) => p.id === id).name, sublabel: `${[5, 4, 2, 2, 1][i]} failed runs`, severity: i < 2 ? 'bad' : 'warn' })) },
          actions: [{ kind: 'rerun_persona', personaId: 'p-finance', label: 'Re-run Invoice Reconciler' }, { kind: 'pause_persona', personaId: 'p-churn', label: 'Pause Churn Risk Forecaster' }] },
        { id: 'br-verdict', kind: 'verdict', title: 'Waiting on you', span: 5, config: { headline: 'Approve the 14 invoices', reasoning: 'All 14 matched exactly on amount, currency and reference.', confidence: 'high', intent: 'good' },
          actions: [{ kind: 'approve_approval', approvalId: 'appr-10', label: 'Approve' }, { kind: 'decline_approval', approvalId: 'appr-10', label: 'Decline' }] },
        { id: 'br-roster', kind: 'persona_overview', title: 'Who ran', span: 12, config: { limit: 12, filter: 'active' } },
      ],
    },
  };
  const message = {
    source: { kind: 'message', messageId: specs.message.id, messageTitle: specs.message.title },
    spec: {
      title: `Context: ${specs.message.title}`,
      widgets: [
        { id: 'w-msg', kind: 'message_summary', span: 12, config: { messageId: specs.message.id, snapshot: specs.message } },
        { id: 'w-facts', kind: 'execution_facts', span: 6, config: { executionId: EXEC_ID, personaId: 'p-finance' } },
        { id: 'w-decisions', kind: 'linked_decisions', span: 6, config: { executionId: EXEC_ID, personaId: 'p-finance' } },
        { id: 'w-mem', kind: 'linked_memories', span: 12, config: { executionId: EXEC_ID } },
      ],
    },
  };

  // Athena chat: informational cards a design conversation leaves in the transcript.
  const byId = (spec, id) => spec.widgets.find((w) => w.id === id);
  const chatCards = [
    { kind: 'metric_spark', title: undefined, config: byId(specs.a, 'a-k2').config },
    { kind: 'issue_list', title: 'Needs attention', config: byId(specs.a, 'a-issues').config },
    { kind: 'use_case_set', config: byId(specs.c, 'c-uc').config },
    { kind: 'trigger_set', config: byId(specs.c, 'c-tr').config },
    { kind: 'model_tier_choice', config: byId(specs.c, 'c-tier').config },
    { kind: 'persona_ready', config: byId(specs.c, 'c-ready').config },
  ];

  // One council member, as runModel's Seat.
  const seat = (name, findings, evidence, score) => ({
    name, weight: 0.2, floor: 0.6, kind: 'judge', threshold: 0.75, state: 'measured', score, confidence: 'medium', floorHit: false,
    advisory: false, findings, evidence, techniques: [
      { subject: 'wizard-flows', technique: 'resume-at-last-step', proof: 'execution' },
      { subject: 'async-ui-states', technique: 'ghost-under-chrome', proof: 'inspection' },
    ], delta: '+0.06',
  });
  const uxSeat = seat('ux', [
    { id: 'f1', severity: 'high', title: 'The pay button never enables after card validation', detail: 'Checkout step 4 stays disabled; the user cannot finish.', recurrence: 3 },
    { id: 'f2', severity: 'med', title: 'Currency switch moves the totals column', detail: 'A 40 px jump while prices refetch.', recurrence: 2 },
    { id: 'f3', severity: 'med', title: 'Coupon field is named only by its placeholder', detail: 'Screen readers announce an unlabeled edit field.', recurrence: 1 },
    { id: 'f4', severity: 'low', title: 'Receipt email preview is cut at 320 px', detail: 'Long product names truncate without a tooltip.', recurrence: 1 },
    { id: 'f5', severity: 'low', title: 'Empty cart shows a bare sentence', detail: 'No way back to the catalogue from the empty state.', recurrence: 1 },
  ], [
    { kind: 'metric', ref: 'by hand 40 min, with app 6 min, retries 3', caption: 'Time to finish checkout' },
    { kind: 'metric', ref: '71%', caption: 'Task success, 14 sessions' },
    { kind: 'url', ref: 'https://staging.example.com/checkout?step=pay', caption: 'The stuck payment step' },
    { kind: 'file', ref: 'src/checkout/PayButton.tsx:48', caption: 'The enable check still reads the old card field id.' },
    { kind: 'file', ref: 'src/checkout/Totals.tsx:112', caption: 'Column width collapses during refetch.' },
    { kind: 'screenshot', ref: 'evidence/pay-step.png', caption: 'The disabled pay button after a valid card.' },
    { kind: 'screenshot', ref: 'evidence/currency-jump.png', caption: 'Totals column mid-refetch.' },
  ], 0.68);
  const rivalrySeat = seat('rivalry', [
    { id: 'r1', severity: 'med', title: 'Two rivals finish checkout in one page', detail: 'We use four steps.', recurrence: 1 },
  ], [
    { kind: 'url', ref: 'https://rival-one.example.com/checkout', caption: 'Rival One: single-page checkout, Apple Pay first' },
    { kind: 'url', ref: 'https://rival-two.example.com/cart', caption: 'Rival Two: saved cards, no account needed' },
    { kind: 'url', ref: 'https://rival-three.example.com/buy', caption: 'Rival Three: four steps like ours' },
    { kind: 'url', ref: 'https://rival-four.example.com/pay', caption: 'Rival Four: coupon applied automatically' },
  ], 0.55);

  return {
    'home/cockpit': { runsSample: [{ persona_id: 'p-finance', status: 'failed', created_at: ago(40) }, { persona_id: 'p-triage', status: 'completed', created_at: ago(12) }] },
    'home/cockpit/composed-a': { inbox },
    'home/cockpit/contextual-explain': { contextual: explain.source ? { source: explain.source, spec: explain.spec } : null, pendingDecision: explain.pendingDecision },
    'home/cockpit/contextual-briefing': { contextual: briefing, inbox },
    'home/cockpit/contextual-message': { contextual: message },
    'athena/inline-cards': { chatCards, inbox },
    'curator/evidence-well': { seat: uxSeat, runId: 'run-ux-17' },
    'curator/evidence-well/rivalry': { seat: rivalrySeat, runId: 'run-ux-17' },
  };
}

// ── a synthetic "screenshot" PNG for council_media (a fake app frame) ─────────
let PNG_CACHE = null;
function screenshotPng() {
  if (PNG_CACHE) return PNG_CACHE;
  const W = 960;
  const H = 600;
  const rects = [
    [0, 0, W, H, [17, 20, 32]], [0, 0, W, 44, [28, 32, 52]], [0, 44, 200, H - 44, [22, 26, 42]],
    [224, 68, 712, 60, [35, 41, 66]], [224, 148, 344, 190, [30, 36, 58]], [592, 148, 344, 190, [30, 36, 58]],
    [224, 358, 712, 40, [36, 44, 72]], [224, 406, 712, 40, [30, 36, 58]], [224, 454, 712, 40, [36, 44, 72]],
    [224, 502, 712, 40, [58, 36, 44]], [240, 90, 180, 16, [120, 140, 220]], [240, 168, 120, 12, [90, 104, 150]],
    [240, 196, 220, 36, [210, 220, 240]], [608, 168, 120, 12, [90, 104, 150]], [608, 196, 160, 36, [240, 170, 90]],
    [16, 70, 168, 20, [60, 70, 110]], [16, 102, 140, 14, [45, 52, 82]], [16, 128, 150, 14, [45, 52, 82]], [16, 154, 120, 14, [45, 52, 82]],
    [240, 516, 260, 12, [240, 120, 120]], [860, 512, 60, 20, [200, 80, 80]],
  ];
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      let c = [0, 0, 0];
      for (const [rx, ry, rw, rh, col] of rects) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) c = col;
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  PNG_CACHE = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  return PNG_CACHE;
}

