// The synthetic `dev_tools_lifecycle_history` reply (Lifecycle excellence wave
// 3): twelve Measures of Atlas Web, newest first, as `history::history` sends
// them. Oldest to newest they tell one story: Gate healthy, then a bad stretch
// (eslint failing, Gate at risk then failing for two Measures), then a
// recovery; Tests coverage climbing from 44% (failing, under the 50% floor) to
// 63% (at risk, under the 70% target). The two newest columns ARE the collar
// snapshot's Gate and Tests rows and their `previous` (lifecycleTapes.mjs), so
// the figure, the rail and the "what changed" line agree.
//
// `runs` carry each Measure's commands; lifecycleDetailTapes.mjs derives the
// Layer-2 step detail from the same rows, so a Measure picked on the Gate
// strip finds its runs by `measureId`. Fixture CODE, no personal data.

/** Oldest first. gate: [verdict, pass %, median ms, reason]; tests: [verdict, coverage %, median ms, reason]. */
const STORY = [
  { gate: ['green', 100, 48000, null], tests: ['red', 44, 205000, 'Coverage 44% is under the 50% floor'] },
  { gate: ['green', 100, 49000, null], tests: ['red', 46, 203000, 'Coverage 46% is under the 50% floor'] },
  { gate: ['green', 100, 50000, null], tests: ['red', 48, 201000, 'Coverage 48% is under the 50% floor'] },
  { gate: ['amber', 80, 58000, 'eslint failed in 2 of 10 runs'], tests: ['amber', 51, 199000, 'Coverage 51% is under the 70% target'] },
  { gate: ['red', 60, 66000, 'eslint failed in 4 of 10 runs'], tests: ['amber', 53, 197000, 'Coverage 53% is under the 70% target'] },
  { gate: ['red', 50, 71000, 'eslint failed in 5 of 10 runs'], tests: ['amber', 54, 196000, 'Coverage 54% is under the 70% target'] },
  { gate: ['amber', 80, 63000, 'eslint failed in 2 of 10 runs'], tests: ['amber', 56, 195000, 'Coverage 56% is under the 70% target'] },
  { gate: ['green', 100, 55000, null], tests: ['amber', 57, 194000, 'Coverage 57% is under the 70% target'] },
  { gate: ['green', 100, 53000, null], tests: ['amber', 58, 193000, 'Coverage 58% is under the 70% target'] },
  { gate: ['green', 100, 51000, null], tests: ['amber', 60, 192000, 'Coverage 60% is under the 70% target'] },
  // The collar snapshot's `previous` for Gate and Tests.
  { gate: ['green', 100, 52000, null], tests: ['amber', 61, 190000, 'Coverage 61% is under the 70% target'] },
  // The collar snapshot's Gate and Tests rows.
  { gate: ['amber', 90, 74000, 'tsc 74s over 60s budget'], tests: ['amber', 63, 182000, 'Coverage 63% is under the 70% target'] },
];

const hex = (n) => (n * 2654435761 >>> 0).toString(16).padStart(8, '0');
const shaFor = (k) => `${hex(k + 11)}${hex(k + 23)}${hex(k + 37)}${hex(k + 41)}${hex(k + 53)}`.slice(0, 40);

export function lifecycleHistory({ iso, TIP_SHA }) {
  const n = STORY.length;
  const columns = STORY.map((s, k) => {
    // k = 0 oldest. The newest ran 30 min ago on the tip; the one before it 50 h ago; then a day apart.
    const back = n - 1 - k;
    const minutesAgo = back === 0 ? 30 : 60 * 50 + (back - 1) * 60 * 26;
    const headSha = back === 0 ? TIP_SHA : back === 1 ? '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432' : shaFor(k);
    const [gv, pass, tsc, greason] = s.gate;
    const [tv, cov, vit, treason] = s.tests;
    const eslintFailed = gv !== 'green';
    const run = (commandId, kind, outcome, durationMs, valuePct = null) => ({ commandId, kind, outcome, durationMs, valuePct });
    const runs = [
      run('tsc', 'typecheck', 'passed', tsc),
      run('eslint', 'lint', eslintFailed ? 'failed' : 'passed', 18000 + (k % 4) * 700),
      run('check', 'check', back === 0 ? 'timeout' : 'passed', back === 0 ? 1_200_000 : 380000 + k * 2500),
      run('clippy', 'other', back <= 1 ? 'did_not_run' : 'passed', back <= 1 ? 0 : 126000 + k * 900),
      run('vitest', 'test', 'passed', vit),
      run('coverage', 'coverage', 'passed', 218000 + k * 1800, cov),
    ];
    const finishedAt = iso(minutesAgo);
    const durationMs = runs.reduce((a, r) => a + r.durationMs, 0);
    return {
      measureId: `m-${String(k + 1).padStart(2, '0')}`,
      headSha,
      startedAt: iso(minutesAgo + Math.round(durationMs / 60000)),
      finishedAt,
      durationMs,
      cells: [
        { stepId: 'gate', health: gv, reason: greason, metrics: [{ key: 'median_ms', value: tsc, samples: 10 }, { key: 'pass_rate', value: pass, samples: 10 }] },
        {
          stepId: 'tests', health: tv, reason: treason,
          metrics: [{ key: 'coverage_pct', value: cov, samples: 1 }, { key: 'median_ms', value: vit, samples: 10 }, { key: 'pass_rate', value: 100, samples: 10 }],
        },
      ],
      runs,
    };
  });
  return { measures: columns.reverse(), stepIds: ['gate', 'tests'] };
}
