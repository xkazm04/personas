// Synthetic tapes for module 3, the Fleet cluster (plugins/fleet sub_grid,
// sub_activity, sub_settings). Shapes follow the TS bindings (FleetSession,
// FleetTranscriptSummary, FleetTokenAggregate, FleetHookStatus,
// FleetDetectedProcess, FleetCompanionStatus); bigint fields travel as JSON
// numbers, which every consumer Number()s. Fixture CODE, no personal data.
//
//   fleet/grid           Sessions tab: 11 sessions in every state, the focused
//                        one idle and bloated (context pill + Compact action)
//   fleet/grid/insights  the same page with the right pane on Insights
//   fleet/activity       Activity tab: 8 recent transcripts across 4 projects
//   fleet/settings       Settings tab: hooks installed with one entry missing,
//                        4 detected processes (1 orphan), no paired device

export function fleetTapes({ RECORDED_AT, PROJECT_ROOT = 'C:/work/personas' }) {
  const T0 = Date.parse(RECORDED_AT);
  const msAgo = (minutes) => T0 - minutes * 60_000;
  const isoAgo = (minutes) => new Date(msAgo(minutes)).toISOString();
  const PROJECT = 'proj-fleet';

  const project = {
    id: PROJECT, name: 'personas', root_path: PROJECT_ROOT, description: null, status: 'active',
    tech_stack: 'tauri,react', github_url: null, monitoring_credential_id: null, monitoring_project_slug: null,
    static_scan_config: null, auto_pr_on_success: false, pr_credential_id: null, llm_tracking_credential_id: null,
    support_credential_id: null, data_links: null, test_env_url: null, test_env_branch: null, main_branch: 'master',
    standards_config: null, team_id: null, workspace_id: null, kind: 'code', enabled: true,
    created_at: isoAgo(60 * 24 * 90), updated_at: isoAgo(60 * 24),
  };

  function session(id, state, minutesAgo, extra = {}) {
    const cwd = extra.cwd ?? PROJECT_ROOT;
    return {
      id, claudeSessionId: `claude-${id}`, cwd, projectLabel: cwd.split('/').pop(), name: null, title: null,
      args: [], mode: 'interactive', state, lastActivityMs: msAgo(minutesAgo), lastPtyOutputMs: msAgo(minutesAgo),
      lastGrewMs: msAgo(minutesAgo), createdAtMs: msAgo(minutesAgo + 95), childPid: 41000 + id.length * 7,
      exitCode: null, stateReason: null, athenaActive: false, dozing: false, limitResetAtMs: null, staleKind: null,
      queueRank: null, queuedAtMs: null, notBeforeMs: null, origin: 'manual', personaId: null, goalId: null,
      cycleIndex: null, remoteJobId: null, originPeerId: null,
      ...extra,
    };
  }

  const SESSIONS = [
    session('s-await-1', 'awaiting_input', 2, { title: 'Refactor vault connector retries', stateReason: 'Notification: Claude needs your permission to use Bash' }),
    session('s-await-2', 'awaiting_input', 9, { name: 'docs sweep', title: 'Which changelog section should the i18n note go in?', athenaActive: true, stateReason: 'Notification: Claude is waiting for your input' }),
    session('s-run-1', 'running', 0.3, { title: 'Port the DataGrid pager onto tokens', origin: 'dev_runner' }),
    session('s-run-2', 'running', 1, { cwd: 'C:/work/personas-web', title: 'Rewrite the guide index page', mode: 'headless', origin: 'autopilot' }),
    session('s-queue-1', 'queued', 4, { claudeSessionId: null, childPid: null, queueRank: 1, queuedAtMs: msAgo(4), origin: 'autopilot', title: null }),
    session('s-idle-1', 'idle', 6, { name: 'style pass', title: 'Fleet settings page on typo tokens' }),
    session('s-idle-2', 'idle', 38, { cwd: 'C:/work/ai-registry', title: 'Regenerate the knowledge index' }),
    session('s-stale-1', 'stale', 17, { title: 'Migrate the backlog table to fit=content', staleKind: 'blocked_question', stateReason: 'No transcript growth for 17 min' }),
    session('s-done-1', 'finished', 55, { title: 'Census baseline for the new style rules', childPid: null }),
    session('s-hib-1', 'hibernated', 140, { cwd: 'C:/work/kiro-docs', title: 'Draft the release notes', childPid: null, stateReason: 'Auto-hibernated after 30 min idle' }),
    session('s-exit-1', 'exited', 210, { title: 'Run the Rust test shard', childPid: null, exitCode: 0 }),
  ];
  const FOCUSED = 's-idle-1';

  const snapshot = { sessions: SESSIONS, hookPort: 17321, hooksInstalled: true };

  function transcript(id, cwd, minutesAgo, { input, output, cacheRead, cacheCreation, context, turns, prompts, tools, files, models, parseErrors = 0, span = 48 }) {
    return {
      claudeSessionId: id, path: `C:/Users/op/.claude/projects/${(cwd ?? 'unknown').replace(/[:/]/g, '-')}/${id}.jsonl`,
      cwd, userMessages: prompts, assistantMessages: turns,
      tokens: { input, output, cacheCreation, cacheRead }, lastContextTokens: context, models,
      tools: tools.map(([name, count]) => ({ name, count })), bgProcsLaunched: 0, filesTouched: files,
      firstTimestamp: isoAgo(minutesAgo + span), lastTimestamp: isoAgo(minutesAgo), parseErrors, totalLines: turns * 6,
    };
  }

  const FOCUSED_SUMMARY = transcript(`claude-${FOCUSED}`, PROJECT_ROOT, 6, {
    input: 184_220, output: 61_870, cacheRead: 2_914_400, cacheCreation: 402_118, context: 182_400,
    turns: 64, prompts: 7, models: ['claude-opus-5-5', 'claude-haiku-4-5'], parseErrors: 2, span: 72,
    tools: [['Read', 58], ['Edit', 31], ['Bash', 22], ['Grep', 19], ['Glob', 8], ['Write', 4], ['TodoWrite', 3]],
    files: [
      'src/features/plugins/fleet/sub_settings/FleetSettingsPage.tsx',
      'src/features/plugins/fleet/sub_settings/FleetTerminalSettings.tsx',
      'src/features/plugins/fleet/sub_settings/FleetProcessScanner.tsx',
      'src/features/plugins/fleet/sub_settings/FleetProcessRow.tsx',
      'src/features/plugins/fleet/sub_settings/FleetAutoHibernateSettings.tsx',
      'src/features/plugins/fleet/sub_settings/FleetStateCutoffSettings.tsx',
      'src/features/plugins/fleet/sub_settings/__tests__/FleetSettingsPage.test.tsx',
      'src/i18n/locales/en.json',
      'docs/design/style-mastery/doctrine.md',
    ],
  });

  const RECENT = [
    FOCUSED_SUMMARY,
    transcript('claude-s-run-1', PROJECT_ROOT, 0.3, { input: 92_400, output: 28_100, cacheRead: 1_220_000, cacheCreation: 180_300, context: 64_000, turns: 31, prompts: 3, models: ['claude-opus-5-5'], tools: [['Read', 24], ['Edit', 12], ['Bash', 9], ['Grep', 6]], files: ['src/features/shared/components/display/DataGrid.tsx', 'src/features/shared/components/display/DataGridPager.tsx'] }),
    transcript('claude-s-run-2', 'C:/work/personas-web', 1, { input: 41_000, output: 19_800, cacheRead: 610_000, cacheCreation: 72_000, context: 38_000, turns: 18, prompts: 1, models: ['claude-sonnet-5'], tools: [['Read', 11], ['Write', 5], ['Edit', 4]], files: ['src/app/guide/page.tsx', 'src/data/guide/content/fleet.md', 'src/data/guide/desktop-modules.ts'] }),
    transcript('claude-s-await-1', PROJECT_ROOT, 2, { input: 130_900, output: 40_020, cacheRead: 2_040_000, cacheCreation: 260_000, context: 151_200, turns: 44, prompts: 5, models: ['claude-opus-5-5'], tools: [['Bash', 30], ['Read', 27], ['Edit', 18], ['Grep', 14], ['Glob', 3], ['WebFetch', 2], ['Task', 1], ['NotebookEdit', 1]], files: ['src-tauri/src/engine/vault/retry.rs', 'src-tauri/src/engine/vault/connector.rs', 'src-tauri/src/engine/vault/mod.rs', 'src/api/vault/connectors.ts', 'src/features/vault/sub_catalog/ConnectorRow.tsx'] }),
    transcript('claude-s-stale-1', PROJECT_ROOT, 17, { input: 55_000, output: 12_400, cacheRead: 700_000, cacheCreation: 88_000, context: 71_000, turns: 20, prompts: 2, models: ['claude-opus-5-5'], tools: [['Read', 14], ['Edit', 6]], files: ['src/features/overview/sub_manual-review/components/backlog/BacklogTable.tsx'] }),
    transcript('claude-s-idle-2', 'C:/work/ai-registry', 38, { input: 12_300, output: 4_100, cacheRead: 98_000, cacheCreation: 20_000, context: 18_000, turns: 6, prompts: 1, models: ['claude-haiku-4-5'], tools: [['Bash', 4]], files: [] }),
    transcript('claude-s-hib-1', 'C:/work/kiro-docs', 140, { input: 22_800, output: 30_100, cacheRead: 150_000, cacheCreation: 34_000, context: 29_000, turns: 9, prompts: 2, models: ['claude-sonnet-5'], tools: [['Read', 6], ['Write', 2]], files: ['release-notes/2026-09.md'] }),
    transcript('claude-gone-7f3a', null, 60 * 26, { input: 8_100, output: 2_000, cacheRead: 0, cacheCreation: 9_000, context: 9_000, turns: 3, prompts: 1, models: [], tools: [], files: [] }),
  ];

  const aggregate = {
    sessionCount: 7,
    tokens: { input: 1_240_000, output: 310_000, cacheCreation: 820_000, cacheRead: 9_400_000 },
    totalContextTokens: 610_000,
    bloatedCount: 2,
  };

  const hooks = {
    installed: true,
    presentEvents: ['Notification', 'PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'],
    missingEvents: ['PreToolUse'],
    installedPort: 17321,
    portMatches: true,
  };

  const MB = 1024 * 1024;
  const processes = [
    { pid: 41077, name: 'claude.exe', cmd: 'claude', cwd: PROJECT_ROOT, memoryBytes: 412 * MB, tracked: true, interactive: true },
    { pid: 41112, name: 'claude.exe', cmd: 'claude --resume', cwd: 'C:/work/ai-registry', memoryBytes: 1.4 * 1024 * MB, tracked: true, interactive: true },
    { pid: 38820, name: 'claude.exe', cmd: 'claude', cwd: 'C:/work/personas-web/apps/guide/src/content/very/deep/folder', memoryBytes: 268 * MB, tracked: false, interactive: true },
    { pid: 39001, name: 'claude.exe', cmd: 'claude -p --output-format stream-json', cwd: PROJECT_ROOT, memoryBytes: 190 * MB, tracked: false, interactive: false },
  ];

  const base = (module, note, calls) => ({ version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note, calls });

  const gridCalls = [
    { cmd: 'dev_tools_list_projects', response: [project] },
    { cmd: 'fleet_list_sessions', response: snapshot },
    { cmd: 'fleet_token_summary', response: aggregate },
    { cmd: 'fleet_session_metadata', args: { claudeSessionId: `claude-${FOCUSED}` }, response: FOCUSED_SUMMARY },
    ...RECENT.map((r) => ({ cmd: 'fleet_session_metadata', args: { claudeSessionId: r.claudeSessionId }, response: r })),
    { cmd: 'fleet_session_metadata', response: null },
    { cmd: 'fleet_read_transcript', response: FOCUSED_SUMMARY },
    { cmd: 'fleet_check_hooks', response: hooks },
    { cmd: 'fleet_set_auto_hibernate', response: null },
    { cmd: 'fleet_set_state_cutoffs', response: null },
    { cmd: 'fleet_subscribe_terminal', response: '' },
    { cmd: 'fleet_unsubscribe_terminal', response: null },
    { cmd: 'fleet_resize_session', response: null },
  ];

  return {
    PROJECT,
    FOCUSED,
    builders: {
      'fleet/grid': () => base('fleet/grid', 'Synthetic: 11 fleet sessions in every state; the focused session is idle with a 182k context.', gridCalls),
      'fleet/grid/insights': () => base('fleet/grid/insights', 'Synthetic: the fleet/grid tape, right pane switched to Insights.', gridCalls),
      'fleet/activity': () => base('fleet/activity', 'Synthetic: 8 recent transcripts across 4 projects (one with no cwd, one with no tools).', [
        { cmd: 'fleet_list_sessions', response: snapshot },
        { cmd: 'fleet_recent_transcripts', response: RECENT },
      ]),
      'fleet/settings': () => base('fleet/settings', 'Synthetic: hooks installed with PreToolUse missing; 4 claude processes (1 orphan, 1 -p filtered).', [
        { cmd: 'fleet_list_sessions', response: snapshot },
        { cmd: 'fleet_check_hooks', response: hooks },
        { cmd: 'fleet_detect_processes', response: processes },
        { cmd: 'fleet_companion_devices', response: { devices: [], serverRunning: false, port: null, url: null } },
        { cmd: 'fleet_set_auto_hibernate', response: null },
        { cmd: 'fleet_set_state_cutoffs', response: null },
      ]),
    },
  };
}
