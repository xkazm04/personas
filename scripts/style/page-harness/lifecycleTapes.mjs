// Synthetic tapes for spark lifecycle-health: Teams > Lifecycle
// (lifecycleSurfaces.tsx). The snapshot mirrors `healthyMix()` in
// src/features/plugins/dev-tools/sub_lifecycle/journey/__tests__/fixtures.ts
// (Solo v0, every one of the six health verdicts, a null metric, the Overseer
// goal), plus a dozen changes of evidence so the beads have something to say.
// Fixture CODE, no personal data. Keep it in step with the TS fixture.
//
//   plugins/lifecycle/collar   Layer 1, the collar rail
//   plugins/lifecycle/empty    the collar rail with `health: []` (the backend before WP1)

export function lifecycleTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const iso = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const PROJECT_ID = 'p-atlas';

  const PARAMS = {
    lint: null, codeQuality: null, docsRequired: null, landMode: null,
    prBase: null, automergeEnabled: null, automergeTarget: null,
    commands: null, coverageGreenPct: null, docsCleanPct: null, doneRatePct: null,
  };
  const step = (id, phase, bindings, tally = {}) => ({
    step: { id, phase, label: null, rule: `Rule for ${id}.`, bindings: bindings.map(([k]) => k), params: PARAMS },
    bindingViews: bindings.map(([kind, state]) => ({ kind, state, detail: null })),
    evidence: { done: 0, skipped: 0, unknown: 0, failed: 0, ...tally },
  });
  const STEPS = [
    step('frame', 'before', [['app', 'live']]),
    step('recall', 'before', [['claude_md', 'detected']]),
    step('isolate', 'before', [['app', 'live']], { done: 11, skipped: 1 }),
    step('sync', 'before', [['app', 'live']], { done: 3 }),
    step('gate', 'after', [['hook', 'detected']], { done: 10, failed: 1 }),
    step('tests', 'after', [['advisory', 'advisory']], { done: 9, skipped: 2 }),
    step('docs', 'after', [['advisory', 'advisory']], { done: 8, skipped: 3 }),
    step('commit', 'after', [['hook', 'detected']], { done: 10, skipped: 2 }),
    step('land', 'after', [['app', 'live']], { done: 5, skipped: 7 }),
    step('record', 'after', [['app', 'live']], { done: 12 }),
  ];

  const health = (stepId, verdict, reason, metrics = [], measuredAt = null, staleOf = null) => ({
    stepId, health: verdict, staleOf, reason,
    metrics: metrics.map(([key, value, samples]) => ({ key, value, samples })),
    measuredAt, headSha: measuredAt ? 'a1b2c3d' : null,
  });
  const at = iso(30);
  const HEALTH = [
    health('frame', 'instructed', null),
    health('recall', 'instructed', null),
    health('isolate', 'green', null, [['done_rate', 92, 12]]),
    health('sync', 'unmeasured', 'Only 3 changes recorded; 5 are needed', [['done_rate', null, 3]]),
    health('gate', 'amber', 'tsc 74s over 60s budget', [['median_ms', 74000, 10], ['pass_rate', 90, 10]], at),
    health('tests', 'amber', 'Coverage 63% is under the 70% target', [['coverage_pct', 63, 1], ['median_ms', 182000, 10], ['pass_rate', 100, 10]], at),
    health('docs', 'green', null, [['docs_clean_pct', 92, 38]], at),
    health('commit', 'stale', 'Last measured on an older base tip', [['done_rate', 85, 12]], iso(60 * 24 * 7), 'green'),
    health('land', 'red', 'Done in 40% of recent changes, 80% needed', [['done_rate', 40, 12]]),
    health('record', 'green', null, [['done_rate', 100, 12]]),
  ];

  // Twelve changes, newest first. `land` is skipped in most of them (its red),
  // `gate` failed once, everything else mostly done.
  const EVIDENCE = Array.from({ length: 12 }, (_, i) => {
    const o = (stepId, outcome) => ({ stepId, outcome, detail: null });
    return {
      sourceKind: i % 4 === 0 ? 'task' : 'commit',
      sourceRef: `c${String(12 - i).padStart(2, '0')}`,
      title: `Change ${12 - i}`,
      occurredAt: iso(90 * (i + 1)),
      outcomes: [
        o('isolate', i === 5 ? 'skipped' : 'done'),
        o('gate', i === 2 ? 'failed' : 'done'),
        o('tests', i % 5 === 1 ? 'skipped' : 'done'),
        o('docs', i % 4 === 3 ? 'skipped' : 'done'),
        o('commit', i % 6 === 4 ? 'skipped' : 'done'),
        o('land', i % 12 < 7 ? 'skipped' : 'done'),
        o('record', 'done'),
      ],
    };
  });

  const snapshot = (overrides = {}) => ({
    projectId: PROJECT_ID, preset: 'solo', version: 0, author: 'default', changeNote: null, createdAt: null,
    installTaskId: null, installTaskStatus: null,
    steps: STEPS, evidence: EVIDENCE, health: HEALTH,
    goal: { goalId: 'goal-1', measurableTotal: 8, measurableGreen: 3, instructed: 2, openItems: 5 },
    watched: true, measuring: false, ...overrides,
  });

  const PROJECT = {
    id: PROJECT_ID, name: 'Atlas Web', root_path: 'C:/code/atlas', description: 'Atlas Web, a product codebase.',
    status: 'active', tech_stack: 'TypeScript, React, Vite', github_url: null, monitoring_credential_id: null,
    monitoring_project_slug: null, static_scan_config: null, pr_credential_id: null, llm_tracking_credential_id: null,
    support_credential_id: null, data_links: null, test_env_url: null, test_env_branch: null, main_branch: 'main',
    standards_config: null, team_id: null, workspace_id: null, kind: 'code', enabled: true,
    created_at: iso(60 * 24 * 90), updated_at: iso(60 * 24 * 2),
  };

  function tape(module, note, snap) {
    return {
      version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
      calls: [
        { cmd: 'dev_tools_get_lifecycle', response: snap },
        { cmd: 'dev_tools_list_projects', response: [PROJECT] },
        { cmd: 'dev_tools_workspace_list', response: [] },
      ],
    };
  }

  const MIX = 'Synthetic: Solo v0 with all six health verdicts, a null metric, the Overseer goal and twelve changes of evidence.';
  return {
    PROJECT,
    builders: {
      'plugins/lifecycle/collar': () => tape('plugins/lifecycle/collar', MIX, snapshot()),
      'plugins/lifecycle/empty': () => tape('plugins/lifecycle/empty', 'Synthetic: no health rows and no goal (the backend before WP1).', snapshot({ health: [], goal: null, watched: false })),
    },
  };
}
