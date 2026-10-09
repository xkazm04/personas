// Synthetic tapes for Lifecycle excellence wave 4: a Measure as a live event
// (lifecycleSurfaces.tsx). Built ON the collar tape (lifecycleTapes.mjs) and
// the Layer-2 detail tape (lifecycleDetailTapes.mjs, for the first error a
// failed command's line names), with `snapshot.progress` filled in.
//
// The shooter freezes the page clock at RECORDED_AT, so every elapsed time
// here is deterministic: a command "started 40 s ago" reads 40s.
//
//   plugins/lifecycle/measuring       2 done (tsc passed, eslint failed), vitest running 40 s of a 60 s median, 2 waiting
//   plugins/lifecycle/measuring-over  the same with vitest 100 s in: past 1.5x its median (the warning tone)
//   plugins/lifecycle/cancelling      the same Measure with a cancel on its way
//   plugins/lifecycle/measured        the Measure walks to its end while shot: the collar, then
//                                     measuring, then ended (Gate At risk -> Failing, eslint failed),
//                                     the summary in the panel. `responses` replays the three
//                                     snapshots in order; the module's prepare steps the revision.
//
// Mirrors measure/__tests__/progressFixtures.ts. Fixture CODE, no personal data.
import { lifecycleDetailTapes } from './lifecycleDetailTapes.mjs';

