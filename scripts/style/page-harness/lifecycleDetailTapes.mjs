// Synthetic tapes for spark lifecycle-health WP4: Teams > Lifecycle with its
// Layer-2 step screens (lifecycleSurfaces.tsx). Built ON the WP3 Layer-1 tape
// (lifecycleTapes.mjs, the `collar` builder, unchanged) plus:
//
// - `dev_tools_lifecycle_step_detail` answers per step (args-matched): a gate
//   history with a passing-but-over-budget tsc, a failed eslint with its first
//   error, a timed-out check and a command that did not run; a tests history
//   with coverage runs; the doc-rot rows;
// - notes on a few evidence outcomes, so a step's evidence rows and the docs
//   change modal have something to say.
//
// The shooter opens a step with `--steps "click=[data-testid=lc-node-<id>]"`.
// Fixture CODE, no personal data. Mirrors journey/__tests__/detailFixtures.ts.
//
//   plugins/lifecycle/detail         every step's detail; coverage measured
//   plugins/lifecycle/detail-nocov   the same with Tests' coverage unmeasured
import { lifecycleTapes } from './lifecycleTapes.mjs';

export function lifecycleDetailTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const iso = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const PROJECT_ID = 'p-atlas';
  const base = lifecycleTapes({ RECORDED_AT }).builders['plugins/lifecycle/collar'];

  let n = 0;
  const run = (commandId, command, kind, outcome, durationMs, extra = {}) => {
    n += 1;
    const at = iso(45 + n * 90);
    return {
      id: `run-${n}`, projectId: PROJECT_ID, measureId: `m-${Math.ceil(n / 4)}`, commandId, command, kind, outcome,
      exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null, durationMs, valuePct: null,
      firstError: null, headSha: 'a1b2c3d', startedAt: at, finishedAt: at, ...extra,
    };
  };

  const gateRuns = [];
  const tscTimes = [74000, 71000, 66000, 61000, 58000, 57000, 55000, 52000];
  const lintTimes = [21000, 19500, 20100, 18700, 19900, 18100, 17800, 18300];
  for (let i = 0; i < 8; i++) {
    gateRuns.push(run('tsc', 'npx tsc --noEmit', 'typecheck', 'passed', tscTimes[i]));
    gateRuns.push(run('eslint', 'npm run lint', 'lint', i === 0 ? 'failed' : 'passed', lintTimes[i], i === 0
      ? { firstError: "src/features/vault/VaultPage.tsx:41:7  error  'draft' is assigned a value but never used  @typescript-eslint/no-unused-vars" }
      : {}));
    gateRuns.push(run('check', 'npm run check', 'check', i === 0 ? 'timeout' : 'passed', i === 0 ? 1_200_000 : 412000 - i * 3000));
    gateRuns.push(run('clippy', 'cargo clippy -- -D warnings', 'other', i < 2 ? 'did_not_run' : 'passed', i < 2 ? 0 : 128000 + i * 900));
  }

  const testsRuns = [];
  const cov = [63, 61, 60, 58, 57, 55, 52, 50];
  for (let i = 0; i < 8; i++) {
    testsRuns.push(run('vitest', 'npx vitest run', 'test', 'passed', 182000 - i * 1500));
    testsRuns.push(run('coverage', 'npx vitest run --coverage', 'coverage', 'passed', 240000 - i * 2000, { valuePct: cov[i] }));
  }

  const doc = (docPath, status, extra = {}) => ({ docPath, status, changedSources: [], brokenRefs: [], scannedAt: iso(120), ...extra });
  const docs = [
    doc('docs/features/vault/vault.md', 'broken', { brokenRefs: ['src/features/vault/store/oldStore.ts', 'src/features/vault/VaultList.tsx'] }),
    doc('docs/features/fleet/fleet.md', 'stale', { changedSources: ['src/features/fleet/sub_grid/FleetGridPage.tsx', 'src/features/fleet/fleetModel.ts'] }),
    doc('docs/features/home/home.md', 'stale', { changedSources: ['src/features/home/HomePage.tsx'] }),
    doc('docs/notes/ideas.md', 'unverifiable'),
    doc('README.md', 'clean'),
    ...Array.from({ length: 29 }, (_, i) => doc(`docs/features/area-${String(i + 1).padStart(2, '0')}/overview.md`, 'clean')),
  ];
  // The docs verdict as the backend derives it from these rows: any broken doc is red, the
  // clean share is clean / verifiable (unverifiable docs are outside the denominator).
  const verifiable = docs.filter((d) => d.status !== 'unverifiable').length;
  const cleanPct = Math.round((docs.filter((d) => d.status === 'clean').length / verifiable) * 1000) / 10;

  const DETAIL = {
    gate: { stepId: 'gate', runs: gateRuns, docs: [] },
    tests: { stepId: 'tests', runs: testsRuns, docs: [] },
    docs: { stepId: 'docs', runs: [], docs },
  };
  const NOTES = {
    'c12:land': 'Merged locally; the pull request was never opened',
    'c11:land': 'Pushed straight to main',
    'c12:docs': 'Updated the vault page doc with the new store name',
    'c09:docs': 'No doc touched; the change renamed two vault components',
    'c11:gate': 'eslint failed on VaultPage.tsx',
  };

  function build(module, note, mutate, details = DETAIL) {
    const tape = base();
    tape.module = module;
    tape.note = note;
    const snap = tape.calls.find((c) => c.cmd === 'dev_tools_get_lifecycle').response;
    snap.evidence = snap.evidence.map((e) => ({
      ...e,
      outcomes: e.outcomes.map((o) => ({ ...o, detail: NOTES[`${e.sourceRef}:${o.stepId}`] ?? o.detail })),
    }));
    snap.evidence[0].title = 'Rename the vault store';
    snap.evidence[1].title = 'Add the fleet grid filters';
    snap.health = snap.health.map((h) => (h.stepId === 'docs'
      ? { ...h, health: 'red', reason: '1 doc names files that are gone', metrics: [{ key: 'docs_clean_pct', value: cleanPct, samples: verifiable }] }
      : h));
    mutate?.(snap);
    for (const stepId of ['frame', 'recall', 'isolate', 'sync', 'gate', 'tests', 'docs', 'commit', 'land', 'record']) {
      tape.calls.push({
        cmd: 'dev_tools_lifecycle_step_detail',
        args: { projectId: PROJECT_ID, stepId },
        response: details[stepId] ?? { stepId, runs: [], docs: [] },
      });
    }
    return tape;
  }

  const MIX = 'Synthetic: the WP3 collar mix plus Layer-2 step detail (gate, tests, docs) and notes on a few evidence outcomes.';
  return {
    builders: {
      'plugins/lifecycle/detail': () => build('plugins/lifecycle/detail', MIX),
      'plugins/lifecycle/detail-nocov': () => build('plugins/lifecycle/detail-nocov', `${MIX} Tests coverage unmeasured.`, (snap) => {
        snap.health = snap.health.map((h) => (h.stepId === 'tests'
          ? { ...h, health: 'unmeasured', reason: 'No coverage command', metrics: h.metrics.map((m) => (m.key === 'coverage_pct' ? { ...m, value: null, samples: 0 } : m)) }
          : h));
      }, { ...DETAIL, tests: { stepId: 'tests', runs: testsRuns.filter((r) => r.kind !== 'coverage'), docs: [] } }),
    },
  };
}
