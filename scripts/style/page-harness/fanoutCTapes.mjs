// console-style fan-out, partition C: synthetic tape builders for fanoutCSurfaces.tsx.
// Owned by the partition-C builder; synthetic-tapes.mjs spreads it (wired by the Director).
// Fixture CODE with fake data only.
export function fanoutCTapes({ RECORDED_AT, PERSONAS }) {
  const COMPANIONS = {
    companions: [
      { id: 'athena', enabled: true, eligible: true, onboarded: true, detail: { pendingDecisions: 3 } },
      { id: 'overseer', enabled: true, eligible: true, onboarded: true, detail: { starredCount: 3, agentsTotal: 16 } },
      { id: 'curator', enabled: false, eligible: false, blocker: 'no_registry', onboarded: true, detail: {} },
    ],
  };
  const ago = (m) => new Date(Date.parse(RECORDED_AT) - m * 60_000).toISOString();
  const entry = (name, path, kind, size, m, mime = null, extension = null) => ({ name, path, kind, size, modified: ago(m), mime, extension });
  const ROOT = [
    entry('exports', 'exports', 'folder', 0, 30), entry('reports', 'reports', 'folder', 0, 600), entry('invoices', 'invoices', 'folder', 0, 3000),
    entry('weekly-digest.md', 'weekly-digest.md', 'file', 4210, 45, 'text/markdown', 'md'),
    entry('q3-summary.pdf', 'q3-summary.pdf', 'file', 884211, 190, 'application/pdf', 'pdf'),
    entry('customers.csv', 'customers.csv', 'file', 52311, 1500, 'text/csv', 'csv'),
    entry('roadmap.json', 'roadmap.json', 'file', 9120, 5000, 'application/json', 'json'),
  ];
  const DRIVE = [
    { cmd: 'drive_get_root', response: 'C:/Users/demo/AppData/Roaming/personas/drive' },
    { cmd: 'drive_storage_info', response: { root: 'C:/Users/demo/AppData/Roaming/personas/drive', usedBytes: 951852, entryCount: 7, isDev: false } },
    { cmd: 'drive_list', response: ROOT },
    { cmd: 'drive_recent', response: ROOT.filter((e) => e.kind === 'file').slice(0, 4) },
    { cmd: 'drive_list_tree', response: { name: '', path: '', hasMoreChildren: false, children: ROOT.filter((e) => e.kind === 'folder').map((e) => ({ name: e.name, path: e.path, children: [], hasMoreChildren: false })) } },
    { cmd: 'list_credentials', response: [] },
    { cmd: 'list_knowledge_bases', response: [] },
    { cmd: 'list_document_signatures', response: [] },
  ];
  const base = [{ cmd: 'list_personas', response: PERSONAS }, { cmd: 'companions_status', response: COMPANIONS }];

  // Curator > Process: a deterministic month of development sessions (no randomness, so before/after shots compare).
  const KINDS = ['brief', 'read', 'grep', 'edit', 'bash', 'test', 'commit', 'wait', 'interrupt'];
  const PHASES = { brief: 'brief', read: 'explore', grep: 'explore', edit: 'edit', bash: 'verify', test: 'verify', commit: 'ship' };
  const PROJECTS = ['personas', 'personas-web', 'ai-registry', 'garden-vr'];
  const lcg = (seed) => { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };
  const SESSIONS = Array.from({ length: 56 }, (_, i) => {
    const r = lcg(i + 7);
    const steps = [];
    let t = 0;
    const n = 14 + Math.floor(r() * 22);
    for (let k = 0; k < n; k++) {
      const stage = k / n;
      const pool = stage < 0.12 ? [0, 1] : stage < 0.4 ? [1, 2, 1, 2, 3] : stage < 0.75 ? [3, 3, 1, 4, 5] : [5, 4, 6, 3];
      let kind = pool[Math.floor(r() * pool.length)];
      if (r() < 0.04) kind = 8;
      const span = 4 + Math.floor(r() * 50);
      steps.push([kind, 0, r() < 0.07 ? 1 : 0, t, span, null]);
      t += span + Math.floor(r() * 90);
    }
    return {
      id: 's' + String(i).padStart(3, '0'), project: PROJECTS[Math.floor(r() * PROJECTS.length)], wt: r() < 0.4 ? 1 : 0,
      mode: i % 3 === 0 ? 'headless' : 'interactive', model: 'sonnet', effort: 'medium',
      start: new Date(Date.parse(RECORDED_AT) - (i + 1) * 5.5 * 3600_000).toISOString(),
      dur: t, active: Math.round(t * 0.7), prompts: 3 + Math.floor(r() * 20), interrupts: r() < 0.15 ? 1 : 0, compactions: 0,
      errors: r() < 0.2 ? 1 : 0, commits: r() < 0.55 ? 1 + Math.floor(r() * 3) : 0, skills: [], steps,
    };
  });
  const PROCESS = [{ cmd: 'curator_process_read', response: { kinds: KINDS, phases: PHASES, sessions: SESSIONS, source: { scanned: 62, parsed: 62, cached: 56 } } }];

  // Curator > Blueprint: a plan wide enough to rank, plus policy, projects, runtime and an empty lane.
  const SUBJECTS = [
    ['agent-memory', 'llm-agent/prompt-and-context', 'deviation', 56, 'conform'], ['retrieval', 'llm-agent/prompt-and-context', 'deviation', 48, 'conform'],
    ['prompt-assembly', 'llm-agent/prompt-and-context', 'stale_applications', 41, 'sweep'], ['error-handling', 'backend-platform/resilience', 'deviation', 37, 'conform'],
    ['retry-backoff', 'backend-platform/resilience', 'thin_techniques', 30, 'forge'], ['credential-vault', 'security/identity-and-access', 'deviation', 26, 'conform'],
    ['i18n', 'client-architecture', 'stale_applications', 21, 'sweep'], ['migrations', 'backend-platform/data-layer', 'thin_techniques', 14, 'forge'],
    ['scheduling', 'backend-platform/work-execution', 'deviation', 9, 'conform'], ['czech', 'european', 'thin_techniques', 4, 'forge'],
  ];
  const reasonOf = (code, w) => ({ code, weight: w, detail: code === 'deviation' ? Math.round(w / 4) + ' consumer deviation(s)' : code === 'thin_techniques' ? '3 techniques (design floor is 4)' : '5 applications past their clock' });
  const ITEMS = SUBJECTS.map(([slug, at, code, points, engine], i) => ({
    id: 'software-engineering/' + slug, planRunId: 'plan-1', subjectId: 'software-engineering/' + slug, domain: i === 9 ? 'localization' : 'software-engineering',
    at: at + '/' + slug, points, reasons: [reasonOf(code, points)], dominantReason: code, engine, techniques: 12 + i * 3, applications: 9 + i * 2, stacks: ['rust'],
    demandKnown: i !== 9, demand: i === 9 ? null : { consults: 6 - (i % 4), deviations: 14 - i, deviationsSummed: 28 - i * 2, gone: 0, goneSummed: 0, contributors: 2 },
    lastSwept: '2026-09-07', registryDryStreak: 0, suppressedBySaturation: false, hasAppliedRow: true,
    state: i < 2 ? 'dispatched' : i === 8 ? 'declined' : 'planned', declinedReason: i === 8 ? 'Already judged today' : null, dispatchedRunId: null, evidenceRef: null, updatedAt: '2026-09-23T07:40:00Z',
  }));
  const POLICY = { levelResearch: 'L1', levelForge: 'L0', levelConform: 'L3', levelSweep: 'L1', levelMethod: 'L0', dailyBudgetUsd: null, dailyRunCap: 12, dailyCommitCap: null, quietHours: null, backpressureN: 8, workerCap: 1 };
  const PLAN = {
    run: {
      id: 'plan-1', createdAt: '2026-09-23T07:40:00Z', scanGeneratedAt: '2026-09-22T22:39:52.343Z', registryHeadSha: 'cc01b2b8',
      corpus: { generatedAt: '2026-09-22T22:39:52.343Z', today: '2026-09-23', subjects: 235, techniques: 3274, applications: 1825, domains: 2, demandKnownForAnyBundle: true, appliedSubjects: null, expiredApplications: 0, atRiskApplications: 4, driftUnknown: 505, drift: 77, noClockApplications: 301, demandKnownDomains: ['software-engineering'] },
      consumers: { generatedAt: '2026-09-22T22:39:52.343Z', mapsStale: false, projects: [{ slug: 'personas', contexts: 215, pairs: 1765, weak: 12, evaluated: 1179, deviations: 122, staleVerdicts: 47, state: 'FRESH', orphaned: 0 }], totals: { projects: 1, pairs: 1765, evaluated: 1179, weak: 12, staleVerdicts: 47, staleProjects: 0, orphaned: 0 }, problems: [] },
      policy: POLICY, itemCount: ITEMS.length, supersededBy: null,
    },
    items: ITEMS,
    quiet: [{ domain: 'software-engineering', subjects: 180, demandKnown: true }, { domain: 'localization', subjects: 17, demandKnown: false }],
  };
  const BLUEPRINT = [
    { cmd: 'curator_plan_current', response: PLAN },
    { cmd: 'curator_policy_get', response: POLICY },
    { cmd: 'curator_projects_list', response: [{ slug: 'personas', rootPath: 'C:/dev/personas', enabled: true, consentState: 'granted', grantedAt: ago(9000), lastSeenAt: ago(5), createdAt: ago(20000), updatedAt: ago(5) }] },
    { cmd: 'curator_requests_list', response: [] },
    { cmd: 'curator_requests_history', response: [] },
    { cmd: 'curator_skills_list', response: [] },
    { cmd: 'curator_runtime_get', response: { enabled: true, running: 1, workerCap: 2, fannedOut: null, lane: 'queue', haltedReason: null, spentTodayUsd: 0, dailyBudgetUsd: 20, runsToday: 3, dailyRunCap: 12, commitsToday: 1, dailyCommitCap: 3, lastSleepAt: null } },
  ];
  const extra = { 'plugins/drive': DRIVE, 'curator/process': PROCESS, 'curator/blueprint': BLUEPRINT };
  const tape = (id, note) => () => ({ version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note, calls: [...base, ...(extra[id] ?? [])] });
  const ids = ['plugins/browse', 'companions/landing', 'athena/setup', 'athena/memory', 'athena/decisions', 'curator/council', 'curator/blueprint', 'curator/process', 'plugins/drive', 'twin/profiles', 'twin/hub', 'plugins/obsidian-brain', 'plugins/gitlab', 'studio'];
  return { builders: Object.fromEntries(ids.map((id) => [id, tape(id, 'Synthetic (partition C): companions status, personas.')])) };
}