export function lifecycleMeasureTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (s) => new Date(T0 - s * 1000).toISOString();
  const base = lifecycleDetailTapes({ RECORDED_AT }).builders['plugins/lifecycle/detail'];
  const TIP_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

  const cmd = (commandId, command, kind, state, extra = {}) => ({
    commandId, command, kind, state, startedAt: null, outcome: null, durationMs: null, medianMs: null, ...extra,
  });
  // `vitestSecs`: how long vitest has been running.
  const progress = (vitestSecs, cancelling = false) => ({
    measureId: 'm-live',
    startedAt: ago(70 + vitestSecs),
    headSha: TIP_SHA,
    cancelling,
    commands: [
      cmd('tsc', 'npx tsc --noEmit', 'typecheck', 'done', { startedAt: ago(70 + vitestSecs), outcome: 'passed', durationMs: 51_000, medianMs: 52_000 }),
      cmd('eslint', 'npm run lint', 'lint', 'done', { startedAt: ago(19 + vitestSecs), outcome: 'failed', durationMs: 18_000, medianMs: 18_500 }),
      cmd('vitest', 'npx vitest run', 'test', 'running', { startedAt: ago(vitestSecs), medianMs: 60_000 }),
      cmd('check', 'npm run check', 'check', 'pending', { medianMs: 380_000 }),
      cmd('coverage', 'npx vitest run --coverage', 'coverage', 'pending'),
    ],
  });

  /** The detail tape, its snapshot replaced by `snaps` (one, or several replayed in order). */
  function tape(module, note, snaps, extra) {
    const t = base();
    t.module = module;
    t.note = note;
    const call = t.calls.find((c) => c.cmd === 'dev_tools_get_lifecycle');
    const collar = call.response;
    const list = snaps(collar);
    delete call.response;
    call.responses = list;
    extra?.(t);
    return t;
  }

  /**
   * The ended Measure as the history and Gate's detail hold it: the newest
   * history column (its runs give the commands the last progress had not
   * finished) and eslint's run with its first error (the panel names it).
   */
  function withLiveMeasure(t) {
    const runs = [
      ['tsc', 'typecheck', 'passed', 51_000], ['eslint', 'lint', 'failed', 18_000], ['vitest', 'test', 'passed', 58_000],
      ['check', 'check', 'passed', 371_000], ['coverage', 'coverage', 'passed', 216_000],
    ].map(([commandId, kind, outcome, durationMs]) => ({ commandId, kind, outcome, durationMs, valuePct: commandId === 'coverage' ? 65 : null }));
    const history = t.calls.find((c) => c.cmd === 'dev_tools_lifecycle_history').response;
    history.measures.unshift({
      measureId: 'm-live', headSha: TIP_SHA, startedAt: ago(714), finishedAt: ago(0), durationMs: runs.reduce((a, r) => a + r.durationMs, 0),
      cells: [
        { stepId: 'gate', health: 'red', reason: 'eslint failed in 2 of 10 runs', metrics: [{ key: 'median_ms', value: 72_000, samples: 10 }, { key: 'pass_rate', value: 80, samples: 10 }] },
        { stepId: 'tests', health: 'amber', reason: 'Coverage 65% is under the 70% target', metrics: [{ key: 'coverage_pct', value: 65, samples: 2 }, { key: 'median_ms', value: 180_000, samples: 10 }, { key: 'pass_rate', value: 100, samples: 10 }] },
      ],
      runs,
    });
    const gate = t.calls.find((c) => c.cmd === 'dev_tools_lifecycle_step_detail' && c.args?.stepId === 'gate').response;
    gate.runs.unshift({
      id: 'm-live-eslint', projectId: 'p-atlas', measureId: 'm-live', commandId: 'eslint', command: 'npm run lint', kind: 'lint',
      outcome: 'failed', exitCode: 1, durationMs: 18_000, valuePct: null,
      firstError: "src/features/vault/VaultPage.tsx:41:7  error  'draft' is assigned a value but never used  @typescript-eslint/no-unused-vars",
      headSha: TIP_SHA.slice(0, 7), startedAt: ago(663), finishedAt: ago(645),
    });
  }

  const measuringFrom = (collar, secs, cancelling = false) => ({ ...collar, measuring: true, progress: progress(secs, cancelling) });

  /** After the Measure: Gate At risk -> Failing (eslint failed), Tests coverage 63 -> 65. */
  function ended(collar) {
    const health = collar.health.map((h) => {
      if (h.stepId === 'gate') {
        return {
          ...h, health: 'red', reason: 'eslint failed in 2 of 10 runs', measuredAt: ago(0),
          metrics: [{ key: 'median_ms', value: 72_000, samples: 10 }, { key: 'pass_rate', value: 80, samples: 10 }],
          previous: { health: h.health, metrics: h.metrics, measuredAt: h.measuredAt, headSha: '9f8e7d6' },
        };
      }
      if (h.stepId === 'tests') {
        return {
          ...h, measuredAt: ago(0),
          metrics: [{ key: 'coverage_pct', value: 65, samples: 2 }, { key: 'median_ms', value: 180_000, samples: 10 }, { key: 'pass_rate', value: 100, samples: 10 }],
          previous: { health: h.health, metrics: h.metrics, measuredAt: h.measuredAt, headSha: '9f8e7d6' },
        };
      }
      return h;
    });
    return { ...collar, health, measuring: false, progress: null, tip: { ...collar.tip, measuredAt: ago(0) } };
  }

  const NOTE = 'Synthetic: the collar mix with a Measure running on the base tip (5 commands of Gate and Tests).';
  return {
    builders: {
      'plugins/lifecycle/measuring': () => tape('plugins/lifecycle/measuring', `${NOTE} 2 done, vitest 40 s of a 60 s median, 2 waiting.`,
        (c) => [measuringFrom(c, 40)]),
      'plugins/lifecycle/measuring-over': () => tape('plugins/lifecycle/measuring-over', `${NOTE} vitest 100 s in, past 1.5x its 60 s median.`,
        (c) => [measuringFrom(c, 100)]),
      'plugins/lifecycle/cancelling': () => tape('plugins/lifecycle/cancelling', `${NOTE} A cancel is on its way.`,
        (c) => [measuringFrom(c, 40, true)]),
      'plugins/lifecycle/measured': () => tape('plugins/lifecycle/measured', `${NOTE} Replayed collar -> measuring -> ended: Gate At risk to Failing, eslint failed, coverage +2 pts.`,
        (c) => {
          const last = measuringFrom(c, 40);
          last.progress.commands = last.progress.commands.map((x) => (x.commandId === 'vitest'
            ? { ...x, state: 'done', outcome: 'passed', durationMs: 58_000 }
            : x.commandId === 'check' ? { ...x, state: 'done', outcome: 'passed', durationMs: 371_000 }
              : x.commandId === 'coverage' ? { ...x, state: 'running', startedAt: ago(5) } : x));
          return [c, last, ended(c)];
        }, withLiveMeasure),
    },
  };
}
