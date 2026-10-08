// Layer-2 fixtures: step detail (run history, doc rows) and a snapshot with
// evidence that carries notes, for the preset tests. Shapes follow the WP0
// bindings (`LifecycleStepDetail`, `LifecycleRun`, `LifecycleDocRow`).
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import type { LifecycleRunOutcome } from '@/lib/bindings/LifecycleRunOutcome';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

import { healthyMix } from './fixtures';

let n = 0;

export function run(
  commandId: string,
  kind: LifecycleGateKind,
  outcome: LifecycleRunOutcome,
  durationMs: number,
  extra: Partial<LifecycleRun> = {},
): LifecycleRun {
  n += 1;
  const at = new Date(Date.parse('2026-10-08T09:00:00Z') - n * 3_600_000).toISOString();
  return {
    id: `run-${n}`,
    projectId: 'p1',
    measureId: `m-${n}`,
    commandId,
    command: commandId === 'tsc' ? 'npx tsc --noEmit' : commandId === 'eslint' ? 'npm run lint' : `npm run ${commandId}`,
    kind,
    outcome,
    exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null,
    durationMs,
    valuePct: null,
    firstError: null,
    headSha: 'a1b2c3d',
    startedAt: at,
    finishedAt: at,
    ...extra,
  };
}

/** Gate: tsc over budget, eslint failed with an error line, check timed out, a cargo command that did not run. */
export function gateDetail(): LifecycleStepDetail {
  return {
    stepId: 'gate',
    docs: [],
    runs: [
      run('tsc', 'typecheck', 'passed', 74_000),
      run('eslint', 'lint', 'failed', 21_000, { firstError: "src/app.tsx:12:3  error  'x' is defined but never used" }),
      run('check', 'check', 'timeout', 1_200_000),
      run('clippy', 'other', 'did_not_run', 0),
      run('tsc', 'typecheck', 'passed', 58_000),
      run('eslint', 'lint', 'passed', 19_000),
      run('tsc', 'typecheck', 'passed', 61_000),
    ],
  };
}

/** Tests with coverage runs (63%, rising) and a test command. */
export function testsDetail(): LifecycleStepDetail {
  return {
    stepId: 'tests',
    docs: [],
    runs: [
      run('coverage', 'coverage', 'passed', 240_000, { valuePct: 63 }),
      run('vitest', 'test', 'passed', 182_000),
      run('coverage', 'coverage', 'passed', 236_000, { valuePct: 58 }),
      run('vitest', 'test', 'passed', 179_000),
    ],
  };
}

export function docRow(docPath: string, status: string, extra: Partial<LifecycleDocRow> = {}): LifecycleDocRow {
  return { docPath, status, changedSources: [], brokenRefs: [], scannedAt: '2026-10-08T08:00:00Z', ...extra };
}

export function docsDetail(): LifecycleStepDetail {
  return {
    stepId: 'docs',
    runs: [],
    docs: [
      docRow('docs/features/vault.md', 'broken', { brokenRefs: ['src/vault/old.ts', 'src/vault/gone.ts'] }),
      docRow('docs/features/fleet.md', 'stale', { changedSources: ['src/fleet/grid.tsx'] }),
      docRow('docs/notes/ideas.md', 'unverifiable'),
      docRow('README.md', 'clean'),
      docRow('docs/features/home.md', 'clean'),
    ],
  };
}

/** healthyMix plus evidence with notes: docs outcomes on two changes, land notes, one change with no note. */
export function mixWithEvidence(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  return healthyMix({
    evidence: [
      {
        sourceKind: 'commit', sourceRef: 'f00dbabe1234567', title: 'Rename the vault store', occurredAt: '2026-10-08T08:00:00Z',
        outcomes: [
          { stepId: 'docs', outcome: 'skipped', detail: 'docs/features/vault.md still names the old store' },
          { stepId: 'land', outcome: 'skipped', detail: 'Merged locally without a pull request' },
        ],
      },
      {
        sourceKind: 'task', sourceRef: 'task-42', title: 'Add the fleet grid', occurredAt: '2026-10-07T08:00:00Z',
        outcomes: [
          { stepId: 'docs', outcome: 'done', detail: null },
          { stepId: 'land', outcome: 'done', detail: null },
        ],
      },
      {
        sourceKind: 'pr', sourceRef: '118', title: 'Tidy the home page', occurredAt: '2026-10-06T08:00:00Z',
        outcomes: [{ stepId: 'land', outcome: 'failed', detail: 'The merge was reverted' }],
      },
    ],
    ...overrides,
  });
}
