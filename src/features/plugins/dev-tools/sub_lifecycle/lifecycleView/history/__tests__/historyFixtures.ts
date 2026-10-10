// Measure-history fixtures (`LifecycleHistory`, newest first as the backend
// sends it). `sixMeasures` ends on the same Gate and Tests rows as
// `healthyMix` (journey/__tests__/fixtures.ts) and its `previous`, so the
// figure, the rail and "what changed" agree: Gate green, green, FAILING, at
// risk, green, at risk; Tests coverage climbing 55 -> 63.
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleHistory } from '@/lib/bindings/LifecycleHistory';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

import { run } from '../../../journey/__tests__/detailFixtures';

export interface ColumnSpec {
  gate: [LifecycleHealth, number, number];
  tests: [LifecycleHealth, number | null, number];
}

/** Columns from OLDEST to newest; returned newest first. Ids are `m-h1` (oldest) up. */
export function historyOf(specs: ColumnSpec[]): LifecycleHistory {
  const n = specs.length;
  const columns: LifecycleMeasureColumn[] = specs.map((s, i) => {
    const at = new Date(Date.parse('2026-10-08T09:30:00Z') - (n - 1 - i) * 86_400_000).toISOString();
    return {
      measureId: `m-h${i + 1}`,
      headSha: `${String(i + 1).repeat(7)}abcdef`,
      startedAt: at,
      finishedAt: at,
      durationMs: 600_000 + i * 10_000,
      cells: [
        {
          stepId: 'gate', health: s.gate[0], reason: s.gate[0] === 'green' ? null : `gate ${s.gate[0]} at ${i + 1}`,
          metrics: [{ key: 'median_ms', value: s.gate[2], samples: 10 }, { key: 'pass_rate', value: s.gate[1], samples: 10 }],
        },
        {
          stepId: 'tests', health: s.tests[0], reason: null,
          metrics: [
            { key: 'coverage_pct', value: s.tests[1], samples: s.tests[1] == null ? 0 : 1 },
            { key: 'median_ms', value: s.tests[2], samples: 10 },
            { key: 'pass_rate', value: 100, samples: 10 },
          ],
        },
      ],
      runs: [{ commandId: 'tsc', kind: 'typecheck', outcome: 'passed', durationMs: s.gate[2], valuePct: null }],
    };
  });
  return { measures: columns.reverse(), stepIds: ['gate', 'tests'] };
}

export function sixMeasures(): LifecycleHistory {
  return historyOf([
    { gate: ['green', 100, 50_000], tests: ['amber', 55, 200_000] },
    { gate: ['green', 100, 51_000], tests: ['amber', 57, 198_000] },
    { gate: ['red', 50, 71_000], tests: ['amber', 58, 196_000] },
    { gate: ['amber', 80, 63_000], tests: ['amber', 60, 194_000] },
    { gate: ['green', 100, 52_000], tests: ['amber', 61, 190_000] },
    { gate: ['amber', 90, 74_000], tests: ['amber', 63, 182_000] },
  ]);
}

/** Gate's runs across three of those Measures (`m-h6` newest, `m-h5`, `m-h3`), for the Layer-2 strip. */
export function gateDetailByMeasure(): LifecycleStepDetail {
  return {
    stepId: 'gate',
    docs: [],
    related: [],
    runs: [
      run('tsc', 'typecheck', 'passed', 74_000, { measureId: 'm-h6' }),
      run('eslint', 'lint', 'passed', 19_000, { measureId: 'm-h6' }),
      run('clippy', 'other', 'passed', 120_000, { measureId: 'm-h6' }),
      run('tsc', 'typecheck', 'passed', 52_000, { measureId: 'm-h5' }),
      run('eslint', 'lint', 'passed', 18_000, { measureId: 'm-h5' }),
      run('tsc', 'typecheck', 'passed', 71_000, { measureId: 'm-h3' }),
      run('eslint', 'lint', 'failed', 22_000, { measureId: 'm-h3', firstError: 'src/a.ts:1:1  error  boom' }),
    ],
  };
}
