// Synthetic tapes for spark lifecycle-health WP4: Teams > Lifecycle with its
// Layer-2 step screens (lifecycleSurfaces.tsx). Built ON the WP3 Layer-1 tape
// (lifecycleTapes.mjs, the `collar` builder, unchanged) plus:
//
// - `dev_tools_lifecycle_step_detail` answers per step (args-matched): the
//   gate and tests runs of the twelve Measures of history (wave 3; the newest
//   with a passing-but-over-budget tsc, a failed eslint with its first error, a
//   timed-out check and a command that did not run); coverage runs climbing
//   from 44% to 63%; the doc-rot rows;
// - notes on a few evidence outcomes, so a step's evidence rows and the docs
//   change modal have something to say;
// - (Lifecycle excellence wave 5) every step's `related` backlog items and
//   `evidence`: a slow-gate item about tsc and an Overseer item on Gate, a
//   doc-rot item on Docs, and Land's and Record's own change history (Land's
//   skips carry the notes its Next panel counts; Record is done every time).
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


  // The gate and tests runs ARE the history's runs (lifecycleHistoryTape.mjs), newest Measure
  // first, so a Measure picked on a step's strip finds its runs by `measureId`. The newest
  // Measure keeps the old shot's story: tsc over budget, eslint failed with its first error, a
  // timed-out check and a clippy that did not run (also the Measure before it).
  const { HISTORY } = lifecycleTapes({ RECORDED_AT });
  const COMMAND = {
    tsc: 'npx tsc --noEmit', eslint: 'npm run lint', check: 'npm run check', clippy: 'cargo clippy -- -D warnings',
    vitest: 'npx vitest run', coverage: 'npx vitest run --coverage',
  };
  const ESLINT_ERROR = "src/features/vault/VaultPage.tsx:41:7  error  'draft' is assigned a value but never used  @typescript-eslint/no-unused-vars";
  const runsOf = (kinds) => HISTORY.measures.flatMap((col) => col.runs
    .filter((r) => kinds.includes(r.kind))
    .map((r) => ({
      id: `${col.measureId}-${r.commandId}`, projectId: PROJECT_ID, measureId: col.measureId, commandId: r.commandId,
      command: COMMAND[r.commandId] ?? r.commandId, kind: r.kind, outcome: r.outcome,
      exitCode: r.outcome === 'passed' ? 0 : r.outcome === 'failed' ? 1 : null, durationMs: r.durationMs, valuePct: r.valuePct,
      firstError: r.outcome === 'failed' && r.commandId === 'eslint' ? ESLINT_ERROR : null,
      headSha: col.headSha.slice(0, 7), startedAt: col.startedAt, finishedAt: col.finishedAt,
    })));
  const gateRuns = runsOf(['typecheck', 'lint', 'check', 'other']);
  const testsRuns = runsOf(['test', 'coverage']);

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

  const item = (id, title, status, source, commandId, minutes) => ({ id, title, status, verifyState: null, source, commandId, createdAt: iso(minutes) });
  const GATE_RELATED = [
    item('idea-slow-tsc', 'npx tsc --noEmit runs over its 1m budget', 'accepted', 'slow_gate', 'tsc', 60 * 20),
    item('idea-ov-gate', 'Bring Gate back to green: eslint fails on VaultPage.tsx', 'accepted', 'overseer', null, 60 * 5),
    item('idea-slow-check', 'npm run check ran past its 10m budget', 'delivered', 'slow_gate', 'check', 60 * 24 * 6),
  ];
  const DOCS_RELATED = [
    item('idea-rot-vault', 'docs/features/vault/vault.md names files that are gone', 'pending', 'doc_rot', null, 60 * 2),
    item('idea-rot-fleet', 'docs/features/fleet/fleet.md is behind its sources', 'pending', 'doc_rot', null, 60 * 26),
  ];
  // A step's own change history, newest first, each carrying only that step's outcome.
  const LAND_NOTES = ['Merged locally; the pull request was never opened', 'Pushed straight to main'];
  const stepEvidence = (stepId, outcomeOf) => Array.from({ length: 12 }, (_, i) => {
    const [outcome, detail] = outcomeOf(i);
    return {
      sourceKind: i % 4 === 0 ? 'task' : 'commit', sourceRef: `c${String(12 - i).padStart(2, '0')}`,
      title: `Change ${12 - i}`, occurredAt: iso(90 * (i + 1)), outcomes: [{ stepId, outcome, detail }],
    };
  });
  const landEvidence = stepEvidence('land', (i) => (i % 12 < 7 ? ['skipped', i === 6 ? null : LAND_NOTES[i % 3 === 2 ? 1 : 0]] : ['done', null]));
  const recordEvidence = stepEvidence('record', () => ['done', null]);

  const DETAIL = {
    gate: { stepId: 'gate', runs: gateRuns, docs: [], related: GATE_RELATED, evidence: [] },
    tests: { stepId: 'tests', runs: testsRuns, docs: [], related: [], evidence: [] },
    docs: { stepId: 'docs', runs: [], docs, related: DOCS_RELATED, evidence: [] },
    land: { stepId: 'land', runs: [], docs: [], related: [], evidence: landEvidence },
    record: { stepId: 'record', runs: [], docs: [], related: [], evidence: recordEvidence },
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
        response: details[stepId] ?? { stepId, runs: [], docs: [], related: [], evidence: [] },
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
      }, { ...DETAIL, tests: { stepId: 'tests', runs: testsRuns.filter((r) => r.kind !== 'coverage'), docs: [], related: [], evidence: [] } }),
    },
  };
}
