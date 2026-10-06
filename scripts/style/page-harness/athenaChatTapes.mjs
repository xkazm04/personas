// Synthetic tapes for the Athena chat overlay (`athena/chat/<scenario>`,
// mounted by athenaChatSurfaces.tsx). Fixture CODE, no personal data.
//
// The chat reads from two places, and the tape feeds both:
//  - IPC the chat itself calls on open (the transcript, approvals, proactive
//    nudges, durable chat cards, the Run Desk poll, beta flags): answered by
//    the `calls` below, so they arrive through the app's own fetch path.
//  - Store state the APP fills before the chat ever mounts (fleet sessions
//    from FleetBootstrap, MCP requests from the bridge listener, the pending
//    decision from the decision queue, assignments, the operative-memory
//    digest, a live stream): carried in the `__harness_seed` block, which the
//    surface's `prepare` writes into the stores.
//
// Scenarios (one module id each):
//   athena/chat/idle       6 turns with machine rows + PROGRESS asides; 3 projects,
//                          8 fleet sessions in 6 states; a decision and an approval
//                          waiting; one assignment at 3/7 steps.
//   athena/chat/streaming  idle + Athena mid-reply (tool_use phase, a beat line).
//   athena/chat/waiting    heavy gate load: 2 MCP requests (guidance + approval),
//                          the decision, 2 approvals, a fleet-plan card, a failure
//                          nudge; 2 sessions awaiting input.
//   athena/chat/decision   waiting, opened on the work layer focused on the decision.
//   athena/chat/empty      a fresh conversation: nothing running, nothing waiting.
//
// The variant (current | spread | filament | r5a | r5b | r5c) is a URL param,
// not a module id: `shoot.mjs --query variant=r5a`.

