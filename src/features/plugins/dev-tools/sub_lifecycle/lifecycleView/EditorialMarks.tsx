/**
 * VARIANT 2 (Editorial) - the typographic marks. The editorial direction draws
 * no boxes around a step: a step is a numbered entry, its binding state is the
 * RULE under it, and its evidence is a line of printer's marks.
 *
 * - `UNDERLINE`: the baseline's stroke ladder applied to one bottom rule
 *   (solid 2 / solid 1 / dashed 2 / dotted 2 / dashed 1), so the five states
 *   still part without colour.
 * - `OutcomeMark`: done a filled bullet, skipped a hollow one, failed a cross,
 *   unknown a point - four SHAPES, each tinted by meaning.
 */
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

export const UNDERLINE: Record<LifecycleBindingState, string> = {
  live: 'border-b-2 border-solid border-status-success',
  detected: 'border-b border-solid border-status-info',
  pending: 'border-b-2 border-dashed border-status-warning',
  missing: 'border-b-2 border-dotted border-status-error',
  advisory: 'border-b border-dashed border-foreground/55',
};

export function OutcomeMark({ outcome, size = 8 }: { outcome: LifecycleOutcome; size?: number }) {
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      {outcome === 'done' && <circle cx={c} cy={c} r={c - 0.5} className="fill-status-success" />}
      {outcome === 'skipped' && (
        <circle cx={c} cy={c} r={c - 1} fill="none" strokeWidth={1.25} className="stroke-status-warning" />
      )}
      {outcome === 'failed' && (
        <path
          d={`M1 1 L${size - 1} ${size - 1} M${size - 1} 1 L1 ${size - 1}`}
          strokeWidth={1.5}
          strokeLinecap="round"
          className="stroke-status-error"
        />
      )}
      {outcome === 'unknown' && <circle cx={c} cy={c} r={1} className="fill-primary/50" />}
    </svg>
  );
}
