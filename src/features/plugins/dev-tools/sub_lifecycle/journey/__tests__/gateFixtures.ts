// Lifecycle excellence wave 6 fixtures: Gate's instrument rows. One command
// per signal, each with enough history for the rule it shows:
//
// - tsc: SLOWING. Six answered runs around 50 s, then the newest three around
//   80 s (mean 80 s > 1.3 x 50 s), all passing, the slow three over the kind's 60 s budget,
//   with an open slow-gate item filed about it.
// - eslint: FLAKY. Ten answered runs alternating pass / fail in pairs, so the
//   outcome flips 4 times; the newest failed, with its first error.
// - check: the newest run timed out (a hatched stub), the ones before passed.
// - clippy: the newest run did not start (a hollow stub).
//
// Every run carries its own Measure id (`m-<cmd>-<i>`, newest = 0), so a test
// can travel to one. Shapes follow `LifecycleStepDetail` / `LifecycleRun`.
import type { LifecycleGateKind } from '@/lib/bindings/LifecycleGateKind';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import type { LifecycleRunOutcome } from '@/lib/bindings/LifecycleRunOutcome';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

export const ESLINT_ERROR = "src/app.tsx:12:3  error  'x' is defined but never used";

const T0 = Date.parse('2026-10-08T09:00:00Z');

function gateRun(commandId: string, kind: LifecycleGateKind, i: number, outcome: LifecycleRunOutcome, durationMs: number, extra: Partial<LifecycleRun> = {}): LifecycleRun {
  const at = new Date(T0 - i * 86_400_000).toISOString();
  return {
    id: `r-${commandId}-${i}`,
    projectId: 'p1',
    measureId: `m-${commandId}-${i}`,
    commandId,
    command: { tsc: 'npx tsc --noEmit', eslint: 'npm run lint', check: 'npm run check', clippy: 'cargo clippy' }[commandId] ?? commandId,
    kind,
    outcome,
    exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null,
    durationMs,
    valuePct: null,
    firstError: null,
    headSha: `abc${String(i).padStart(4, '0')}def`,
    startedAt: at,
    finishedAt: at,
    ...extra,
  };
}

/** tsc, newest first: three slow runs then six at its usual speed. */
export function slowingRuns(): LifecycleRun[] {
  const ms = [82_000, 79_000, 80_000, 50_000, 51_000, 49_000, 50_000, 52_000, 48_000];
  return ms.map((d, i) => gateRun('tsc', 'typecheck', i, 'passed', d));
}

/** eslint, newest first: F F P P F F P P F F (4 flips), the newest with its first error. */
export function flakyRuns(): LifecycleRun[] {
  const outcomes: LifecycleRunOutcome[] = ['failed', 'failed', 'passed', 'passed', 'failed', 'failed', 'passed', 'passed', 'failed', 'failed'];
  return outcomes.map((o, i) => gateRun('eslint', 'lint', i, o, 20_000 + i * 100, i === 0 ? { firstError: ESLINT_ERROR } : {}));
}

export function slowGateItem(): LifecycleRelatedItem {
  return { id: 'i-slow-tsc', title: 'npx tsc --noEmit slowed 60%', status: 'accepted', verifyState: null, source: 'slow_gate', commandId: 'tsc', createdAt: '2026-10-08T08:00:00Z' };
}

export function instrumentGateDetail(): LifecycleStepDetail {
  const check = [gateRun('check', 'check', 0, 'timeout', 600_000), ...[1, 2, 3].map((i) => gateRun('check', 'check', i, 'passed', 300_000))];
  const clippy = [gateRun('clippy', 'other', 0, 'did_not_run', 0), gateRun('clippy', 'other', 1, 'passed', 90_000)];
  const runs = [...slowingRuns(), ...flakyRuns(), ...check, ...clippy].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return { stepId: 'gate', runs, docs: [], related: [slowGateItem()], evidence: [] };
}

/** The stored output of eslint's newest run: stdout, then stderr holding the first error. */
export const ESLINT_OUTPUT = [
  '--- stdout ---',
  '> lint',
  '> eslint src/',
  '',
  'src/app.tsx',
  '--- stderr ---',
  ESLINT_ERROR,
  '  12:9  warning  Unexpected any  @typescript-eslint/no-explicit-any',
  '1 error, 1 warning',
  '',
].join('\n');
