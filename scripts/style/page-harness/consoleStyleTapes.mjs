// Synthetic tapes for the console-style WP0 BEFORE shots (consoleStyleSurfaces.tsx).
// Six routed pages, POPULATED (never an empty state). Fixture CODE with fake data only.
//
//   agents/list                Agents roster: 8 personas with health, triggers, last run, spend
//   vault/credentials          Connections list: 8 credentials with last use
//   plugins/dev-tools-overview Plugins > Dev tools > overview: project, vitals, connections
//   settings/appearance        Settings > Appearance
//   settings/account           Settings > Account
//
// overview/home and teams/factory reuse the Mission Control and Factory landing tapes (aliased in synthetic-tapes.mjs).
import { factoryTapes } from './factoryTapes.mjs';

export function consoleStyleTapes({ RECORDED_AT, PERSONAS }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (m) => new Date(T0 - m * 60_000).toISOString();
  const D = 24 * 60;

  // ---- agents/list --------------------------------------------------------
  const EXTRA = [
    ['p-support', 'Support Responder', 'agent-icon:chat', '#ec4899'],
    ['p-data', 'Weekly Data Digest', 'agent-icon:chart', '#14b8a6'],
  ].map(([id, name, icon, color]) => ({ ...PERSONAS[0], id, name, icon, color }));
  const DESCRIPTIONS = [
    'Sorts incoming mail into action, wait and archive.',
    'Drafts release notes from merged pull requests.',
    'Pings endpoints every minute and pages on repeated failure.',
    'Compiles weekly competitor and market briefs.',
    'Reviews pull requests against the team checklist.',
    'Matches invoices to bank lines and flags gaps.',
    'Answers first-line support tickets with cited docs.',
    'Builds a Monday digest of product metrics.',
  ];
  const ROSTER = [...PERSONAS, ...EXTRA].map((p, i) => ({ ...p, description: DESCRIPTIONS[i] }));
  const HEALTH = [
    ['healthy', 0.97, [9, 11, 12, 10, 13, 9, 12]],
    ['healthy', 0.92, [2, 1, 3, 2, 2, 1, 2]],
    ['degraded', 0.71, [30, 28, 31, 29, 33, 30, 31]],
    ['dormant', 0, [0, 0, 0, 0, 0, 0, 0]],
    ['healthy', 0.88, [4, 6, 5, 7, 5, 6, 8]],
    ['failing', 0.31, [3, 2, 4, 3, 5, 4, 4]],
    ['healthy', 0.95, [14, 16, 12, 18, 15, 17, 19]],
    ['healthy', 1, [0, 0, 0, 0, 0, 0, 1]],
  ];
  const statuses = (h) => (h === 'failing' ? ['failed', 'failed', 'completed', 'failed', 'failed'] : h === 'degraded' ? ['completed', 'failed', 'completed', 'completed', 'failed'] : ['completed', 'completed', 'completed', 'completed', 'completed']);
  const SUMMARIES = ROSTER.map((p, i) => ({
    personaId: p.id,
    enabledTriggerCount: [3, 1, 2, 0, 2, 1, 4, 1][i],
    lastRunAt: ago([4, 35, 1, 9 * D, 80, 190, 6, 2 * D][i]),
    health: {
      status: HEALTH[i][0],
      recentStatuses: statuses(HEALTH[i][0]),
      successRate: HEALTH[i][1],
      totalRecent: HEALTH[i][0] === 'dormant' ? 0 : 20,
      runsToday: HEALTH[i][2][6],
      sparkline: HEALTH[i][2],
    },
  }));
  const SPEND = ROSTER.map((p, i) => ({ id: p.id, name: p.name, spend: [4.2, 0.8, 12.6, 0, 2.1, 7.9, 18.4, 0.3][i], max_budget_usd: [20, null, 15, null, 10, 8, 25, 5][i] }));
  const TRENDS = Object.fromEntries(ROSTER.map((p, i) => [p.id, [62, 66, 64, 70, 72, 69, 75].map((v) => v - i * 3)]));

  function agentsList() {
    return {
      version: 1, module: 'agents/list', source: 'synthetic', recordedAt: RECORDED_AT,
      note: 'Synthetic: 8 personas with health, trigger counts, last run, month spend and score trends.',
      calls: [
        { cmd: 'list_personas', response: ROSTER },
        { cmd: 'get_persona_summaries', response: SUMMARIES },
        { cmd: 'get_all_monthly_spend', response: { periodStartUtc: ago(10 * D), items: SPEND } },
        { cmd: 'list_director_score_trends', response: TRENDS },
        { cmd: 'list_teams', response: [] },
        { cmd: 'get_team_counts', response: [] },
      ],
    };
  }

  // ---- vault/credentials --------------------------------------------------
  const connector = (name, label, category, color) => ({
    id: `conn-${name}`, name, label, icon_url: null, color, category, fields: '[]', healthcheck_config: null,
    services: '[]', events: '[]', metadata: null, resources: null, is_builtin: true, created_at: ago(90 * D), updated_at: ago(90 * D),
  });
  const CONNECTORS = [
    connector('supabase', 'Supabase', 'database', '#3ECF8E'), connector('postgres', 'PostgreSQL', 'database', '#336791'),
    connector('github', 'GitHub', 'development', '#8b949e'), connector('slack', 'Slack', 'messaging', '#E01E5A'),
    connector('openai', 'OpenAI', 'ai', '#10a37f'), connector('sentry', 'Sentry', 'monitoring', '#9d5bd2'),
    connector('stripe', 'Stripe', 'payments', '#635bff'), connector('notion', 'Notion', 'productivity', '#9ca3af'),
  ];
  const CRED_ROWS = [
    ['c1', 'Production Supabase', 'supabase', 1], ['c2', 'Analytics warehouse (read replica, EU region)', 'postgres', 12],
    ['c3', 'GitHub org token', 'github', 0.2], ['c4', 'Release notes Slack bot', 'slack', null],
    ['c5', 'OpenAI team key', 'openai', 3], ['c6', 'Sentry error feed', 'sentry', 0.5],
    ['c7', 'Stripe restricted key', 'stripe', 7], ['c8', 'Notion workspace', 'notion', 21],
  ];
  // Persisted probe state per credential (readCredentialHealthState reads healthcheck_last_state from metadata).
  const HEALTH_META = [
    { healthcheck_last_state: 'verified' }, { healthcheck_last_state: 'failed', healthcheck_last_message: 'Connection refused (port 5432)' },
    { healthcheck_last_state: 'verified' }, {}, { healthcheck_last_state: 'verified' }, { healthcheck_last_state: 'verified' },
    { healthcheck_last_state: 'unverifiable' }, { healthcheck_last_state: 'verified' },
  ];
  const CREDS = CRED_ROWS.map(([id, name, serviceType, used], i) => ({
    id, name, serviceType, metadata: JSON.stringify(HEALTH_META[i]), lastUsedAt: used === null ? null : ago(used * D), scopedResources: null,
    createdAt: ago((70 - i * 6) * D), updatedAt: ago(2 * D),
  }));
  function vaultCredentials() {
    return {
      version: 1, module: 'vault/credentials', source: 'synthetic', recordedAt: RECORDED_AT,
      note: 'Synthetic: 8 credentials over 8 connector definitions.',
      calls: [
        { cmd: 'list_credentials', response: CREDS },
        { cmd: 'list_connectors', response: CONNECTORS },
      ],
    };
  }

  // ---- plugins/dev-tools-overview ----------------------------------------
  function devToolsOverview() {
    const base = factoryTapes({ RECORDED_AT }).builders['factory/landing']();
    const repoUrl = 'https://github.com/atlas/atlas-web';
    const withRepo = (p) => (p && p.id === 'p-atlas' ? { ...p, github_url: repoUrl, pr_credential_id: 'cred-github' } : p);
    const GITHUB = { id: 'cred-github', name: 'GitHub org token', serviceType: 'github', metadata: null, lastUsedAt: ago(30), scopedResources: null, createdAt: ago(40 * D), updatedAt: ago(D) };
    const api = (body, headers = {}) => ({ status: 200, status_text: 'OK', headers, body: JSON.stringify(body), duration_ms: 90, content_type: 'application/json', truncated: false });
    const gh = { Accept: 'application/vnd.github+json', 'User-Agent': 'personas-desktop' };
    const call = (credentialId, path, headers, response) => ({ cmd: 'execute_api_request', args: { credentialId, method: 'GET', path, headers, body: null }, response });
    const weekAgo = new Date(T0 - 7 * D * 60_000).toISOString();
    const nowS = Math.floor(T0 / 1000);
    const hourly = Array.from({ length: 7 * 24 }, (_, i) => [nowS - (7 * 24 - i) * 3600, 4 + ((i * 7) % 9)]);
    const pulls = Array.from({ length: 6 }, (_, i) => ({ number: 300 + i, title: `PR ${i}` }));
    const commits = Array.from({ length: 23 }, (_, i) => ({ sha: `c${i}` }));
    const sentry = (path) => `/api/0/projects/atlas/atlas-web/${path}`;
    const calls = base.calls.map((c) => {
      if (c.cmd === 'dev_tools_list_projects') return { ...c, response: c.response.map(withRepo) };
      if (c.cmd === 'dev_tools_get_project') return { ...c, response: withRepo(c.response) };
      if (c.cmd === 'list_credentials') return { ...c, response: [GITHUB, ...c.response] };
      return c;
    });
    calls.push(
      call('cred-github', '/repos/atlas/atlas-web', gh, api({ open_issues_count: 31, default_branch: 'main', pushed_at: ago(95) })),
      call('cred-github', '/repos/atlas/atlas-web/pulls?state=open&per_page=100', gh, api(pulls)),
      call('cred-github', `/repos/atlas/atlas-web/commits?since=${weekAgo}&per_page=100`, gh, api(commits)),
      call('cred-sentry', sentry('issues/?query=is:unresolved&limit=1'), {}, api([{ id: '1' }], { 'x-hits': '14' })),
      call('cred-sentry', sentry(`stats/?stat=received&since=${nowS - 7 * 86400}&until=${nowS}&resolution=1h`), {}, api(hourly)),
    );
    return { ...base, module: 'plugins/dev-tools-overview', calls, note: 'Synthetic: the Factory landing projects with a GitHub repo and credential, repo and Sentry stats answered by path.' };
  }

  // ---- settings -----------------------------------------------------------
  const settings = (id) => () => ({ version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note: 'Settings tab: local preferences, little IPC.', calls: [] });

  return {
    builders: {
      'agents/list': agentsList,
      'vault/credentials': vaultCredentials,
      'plugins/dev-tools-overview': devToolsOverview,
      'settings/appearance': settings('settings/appearance'),
      'settings/account': settings('settings/account'),
    },
  };
}
