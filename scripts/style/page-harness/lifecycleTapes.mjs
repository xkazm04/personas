// Synthetic tapes for spark lifecycle-health: Teams > Lifecycle
// (lifecycleSurfaces.tsx). The snapshot mirrors `healthyMix()` in
// src/features/plugins/dev-tools/sub_lifecycle/journey/__tests__/fixtures.ts
// (Solo v0, every one of the six health verdicts, a null metric, the Overseer
// goal), plus a dozen changes of evidence so the beads have something to say.
// Fixture CODE, no personal data. Keep it in step with the TS fixture.
//
//   plugins/lifecycle/collar   Layer 1, the collar rail; measured 30 min ago on the base tip
//   plugins/lifecycle/empty    the collar rail with `health: []` (the backend before WP1), never measured
//   plugins/lifecycle/behind   the collar rail measured 2 days ago, 14 commits behind the base tip
//   plugins/lifecycle/loading  the snapshot never answers: the header's chrome and the Layer-1 ghost
//   plugins/lifecycle/regressed  the rail one measure after a bad day: most steps worse than their earlier measure
//   plugins/lifecycle/history-failed  the collar, with the Measure history read failing (wave 3)
//
// Every tape answers `dev_tools_lifecycle_history` (wave 3): twelve Measures
// (lifecycleHistoryTape.mjs) whose newest two are the collar's Gate and Tests;
// `empty` and `loading` answer an empty history.
import { lifecycleHistory } from './lifecycleHistoryTape.mjs';

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

  const health = (stepId, verdict, reason, metrics = [], measuredAt = null, staleOf = null, previous = null) => ({
    stepId, health: verdict, staleOf, reason,
    metrics: metrics.map(([key, value, samples]) => ({ key, value, samples })),
    measuredAt, headSha: measuredAt ? 'a1b2c3d' : null, previous,
  });
  // The step as judged one measurement earlier (`previous`, wave 2 of Lifecycle excellence).
  const prev = (verdict, metrics = [], measuredAt = iso(60 * 50)) => ({
    health: verdict,
    metrics: metrics.map(([key, value, samples]) => ({ key, value, samples })),
    measuredAt, headSha: measuredAt ? '9f8e7d6' : null,
  });
  const at = iso(30);
  const HEALTH = [
    health('frame', 'instructed', null),
    health('recall', 'instructed', null),
    health('isolate', 'green', null, [['done_rate', 92, 12]], null, null, prev('green', [['done_rate', 86, 12]])),
    health('sync', 'unmeasured', 'Only 3 changes recorded; 5 are needed', [['done_rate', null, 3]]),
    health('gate', 'amber', 'tsc 74s over 60s budget', [['median_ms', 74000, 10], ['pass_rate', 90, 10]], at, null,
      prev('green', [['median_ms', 52000, 10], ['pass_rate', 100, 10]])),
    health('tests', 'amber', 'Coverage 63% is under the 70% target', [['coverage_pct', 63, 1], ['median_ms', 182000, 10], ['pass_rate', 100, 10]], at, null,
      prev('amber', [['coverage_pct', 61, 1], ['median_ms', 190000, 10], ['pass_rate', 100, 10]])),
    health('docs', 'green', null, [['docs_clean_pct', 92, 38]], at),
    health('commit', 'stale', 'Last measured on an older base tip', [['done_rate', 85, 12]], iso(60 * 24 * 7), 'green',
      prev('green', [['done_rate', 85, 12]], iso(60 * 24 * 9))),
    health('land', 'red', 'Done in 40% of recent changes, 80% needed', [['done_rate', 40, 12]], null, null,
      prev('amber', [['done_rate', 52, 12]])),
    health('record', 'green', null, [['done_rate', 100, 12]], null, null, prev('green', [['done_rate', 100, 12]])),
  ];

  // One measure after a bad day: most steps worse than their earlier measure,
  // four of them changed verdict; sync measured for the first time (better).
  const REGRESSED = [
    health('frame', 'instructed', null),
    health('recall', 'instructed', null),
    health('isolate', 'amber', 'Done in 70% of recent changes, 80% needed', [['done_rate', 70, 12]], null, null, prev('green', [['done_rate', 92, 12]])),
    health('sync', 'green', null, [['done_rate', 85, 7]], null, null, prev('unmeasured', [['done_rate', null, 3]])),
    health('gate', 'red', 'eslint failed in 4 of 10 runs', [['median_ms', 96000, 10], ['pass_rate', 60, 10]], at, null,
      prev('amber', [['median_ms', 74000, 10], ['pass_rate', 90, 10]])),
    health('tests', 'amber', 'Coverage 58% is under the 70% target', [['coverage_pct', 58, 4], ['median_ms', 241000, 10], ['pass_rate', 90, 10]], at, null,
      prev('green', [['coverage_pct', 74, 3], ['median_ms', 182000, 10], ['pass_rate', 100, 10]])),
    health('docs', 'amber', '6 of 38 docs out of date', [['docs_clean_pct', 84, 38]], at),
    health('commit', 'green', null, [['done_rate', 88, 12]], null, null, prev('green', [['done_rate', 95, 12]])),
    health('land', 'red', 'Done in 30% of recent changes, 80% needed', [['done_rate', 30, 12]], null, null,
      prev('red', [['done_rate', 40, 12]])),
    health('record', 'green', null, [['done_rate', 100, 12]], null, null, prev('green', [['done_rate', 100, 12]])),
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

  // The judging rules the backend ships on every snapshot, at their real defaults.
  const RULES = {
    defaultBudgets: [
      { kind: 'lint', budgetMs: 60000 }, { kind: 'typecheck', budgetMs: 60000 }, { kind: 'test', budgetMs: 300000 },
      { kind: 'check', budgetMs: 600000 }, { kind: 'coverage', budgetMs: 600000 }, { kind: 'other', budgetMs: 300000 },
    ],
    coverageGreenPct: 70, docsCleanPct: 90, doneRatePct: 80, amberFloorPct: 50, minSamples: 5,
    stepKinds: [
      { stepId: 'gate', kinds: ['lint', 'typecheck', 'check', 'other'] },
      { stepId: 'tests', kinds: ['test', 'coverage'] },
    ],
  };
  const TIP_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const TIP = { branch: 'main', sha: TIP_SHA, measuredSha: TIP_SHA, commitsBehind: 0, measuredAt: at };

  const snapshot = (overrides = {}) => ({
    projectId: PROJECT_ID, preset: 'solo', version: 0, author: 'default', changeNote: null, createdAt: null,
    installTaskId: null, installTaskStatus: null,
    steps: STEPS, evidence: EVIDENCE, health: HEALTH,
    goal: { goalId: 'goal-1', measurableTotal: 8, measurableGreen: 3, instructed: 2, openItems: 5, items: [] },
    watched: true, measuring: false, progress: null, tip: TIP, rules: RULES, ...overrides,
  });

  const PROJECT = {
    id: PROJECT_ID, name: 'Atlas Web', root_path: 'C:/code/atlas', description: 'Atlas Web, a product codebase.',
    status: 'active', tech_stack: 'TypeScript, React, Vite', github_url: null, monitoring_credential_id: null,
    monitoring_project_slug: null, static_scan_config: null, pr_credential_id: null, llm_tracking_credential_id: null,
    support_credential_id: null, data_links: null, test_env_url: null, test_env_branch: null, main_branch: 'main',
    standards_config: null, team_id: null, workspace_id: null, kind: 'code', enabled: true,
    created_at: iso(60 * 24 * 90), updated_at: iso(60 * 24 * 2),
  };

  const HISTORY = lifecycleHistory({ iso, TIP_SHA });
  const NO_HISTORY = { measures: [], stepIds: ['gate', 'tests'] };

  function tape(module, note, snap, history = HISTORY) {
    return {
      version: 1, module, source: 'synthetic', recordedAt: RECORDED_AT, note,
      calls: [
        snap === 'hang' ? { cmd: 'dev_tools_get_lifecycle', hang: true } : { cmd: 'dev_tools_get_lifecycle', response: snap },
        { cmd: 'dev_tools_list_projects', response: [PROJECT] },
        { cmd: 'dev_tools_workspace_list', response: [] },
        history === 'fail'
          ? { cmd: 'dev_tools_lifecycle_history', error: 'database is locked' }
          : { cmd: 'dev_tools_lifecycle_history', response: history },
      ],
    };
  }

  const MIX = 'Synthetic: Solo v0 with all six health verdicts, a null metric, the Overseer goal and twelve changes of evidence.';
  return {
    PROJECT,
    HISTORY,
    builders: {
      'plugins/lifecycle/collar': () => tape('plugins/lifecycle/collar', `${MIX} Twelve Measures of history.`, snapshot()),
      'plugins/lifecycle/history-failed': () => tape('plugins/lifecycle/history-failed', `${MIX} The Measure history read fails.`, snapshot(), 'fail'),
      'plugins/lifecycle/empty': () => tape('plugins/lifecycle/empty', 'Synthetic: no health rows and no goal (the backend before WP1), never measured.', snapshot({
        health: [], goal: null, watched: false, tip: { branch: 'main', sha: TIP_SHA, measuredSha: null, commitsBehind: null, measuredAt: null },
      }), NO_HISTORY),
      'plugins/lifecycle/behind': () => tape('plugins/lifecycle/behind', `${MIX} Measured 2 days ago, 14 commits behind main.`, snapshot({
        tip: { branch: 'main', sha: TIP_SHA, measuredSha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432', commitsBehind: 14, measuredAt: iso(60 * 48) },
      })),
      'plugins/lifecycle/regressed': () => tape('plugins/lifecycle/regressed', 'Synthetic: one measure after a bad day - most steps worse than their earlier measure, four changed verdict, sync measured for the first time.', snapshot({
        health: REGRESSED,
        goal: { goalId: 'goal-1', measurableTotal: 8, measurableGreen: 3, instructed: 2, openItems: 7, items: [] },
      })),
      'plugins/lifecycle/loading': () => tape('plugins/lifecycle/loading', 'Synthetic: the snapshot never answers, so the page shows its permanent header and the Layer-1 ghost.', 'hang', NO_HISTORY),
    },
  };
}