export function athenaChatTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const isoAgo = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const msAgo = (minutes) => T0 - Math.round(minutes * 60_000);
  const CONVERSATION = 'default';

  // ── Projects (Dev Tools registry; the right panel names Run Desk tasks by it) ──
  const ROOT = 'C:/work';
  const project = (id, name, stack) => ({
    id, name, root_path: `${ROOT}/${name}`, description: null, status: 'active',
    tech_stack: stack, github_url: null, monitoring_credential_id: null, monitoring_project_slug: null,
    static_scan_config: null, auto_pr_on_success: false, pr_credential_id: null, llm_tracking_credential_id: null,
    support_credential_id: null, data_links: null, test_env_url: null, test_env_branch: null, main_branch: 'main',
    standards_config: null, team_id: null, workspace_id: null, kind: 'code', enabled: true,
    created_at: isoAgo(60 * 24 * 120), updated_at: isoAgo(60 * 24),
  });
  const PROJECTS = [
    project('proj-web', 'personas-web', 'nextjs,react'),
    project('proj-billing', 'billing-api', 'rust,postgres'),
    project('proj-mobile', 'mobile', 'react-native'),
  ];

  // ── Fleet sessions (FleetSession binding; bigint fields travel as numbers) ──
  let pid = 0;
  // Ids are UUID-shaped like the real ones: the stages print their first 8 characters.
  function session(id, projectName, state, minutesAgo, extra = {}) {
    const cwd = `${ROOT}/${projectName}`;
    return {
      id, claudeSessionId: `claude-${id}`, cwd, projectLabel: projectName, name: null, title: null,
      args: [], mode: 'interactive', state, lastActivityMs: msAgo(minutesAgo), lastPtyOutputMs: msAgo(minutesAgo),
      lastGrewMs: msAgo(minutesAgo), createdAtMs: msAgo(minutesAgo + 80), childPid: 52000 + 37 * ++pid,
      exitCode: null, stateReason: null, athenaActive: false, dozing: false, limitResetAtMs: null, staleKind: null,
      queueRank: null, queuedAtMs: null, notBeforeMs: null, origin: 'manual', athenaFlagged: false, lane: null,
      reservedBand: null, personaId: null, goalId: null, cycleIndex: null, runLabel: null, runId: null,
      contestId: null, contestProjectId: null, remoteJobId: null, originPeerId: null,
      ...extra,
    };
  }
  const S = {
    guide: session('5e1c07a2-4b9d-4f61-a3c8-0d27e94b6f13', 'personas-web', 'running', 0.4, { title: 'Rewrite the guide index page', origin: 'autopilot', athenaFlagged: true }),
    i18n: session('9b40d3e7-1f2a-4c85-b6e0-73a5c1d8e2f4', 'personas-web', 'awaiting_input', 6, { name: 'release notes', title: 'Which section should the i18n note go in?', stateReason: 'Notification: Claude is waiting for your input' }),
    notes: session('c27f8e19-6d3b-4a02-9e45-b81f0c6a3d57', 'personas-web', 'finished', 14, { title: 'Draft the 0.42 release notes', childPid: null, exitCode: 0 }),
    invoice: session('1d8a6f30-e2c4-4b7f-8a19-5c3e07b9d462', 'billing-api', 'running', 0.2, { title: 'Refactor invoice export', origin: 'autopilot', athenaFlagged: true }),
    checkout: session('7f3e2b91-0c5d-4e88-a6f2-d94b1a07c385', 'billing-api', 'stale', 22, { title: 'Fix flaky checkout test', staleKind: 'hung_mid_tool', stateReason: 'No transcript growth for 22 min' }),
    migration: session('e4b29c05-8a71-4d3f-b0e6-2f58a3c9d1b7', 'billing-api', 'idle', 9, { name: 'migration', title: 'Backfill invoice_lines.currency' }),
    nightly: session('38c5d1fa-7b06-4e29-9d43-a1e6f2b80c74', 'mobile', 'idle', 31, { title: 'Nightly build triage' }),
    push: session('b6e07a48-3d1c-4f95-8e2b-0c79d5a14f36', 'mobile', 'queued', 3, { claudeSessionId: null, childPid: null, queueRank: 1, queuedAtMs: msAgo(3), origin: 'autopilot', title: 'Push notification opt-in screen' }),
  };
  const IDLE_SESSIONS = Object.values(S);
  // Waiting: the migration session is parked on an MCP approval and the i18n
  // session on an MCP guidance question, so both read awaiting_input.
  const WAITING_SESSIONS = IDLE_SESSIONS.map((s) => (s.id === S.migration.id
    ? { ...s, state: 'awaiting_input', lastActivityMs: msAgo(4), stateReason: 'athena.request_approval: waiting for the operator', athenaActive: true }
    : s));

  // ── Transcript (CompanionMessage; oldest first, as the backend returns it) ──
  let n = 0;
  const msg = (role, minutesAgo, content) => ({ id: `msg-${String(++n).padStart(3, '0')}`, role, content, createdAt: isoAgo(minutesAgo) });
  const MESSAGES = [
    msg('user', 47, "Morning. What's running across the fleet right now?"),
    msg('system', 46.8, '[lookup] fleet_list_sessions -> 8 sessions across personas-web, billing-api, mobile'),
    msg('assistant', 46.6, 'PROGRESS: Pulling the fleet roster and last night\'s run log.'),
    msg('assistant', 46.2, 'Eight sessions across three projects. **billing-api** is the busy one: *Refactor invoice export* is running, and *Fix flaky checkout test* has been stuck on the same retry for 22 minutes. **personas-web** has the guide rewrite running and one session waiting on you. **mobile** is quiet: the nightly triage is idle and the push opt-in screen is queued behind the dispatch cap.'),
    msg('user', 39, 'Kick the flaky checkout test again, and give it the CI logs this time.'),
    msg('assistant', 38.8, 'PROGRESS: Attaching the last three CI runs of `checkout.spec.ts`.'),
    msg('system', 38.5, 'fleet-orchestration dispatch billing-api / fix-flaky-checkout: resumed with ci-logs attached (3 runs)'),
    msg('assistant', 38.2, 'Restarted it with the last three CI runs attached. The failure is always the same: `waitForPaymentIntent` times out at 5 s on the shared runner and never locally. I told it to look at the polling interval before it touches the test.'),
    msg('user', 31, 'Where are we on the invoice export refactor?'),
    msg('system', 30.8, '[lookup] assignment asg-invoice-export: Refactor invoice export, 3/7 steps'),
    msg('assistant', 30.4, 'Three of seven steps are done. The CSV writer is split out and its tests pass; the PDF path is next. One thing needs you: two PRs touch the same migration, so I put [the merge-order question](ref:decision/dec-migration-order) on your queue.'),
    msg('system', 23, '[autonomous continuation #1]'),
    msg('system', 22.8, '[Athena action auto-approved] Re-ran the mobile nightly build: build 1482 is green'),
    msg('assistant', 22.5, 'The mobile nightly is green again after the re-run. Nothing else needed there.'),
    msg('user', 13, 'Can you draft the release notes for personas-web 0.42?'),
    msg('assistant', 12.8, 'PROGRESS: Reading the 14 PRs merged since 0.41.'),
    msg('system', 9, '[Fleet] release-notes-0.42 finished: draft saved to docs/releases/0.42.md (14 PRs, 3 sections)'),
    msg('assistant', 8.6, 'The draft is in `docs/releases/0.42.md`: three sections (Guide, Dashboard, Fixes) covering 14 PRs. The session that wrote it is asking where the i18n note belongs; that question is waiting in the personas-web lane.'),
    msg('user', 4, 'Thanks. Anything I need to sign off before lunch?'),
    msg('assistant', 3.6, 'Two things. [The merge-order call](ref:decision/dec-migration-order) on billing-api, and [rotating the Stripe test key](ref:approval/appr-stripe-rotate) before it expires on Friday. Everything else keeps running without you.'),
  ];

  // ── Waiting items ─────────────────────────────────────────────────────────
  const DECISION = {
    id: 'dec-migration-order',
    prompt: 'Two PRs touch the same migration - which one lands first?',
    options: [
      { label: 'Land #412 first', hint: 'invoice_lines.currency backfill, then rebase #418' },
      { label: 'Land #418 first', hint: 'tax_region index, then rebase #412' },
      { label: 'Hold both', hint: 'merge neither until the export refactor finishes', danger: true },
    ],
    recommendation: 'Land #412 first. Its backfill is what the invoice export refactor reads, and #418 rebases cleanly on top.',
    detail: 'Both PRs edit 0042_invoice_lines.sql. #412 adds the currency column and backfills it; #418 adds an index on tax_region. Landing #418 first forces #412 to rewrite its backfill against the new index.',
    source: 'adhoc',
    sourceRef: 'billing-api#412',
  };
  const APPROVAL_STRIPE = {
    id: 'appr-stripe-rotate', action: 'rotate_credential',
    rationale: 'The Stripe test key used by billing-api CI expires on Friday. Rotating now gives the checkout suite two days on the new key before the old one stops working.',
    paramsJson: JSON.stringify({ credential: 'Stripe (test)', project: 'billing-api', expires: '2026-09-25' }),
    humanReviewId: null, createdAt: isoAgo(19),
  };
  const APPROVAL_DEPLOY = {
    id: 'appr-web-preview', action: 'deploy_preview',
    rationale: 'The guide index rewrite is ready for a look. A preview deploy of personas-web lets you check it before the session opens a PR.',
    paramsJson: JSON.stringify({ project: 'personas-web', branch: 'guide/index-rewrite', target: 'preview' }),
    humanReviewId: null, createdAt: isoAgo(7),
  };
  const MCP_GUIDANCE = {
    requestId: 'mcp-i18n-section', fleetSessionId: S.i18n.id, kind: 'guidance',
    payload: { question: 'Which section should the i18n note go in: Guide or Fixes?', context: 'The note covers the 13 locale files re-synced in #406. It is user-visible (new language picker copy) but was filed as a fix.' },
    receivedAt: msAgo(6),
  };
  const MCP_APPROVAL = {
    requestId: 'mcp-migrate-staging', fleetSessionId: S.migration.id, kind: 'approval',
    payload: { action: 'Run `sqlx migrate run` against staging', rationale: 'The currency backfill touches 1.2M invoice_lines rows; it needs the staging copy to measure the lock time before production.', details: { database: 'billing-staging', migration: '0042_invoice_lines', estimatedRows: 1200000 } },
    receivedAt: msAgo(4),
  };
  const PLAN_CARD_ROW = {
    id: 'card-mobile-push', conversationId: CONVERSATION, episodeId: null, kind: 'fleet_plan',
    title: 'Split the push opt-in work into three sessions',
    configJson: JSON.stringify({
      operation_intent: 'ship the push notification opt-in screen',
      rows: [
        { cwd: `${ROOT}/mobile`, objective: 'Build the opt-in screen and its copy behind the push_optin flag', label: 'push · screen', model: null, effort: 'medium' },
        { cwd: `${ROOT}/mobile`, objective: 'Wire the permission prompt on iOS and Android, with the deferred-ask path', label: 'push · permission', model: null, effort: 'high' },
        { cwd: `${ROOT}/billing-api`, objective: 'Add the notification_preferences endpoint the screen saves to', label: 'push · api', model: null, effort: 'medium' },
      ],
    }),
    status: 'pending', resultJson: null, createdAt: isoAgo(11), resolvedAt: null,
  };
  const NUDGE_FAILURE = {
    id: 'pro-checkout-failed', triggerKind: 'fleet_failed', triggerRef: S.checkout.id,
    message: 'billing-api / Fix flaky checkout test exited with code 1 after 3 retries. The last run timed out in waitForPaymentIntent again.',
    status: 'delivered', createdAt: isoAgo(5), deliveredAt: isoAgo(5), resolvedAt: null, scheduledFor: null,
  };
  const ASSIGNMENT = {
    assignmentId: 'asg-invoice-export', teamId: 'team-billing', title: 'Refactor invoice export',
    goal: 'Split CSV and PDF export into separate writers with shared row mapping', status: 'running',
    totalSteps: 7, doneSteps: 3, failedSteps: 0, updatedAt: msAgo(2),
  };

  // Athena's own live op, as the operative-memory digest formats it (parseDigest.ts).
  const DIGEST = [
    '## Active orchestration (operative memory)',
    '- **Stabilise the billing-api checkout suite** (`op7c21ab`, running, started 39m ago)',
    `  - \`${S.checkout.id.slice(0, 8)}\` "fixer": stale -> Bash`,
    '    intent: find why waitForPaymentIntent times out on the shared runner',
    '    checkpoint: CI logs attached · blockers: none',
    '- **Draft personas-web 0.42 release notes** (`op19e0f4`, waiting, started 13m ago)',
    `  - \`${S.i18n.id.slice(0, 8)}\` "writer": awaiting_input`,
    '    intent: place the i18n note',
  ].join('\n');

  const devTask = (id, projectId, title, status, minutesAgo, pct) => ({
    id, project_id: projectId, title, description: null, source_idea_id: null, goal_id: null, status,
    session_id: null, progress_pct: pct, output_lines: Math.round(pct * 3), error: null,
    started_at: status === 'running' ? isoAgo(minutesAgo) : null, completed_at: null, created_at: isoAgo(minutesAgo + 5),
    updated_at: isoAgo(Math.max(0.5, minutesAgo / 4)), depth: 'quick', parent_task_id: null, attempt: 1,
    worktree_path: null, worktree_branch: null, worktree_fallback_reason: null,
  });
  const TASKS = [
    devTask('task-lint-web', 'proj-web', 'Lint sweep: unused i18n keys', 'running', 12, 64),
    devTask('task-bench-billing', 'proj-billing', 'Benchmark invoice export on 50k rows', 'queued', 2, 0),
  ];

  const CONVERSATIONS = [
    { id: CONVERSATION, title: 'Fleet check-in', status: 'active', origin: 'user', pinned: true, lastActiveAt: isoAgo(3.6), createdAt: isoAgo(60 * 24 * 30), lastReadAt: isoAgo(3.6), unreadCount: 0, messageCount: MESSAGES.length },
    { id: 'conv-mobile', title: 'Mobile push rollout', status: 'active', origin: 'user', pinned: false, lastActiveAt: isoAgo(70), createdAt: isoAgo(60 * 24 * 3), lastReadAt: isoAgo(90), unreadCount: 2, messageCount: 18 },
    { id: 'athena-notices', title: 'Athena / Notices', status: 'active', origin: 'proactive', pinned: false, lastActiveAt: isoAgo(5), createdAt: isoAgo(60 * 24 * 30), lastReadAt: isoAgo(60), unreadCount: 1, messageCount: 41 },
  ];

  const STREAMING = {
    text: 'Checked the staging lock time: the backfill holds a row lock on invoice_lines for about 40 s in batches of 5,000, so',
    phase: { kind: 'tool_use', toolName: 'Bash' },
    beat: 'Measuring the lock time of the currency backfill on staging',
  };
  const STREAMING_ASK = msg('user', 0.6, 'Before I decide: how long does the #412 backfill lock invoice_lines on staging?');

  function tape(id, note, { messages, approvals, proactive, cards, tasks, seed }) {
    return {
      version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note,
      calls: [
        { cmd: 'companion_list_recent_messages', response: messages },
        { cmd: 'companion_list_messages_before', response: { messages: [], nextBeforeCreatedAt: null, nextBeforeId: null, exhausted: true } },
        { cmd: 'companion_list_pending_approvals', response: approvals },
        { cmd: 'companion_list_proactive_messages', response: proactive },
        { cmd: 'companion_list_chat_cards', response: cards },
        { cmd: 'companion_list_conversations', response: seed.conversations },
        { cmd: 'companion_get_operative_memory_digest', response: seed.digest },
        { cmd: 'dev_tools_tasks_page', response: { tasks, cursor: null, hasMore: false, counts: { running: tasks.filter((t) => t.status === 'running').length, queued: tasks.filter((t) => t.status === 'queued').length } } },
        { cmd: 'companion_beta_flags', response: { devModeAvailable: false } },
        // No persisted per-turn trail/plan/summary rows, no reply-register entries.
        { cmd: 'companion_get_turn_sidecars', response: [] },
        { cmd: 'companion_list_reply_register', response: [] },
        // The toolbar's connector and plugin chips (AthenaToolbar): none connected.
        { cmd: 'list_credentials', response: [] },
        { cmd: 'list_connectors', response: [] },
        { cmd: 'companion_list_active_connectors', response: [] },
        { cmd: 'companion_list_plugin_toggles', response: [] },
        { cmd: '__harness_seed', response: seed },
      ],
    };
  }

  const idleSeed = (extra = {}) => ({
    projects: PROJECTS, fleetSessions: IDLE_SESSIONS, mcpRequests: [], decision: DECISION,
    assignments: [ASSIGNMENT], digest: DIGEST, conversations: CONVERSATIONS, conversationId: CONVERSATION,
    streaming: null, layer: null, ...extra,
  });
  const waitingSeed = (extra = {}) => idleSeed({ fleetSessions: WAITING_SESSIONS, mcpRequests: [MCP_GUIDANCE, MCP_APPROVAL], ...extra });

  const idle = (id, note, seed) => tape(id, note, {
    messages: MESSAGES, approvals: [APPROVAL_STRIPE], proactive: [], cards: [], tasks: TASKS, seed,
  });
  const waiting = (id, note, seed) => tape(id, note, {
    messages: MESSAGES, approvals: [APPROVAL_STRIPE, APPROVAL_DEPLOY], proactive: [NUDGE_FAILURE], cards: [PLAN_CARD_ROW], tasks: TASKS, seed,
  });

  return {
    builders: {
      'athena/chat/idle': () => idle('athena/chat/idle',
        'Synthetic: 6 turns (machine rows, PROGRESS asides, ref links), 3 projects / 8 sessions in 6 states, a decision + an approval waiting, an assignment at 3/7.',
        idleSeed()),
      'athena/chat/streaming': () => tape('athena/chat/streaming',
        'Synthetic: the idle chat with a 7th ask and Athena mid-reply (tool_use Bash, a beat line, partial text).',
        { messages: [...MESSAGES, STREAMING_ASK], approvals: [APPROVAL_STRIPE], proactive: [], cards: [], tasks: TASKS, seed: idleSeed({ streaming: STREAMING }) }),
      'athena/chat/waiting': () => waiting('athena/chat/waiting',
        'Synthetic: heavy gate load - 2 MCP requests (guidance + approval), the decision, 2 approvals, a fleet-plan card, a failure nudge, the assignment; 2 sessions awaiting input.',
        waitingSeed()),
      'athena/chat/decision': () => waiting('athena/chat/decision',
        'Synthetic: the waiting tape, opened on the work layer focused on the migration-order decision.',
        waitingSeed({ layer: { kind: 'work', focus: `decision:${DECISION.id}`, project: null } })),
      'athena/chat/empty': () => tape('athena/chat/empty',
        'Synthetic: a fresh conversation - no messages, no sessions, nothing waiting.',
        {
          messages: [], approvals: [], proactive: [], cards: [], tasks: [],
          seed: {
            projects: PROJECTS, fleetSessions: [], mcpRequests: [], decision: null, assignments: [], digest: '',
            conversations: [{ ...CONVERSATIONS[0], title: null, lastReadAt: null, messageCount: 0, lastActiveAt: isoAgo(0.1), createdAt: isoAgo(0.1) }],
            conversationId: CONVERSATION, streaming: null, layer: null,
          },
        }),
    },
  };
}
