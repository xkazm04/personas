import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import type { SpineInstance, SpineStep } from './spine';

/**
 * Development sessions -> Spine instances.
 *
 * The first layer is phases, not tools: brief, explore, edit, verify, ship. The 21 raw step
 * kinds interleave too finely for an order to exist between them; phases do have one. The
 * registry owns the kind -> phase map and ships it with the reading.
 */

export type DevMode = 'interactive' | 'headless';
export type DevOutcome = 'landed' | 'interrupted' | 'errored' | 'quiet';

export const DEV_GOOD: DevOutcome = 'landed';
/** A session that ended clean without a commit is often read-only work done right; only these fail. */
export const devFailure = (o: string) => o === 'errored' || o === 'interrupted';
export const DEV_OUTCOMES: DevOutcome[] = ['landed', 'interrupted', 'errored', 'quiet'];

/** Kinds that are waiting or harness events, not a phase of the work. */
const NOT_WORK = new Set(['wait', 'notify']);
/** Kinds that are friction by themselves: the person stopped the agent, or the context ran out. */
const FRICTION = new Set(['interrupt', 'compact']);
/** Idle cap: any gap longer than this between steps counts as this much active time. */
const IDLE_CAP_S = 600;

export interface DevInstance extends SpineInstance {
  mode: DevMode;
  project: string;
  active: number;
}

export function devInstances(reading: CuratorProcess): DevInstance[] {
  return reading.sessions.map((s) => {
    const steps: SpineStep[] = [];
    let active = 0;
    let prevEnd: number | null = null;
    for (const [kindIdx, , errors, tStart, span] of s.steps) {
      const kind = reading.kinds[kindIdx] ?? 'tool';
      if (prevEnd != null) active += Math.min(Math.max(0, tStart - prevEnd), IDLE_CAP_S);
      const at = active;
      active += span;
      prevEnd = tStart + span;
      if (NOT_WORK.has(kind)) continue;
      const friction = FRICTION.has(kind);
      // A friction event sits on the step it interrupted; it is not a phase of its own.
      if (friction) {
        const last = steps[steps.length - 1];
        if (last) last.friction = true;
        continue;
      }
      steps.push({ k: reading.phases[kind] ?? kind, t: at, err: errors, friction: false });
    }
    const outcome: DevOutcome = s.commits > 0 ? 'landed' : s.interrupts > 0 ? 'interrupted' : s.errors > 0 ? 'errored' : 'quiet';
    return {
      id: s.id,
      group: s.project,
      project: s.project,
      mode: s.mode === 'headless' ? 'headless' : 'interactive',
      outcome,
      active,
      steps,
    };
  });
}
