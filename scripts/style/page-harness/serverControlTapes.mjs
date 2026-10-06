// Synthetic tapes for spark server-control: Browser > Server control
// (serverControlSurfaces.tsx). Shapes follow the TS bindings DevServerView,
// DevWorkspace, DevProject and BrowserSite. Fixture CODE, no personal data:
// project names and paths are invented, ports are the ones a dev machine uses.
//
// Ten servers, every DevServerState at least once, across three workspaces and
// one project with no workspace, so each variant is judged on the whole
// vocabulary and on grouping.

export function serverControlTapes({ RECORDED_AT }) {
  const T0 = Math.floor(Date.parse(RECORDED_AT) / 1000);
  const ago = (minutes) => T0 - minutes * 60;
  const iso = (minutes) => new Date((T0 - minutes * 60) * 1000).toISOString();

  const WORKSPACES = [
    { id: 'ws-core', name: 'Core', color: '#6366f1', description: null, adopt_default_skills: false, last_working_version: false, created_at: iso(60 * 24 * 40), updated_at: iso(60 * 24) },
    { id: 'ws-freelance', name: 'Freelance', color: '#f59e0b', description: null, adopt_default_skills: false, last_working_version: false, created_at: iso(60 * 24 * 30), updated_at: iso(60 * 24) },
    { id: 'ws-lab', name: 'Lab', color: '#10b981', description: null, adopt_default_skills: false, last_working_version: false, created_at: iso(60 * 24 * 20), updated_at: iso(60 * 24) },
  ];

  // [id, name, workspace, techStack, devCommand, port, state, extra]
  const ROWS = [
    ['p-desk', 'desk-app', 'ws-core', 'Vite,React,TypeScript,Tauri,Tailwind', 'npm run dev', 1420, 'external', { externalPid: 29096 }],
    ['p-site', 'marketing-site', 'ws-core', 'Next.js,React,TypeScript,Tailwind,Supabase', 'npm run dev', 3000, 'running', { pid: 31092, startedAt: ago(134) }],
    ['p-ascent', 'ascent', 'ws-core', 'Next.js,React,TypeScript,Prisma', 'npm run dev', 3001, 'starting', { pid: 30411, startedAt: ago(0.4) }],
    ['p-cand', 'candidate', 'ws-core', 'Next.js,React,TypeScript,Tailwind', 'npm run dev', 3002, 'stopped', {}],
    ['p-case', 'case-portal', 'ws-core', 'Next.js,React,TypeScript', 'npm run dev', 3003, 'failed', { error: 'exited with code 1 before answering on port 3003' }],
    ['p-docs', 'docs-site', 'ws-freelance', 'Astro,TypeScript,Tailwind', 'npm run dev -- --port {port}', 4321, 'running', { pid: 22870, startedAt: ago(60 * 26) }],
    ['p-gw', 'api-gateway', 'ws-freelance', 'Node.js,TypeScript,PostgreSQL', 'npm run dev', 8080, 'stopping', { pid: 18044, startedAt: ago(52) }],
    ['p-shop', 'shop-admin', 'ws-lab', null, null, 5173, 'scanning', {}],
    ['p-track', 'tracklight', 'ws-lab', 'Vue,Vite,TypeScript', 'npm run dev -- --port {port}', 3005, 'stopped', {}],
    ['p-nb', 'ml-notebook', null, 'Python', null, 8000, 'unconfigured', {}],
  ];

  const SERVERS = ROWS.map(([projectId, projectName, workspaceId, techStack, devCommand, devPort, state, extra]) => ({
    projectId, projectName, rootPath: `C:\\dev\\${projectName}`, workspaceId, techStack, devCommand, devPort, state,
    pid: extra.pid ?? null, externalPid: extra.externalPid ?? null, startedAt: extra.startedAt ?? null,
    url: `http://localhost:${devPort}`, error: extra.error ?? null,
  }));

  const PROJECTS = SERVERS.map((s, i) => ({
    id: s.projectId, name: s.projectName, root_path: s.rootPath, description: null, status: 'active',
    tech_stack: s.techStack, created_at: iso(60 * 24 * (40 - i)), updated_at: iso(60 * 24),
    github_url: null, monitoring_credential_id: null, monitoring_project_slug: null, static_scan_config: null,
    pr_credential_id: null, team_id: null, test_env_url: null, test_env_branch: null, main_branch: 'main',
    standards_config: null, llm_tracking_credential_id: null, support_credential_id: null, data_links: null,
    workspace_id: s.workspaceId, enabled: true, kind: 'code',
  }));
  // Projects NOT in Server control yet: what Add app offers (one per workspace, one loose).
  const EXTRA = [
    ['p-billing', 'billing-portal', 'ws-core', 'Next.js,React,TypeScript'],
    ['p-blog', 'studio-blog', 'ws-freelance', 'Astro,TypeScript'],
    ['p-cli', 'deploy-cli', null, 'Node.js,TypeScript'],
  ].map(([id, name, workspace_id, tech_stack], i) => ({
    ...PROJECTS[0], id, name, root_path: `C:\\dev\\${name}`, workspace_id, tech_stack,
    team_id: null, created_at: iso(60 * 24 * (12 - i)),
  }));

  const site = (origin, label, extra = {}) => ({
    origin, label, enabled: true, overrides: {}, budget: 50, credential_id: null,
    scan_status: 'none', scan_tier: null, scan_report: null, scan_at: null,
    first_seen: ago(60 * 24 * 3), last_seen: ago(30), created_by: 'server-control', ...extra,
  });
  const SITES = [
    ...[1420, 3000, 3001, 3002, 3003, 5173, 4173, 4200, 8000, 8080].map((port) => site(`http://localhost:${port}`, `localhost:${port}`)),
    site('https://github.com', 'GitHub', { created_by: 'operator', scan_status: 'confirmed', scan_tier: 2, credential_id: 'cred-gh' }),
    site('https://*.atlassian.net', 'Jira', { created_by: 'operator', scan_status: 'proposed', scan_tier: 1 }),
  ];

  function tape(module, note, servers) {
    return {
      version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
      calls: [
        { cmd: 'dev_servers_list', response: servers },
        { cmd: 'dev_tools_workspace_list', response: WORKSPACES },
        { cmd: 'dev_tools_list_projects', response: [...PROJECTS, ...EXTRA] },
        { cmd: 'browser_sites_list', response: SITES },
      ],
    };
  }

  const FULL = 'Synthetic: ten dev servers in every state over three workspaces, twelve whitelisted origins.';
  return {
    SERVERS,
    builders: {
      'browser/servers/rack': () => tape('browser/servers/rack', FULL, SERVERS),
      'browser/servers/portmap': () => tape('browser/servers/portmap', FULL, SERVERS),
      'browser/servers/switchboard': () => tape('browser/servers/switchboard', FULL, SERVERS),
      'browser/servers/tiles': () => tape('browser/servers/tiles', FULL, SERVERS),
      'browser/servers/empty': () => tape('browser/servers/empty', 'Synthetic: no app servers yet.', []),
      'browser/servers/add': () => tape('browser/servers/add', 'Synthetic: the Add app picker open over the full fleet; three projects are not in the view yet.', SERVERS),
    },
  };
}
