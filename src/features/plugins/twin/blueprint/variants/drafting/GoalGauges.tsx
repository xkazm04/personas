import { motion } from 'framer-motion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { BlueprintGoal } from '../../blueprintContract';
import DrawFrame from './draw/DrawFrame';
import { WriteNumber } from './draw/Write';

/**
 * The plan's goals as a row of numbered gauges, each filled to its coverage
 * (0..1). An open goal with nothing yet is a dashed outline, a covered one
 * solid ink, a dropped one struck through. The goal the last answer scored
 * against fills its gain in last, from where it stood to where it stands.
 * In the draw-in each gauge is a frame and a container: its fill rises, then
 * its number is lettered (a dropped one is struck through instead).
 */
export default function GoalGauges({
  goals,
  targetGoalId = null,
  gain = null,
  playKey = null,
  reduced,
  register,
}: {
  goals: BlueprintGoal[];
  targetGoalId?: string | null;
  /** The reconciled gain on the target goal, 0..1. */
  gain?: number | null;
  playKey?: string | null;
  reduced: boolean;
  register?: (key: string) => (el: HTMLElement | null) => void;
}) {
  return (
    <ol className="flex flex-wrap items-end gap-x-1.5 gap-y-2">
      {goals.map((g, i) => {
        const targeted = g.id === targetGoalId;
        const dropped = g.state === 'dropped';
        const cov = Math.min(1, Math.max(0, g.coverage));
        const from = targeted && gain !== null ? Math.max(0, cov - gain) : cov;
        const stroke = dropped ? 'var(--ink-faint)' : cov > 0 || g.state === 'covered' ? 'var(--ink)' : 'var(--ink-dim)';
        const solid = !dropped && (cov > 0 || g.state === 'covered');
        return (
          <li key={g.id} ref={register?.(`goal:${g.id}`)} data-goal={g.id} data-state={g.state} data-delta-target={targeted || undefined} data-draw-scope="">
            <Tooltip content={g.title}>
              <span className={`flex flex-col items-center gap-1 rounded-interactive px-0.5 pt-1 ${targeted ? 'twd-target' : ''}`}>
                <span className="relative block h-10 w-4" style={{ border: '1px solid transparent' }}>
                  <DrawFrame stroke={stroke} dash={solid ? undefined : '3 2'} />
                  {!dropped && (
                    <motion.span
                      key={targeted && playKey ? playKey : 'still'}
                      aria-hidden
                      data-draw="rise"
                      className="absolute inset-x-0 bottom-0 block"
                      style={{ background: g.state === 'covered' ? 'var(--ink-strong)' : 'var(--ink)' }}
                      initial={{ height: `${(reduced ? cov : from) * 100}%` }}
                      animate={{ height: `${cov * 100}%` }}
                      transition={{ duration: reduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1], delay: reduced ? 0 : 0.4 }}
                    />
                  )}
                  {dropped && (
                    <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 16 40">
                      <line x1={0} y1={40} x2={16} y2={0} stroke="var(--ink-dim)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" pathLength={100} data-draw="stroke" />
                    </svg>
                  )}
                </span>
                <WriteNumber value={i + 1} className="typo-code text-foreground" />
              </span>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}
