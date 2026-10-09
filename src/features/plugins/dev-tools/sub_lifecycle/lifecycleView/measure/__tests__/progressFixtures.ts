// A running Measure for the measure tests: five commands of Gate and Tests,
// two done, one running, two waiting, on a fixed clock. Mirrors the
// `plugins/lifecycle/measuring` harness tape (lifecycleMeasureTapes.mjs).
import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';
import type { LifecycleMeasureProgress } from '@/lib/bindings/LifecycleMeasureProgress';

export const NOW = Date.parse('2026-10-08T10:00:00Z');
export const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

type Cmd = Partial<LifecycleCommandProgress> & Pick<LifecycleCommandProgress, 'commandId' | 'kind' | 'state'>;

export function cmd(c: Cmd): LifecycleCommandProgress {
  return { command: `run ${c.commandId}`, startedAt: null, outcome: null, durationMs: null, medianMs: null, ...c };
}

export function progress(commands: LifecycleCommandProgress[], over: Partial<LifecycleMeasureProgress> = {}): LifecycleMeasureProgress {
  return { measureId: 'm-live', startedAt: ago(120), headSha: 'a1b2c3d4e5f6', commands, cancelling: false, ...over };
}

/** 2 done (tsc passed, eslint failed), vitest running 40 s of a 60 s median, check and coverage waiting. */
export function midMeasure(over: Partial<LifecycleMeasureProgress> = {}): LifecycleMeasureProgress {
  return progress([
    cmd({ commandId: 'tsc', kind: 'typecheck', state: 'done', outcome: 'passed', durationMs: 52_000, medianMs: 50_000, startedAt: ago(120) }),
    cmd({ commandId: 'eslint', kind: 'lint', state: 'done', outcome: 'failed', durationMs: 18_000, medianMs: 20_000, startedAt: ago(68) }),
    cmd({ commandId: 'vitest', kind: 'test', state: 'running', medianMs: 60_000, startedAt: ago(40) }),
    cmd({ commandId: 'check', kind: 'check', state: 'pending', medianMs: 90_000 }),
    cmd({ commandId: 'coverage', kind: 'coverage', state: 'pending', medianMs: null }),
  ], over);
}
