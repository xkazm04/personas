// Synthetic tapes for Lifecycle excellence wave 6: Gate and Tests as
// instruments (lifecycleSurfaces.tsx). Built ON the Layer-2 detail tape
// (lifecycleDetailTapes.mjs, the `detail` builder, unchanged) plus:
//
// - Gate's runs with one SLOWING command: tsc's two Measures before the newest
//   took 79 s and 77 s (the newest already 74 s), so its last three average
//   76.7 s against a prior median of 55 s (> 1.3x), and the slow-gate item
//   about tsc is on the backlog. eslint is FLAKY from the history's own story
//   (it flips 3 times in its last 10 answered runs).
// - `dev_tools_lifecycle_run_output` replies, args-matched by run id:
//   eslint's newest run (failed) has stdout and a stderr holding its first
//   error; the newest check (timed out) and clippy (did not run) kept nothing
//   (`null`); every other run printed a short passing log (the wildcard).
//
// Shots (the step is opened with --steps, see lifecycleSurfaces.tsx):
//   gate rows          click=[data-testid=lc-node-gate];wait=900
//   viewer, failed     ...;click=[data-testid=lc2-spark-eslint] div[data-bar]:last-of-type;wait=900
//   viewer, not run    ...;click=[data-testid=lc2-spark-clippy] div[data-bar]:last-of-type;wait=900
//   sorted by slowest  ...;click=[data-testid=lc6-gate-toolbar] .k-seg button:nth-child(2);wait=600
//   tests              click=[data-testid=lc-node-tests];wait=900
// Fixture CODE, no personal data. The unit tests use journey/__tests__/gateFixtures.ts.
//
//   plugins/lifecycle/gate   the detail tape with the wave-6 gate runs and run outputs
//   plugins/lifecycle/perf   the same tape, the page under a Profiler (wave 10, scripts/style/lifecycle-perf.mjs)
import { lifecycleDetailTapes } from './lifecycleDetailTapes.mjs';

const PROJECT_ID = 'p-atlas';
const ESLINT_ERROR = "src/features/vault/VaultPage.tsx:41:7  error  'draft' is assigned a value but never used  @typescript-eslint/no-unused-vars";

const ESLINT_OUTPUT = [
  '--- stdout ---',
  '> atlas-web@0.9.0 lint',
  '> eslint src/ --max-warnings 0',
  '',
  'src/features/vault/VaultPage.tsx',
  '--- stderr ---',
  ...Array.from({ length: 18 }, (_, i) => `src/features/vault/parts/Row${i + 1}.tsx:${10 + i}:5  warning  Prefer a typed payload  custom/untyped-command-payload`),
  ESLINT_ERROR,
  'src/features/vault/VaultPage.tsx:58:3  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any',
  '',
  '20 problems (1 error, 19 warnings)',
  '',
].join('\n');

const PASS_OUTPUT = ['--- stdout ---', '> atlas-web@0.9.0 check', '', 'Checked 1,243 files in 52s', 'No problems found.', '--- stderr ---', ''].join('\n');

export function lifecycleGateTapes({ RECORDED_AT }) {
  const base = lifecycleDetailTapes({ RECORDED_AT }).builders['plugins/lifecycle/detail'];

  function build() {
    const tape = base();
    tape.module = 'plugins/lifecycle/gate';
    tape.note = 'Synthetic: the Layer-2 detail tape with a slowing tsc, a flaky eslint and every run’s stored output.';
    const gate = tape.calls.find((c) => c.cmd === 'dev_tools_lifecycle_step_detail' && c.args?.stepId === 'gate');
    const slow = { 'm-11-tsc': 79_000, 'm-10-tsc': 77_000 };
    gate.response = {
      ...gate.response,
      runs: gate.response.runs.map((r) => (slow[r.id] ? { ...r, durationMs: slow[r.id] } : r)),
    };
    const reply = (runId, response) => ({ cmd: 'dev_tools_lifecycle_run_output', args: { projectId: PROJECT_ID, runId }, response });
    // The wildcard first: an args-matched entry wins over it.
    tape.calls.push({ cmd: 'dev_tools_lifecycle_run_output', response: PASS_OUTPUT });
    tape.calls.push(reply('m-12-eslint', ESLINT_OUTPUT));
    tape.calls.push(reply('m-12-check', null));
    tape.calls.push(reply('m-12-clippy', null));
    tape.calls.push(reply('m-11-clippy', null));
    return tape;
  }

  function perf() {
    const tape = build();
    tape.module = 'plugins/lifecycle/perf';
    tape.note = `${tape.note} The page under a React Profiler.`;
    return tape;
  }

  return { builders: { 'plugins/lifecycle/gate': build, 'plugins/lifecycle/perf': perf } };
}
