// Synthetic tapes for Home > System Check (kit batch home-3; homeSystemCheckSurfaces.tsx).
// The panel fans out six per-section health checks (useHealthChecks.CHECKS) and then
// reads the log directory stats; in DEV it also mounts the crash-log section, which
// reads the two crash corpora. Fixture CODE, no personal data.

export function homeSystemCheckTapes({ RECORDED_AT }) {
  const item = (id, label, status, detail, extra = {}) =>
    ({ id, label, status, detail, installable: false, ...extra });

  // The mixed board a real machine shows: some green, one missing tool that the
  // panel can install itself, one warning, one never-configured integration.
  const MIXED = {
    local: [
      item('ipc', 'Application Bridge', 'ok', 'The Tauri IPC bridge answered in 3 ms.'),
      item('database', 'Local Database', 'ok', 'SQLite 3.46 at %APPDATA%/personas/personas.db (42.1 MB).'),
      item('disk', 'Disk Space', 'warn', '6.2 GB free on C: - executions keep about 40 MB a week.',
        { remediation: 'Free space on C:, or move the data directory to a larger volume.' }),
      item('claude_desktop_mcp', 'Claude Desktop MCP', 'ok', 'Personas is registered as an MCP server.'),
    ],
    environment: [
      item('node', 'Node.js', 'error', 'Not found on PATH. Agent CLI sessions cannot start without it.',
        { installable: true, remediation: 'Install Node.js 22 LTS, or let Personas install it for you.' }),
      item('claude_cli', 'Claude Code CLI', 'ok', 'claude 2.1.14 at ~/.local/bin/claude.'),
      item('git', 'Git', 'ok', 'git 2.47.1.'),
    ],
    agents: [
      item('ollama_api_key', 'Ollama Cloud API Key', 'inactive', 'No key saved. Local models still run without one.'),
      item('litellm_proxy', 'LiteLLM Proxy', 'inactive', 'No proxy configured.'),
    ],
    cloud: [
      item('cloud_orchestrator', 'Cloud Orchestrator', 'info', 'Cloud execution is off. Everything runs on this machine.'),
      item('cloud_sync', 'Cloud Sync', 'inactive', 'Not signed in to a sync account.'),
    ],
    account: [
      item('google_auth', 'Google Account', 'inactive', 'Not signed in. Sign in to sync settings across machines.'),
    ],
    subscriptions: [
      item('claude_subscription', 'Claude Subscription', 'ok', 'Max plan, 112 of 900 session hours used this month.'),
      item('openai_subscription', 'OpenAI', 'warn', 'The saved key is 94 days old.',
        { remediation: 'Rotate the key in Vault > Credentials.' }),
    ],
  };

  // The board a correctly set-up machine shows: nothing to do.
  const HEALTHY = {
    ...MIXED,
    local: MIXED.local.map((i) => (i.id === 'disk' ? item('disk', 'Disk Space', 'ok', '184 GB free on C:.') : i)),
    environment: [
      item('node', 'Node.js', 'ok', 'node v22.14.0 at C:/Program Files/nodejs/node.exe.'),
      ...MIXED.environment.slice(1),
    ],
    subscriptions: [
      MIXED.subscriptions[0],
      item('openai_subscription', 'OpenAI', 'ok', 'Key rotated 6 days ago.'),
    ],
  };

  const LABELS = {
    local: 'Local Environment', environment: 'Environment', agents: 'Agents',
    cloud: 'Cloud Deployment', account: 'Account', subscriptions: 'Subscription Health',
  };

  const sections = (board) => Object.entries(board).map(([id, items]) =>
    ({ cmd: `health_check_${id}`, response: { id, label: LABELS[id], items } }));

  const LOG_STATS = {
    log_dir: 'C:/Users/you/AppData/Roaming/personas/logs', log_bytes: 18_432_000, log_file_count: 7,
    crash_dir: 'C:/Users/you/AppData/Roaming/personas/crashes', crash_bytes: 142_000, crash_file_count: 2,
    tracing_log_retention: 10, crash_log_retention: 20,
  };

  const base = (module, note, calls) => ({
    version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
    calls: [
      ...calls,
      { cmd: 'get_log_directory_stats', response: LOG_STATS },
      { cmd: 'get_crash_logs', response: [] },
      { cmd: 'get_frontend_crashes', response: [] },
    ],
  });

  return {
    builders: {
      'home/system-check': () => base('home/system-check',
        'Synthetic: six sections, Node missing (installable), disk and key warnings, cloud and account never configured.',
        sections(MIXED)),
      'home/system-check/healthy': () => base('home/system-check/healthy',
        'Synthetic: every check passes - the board with nothing to do.',
        sections(HEALTHY)),
      // Every section check is held open, so the panel stays on its first cold load.
      'home/system-check/loading': () => base('home/system-check/loading',
        'Synthetic: the six section checks never resolve, so the panel holds its cold-load ghosts.',
        []),
    },
  };
}
