/**
 * VARIANT 1 (Instrument) - the drawn marks. A step is a GAUGE, not a tinted box:
 *
 * - `OutcomeDial`: an inner arc split by the step's evidence window (done /
 *   skipped / failed, unknown left as bare track) inside an outer ring that
 *   carries the binding state on the baseline's colourless stroke ladder
 *   (`LADDER`). The arcs draw once on mount and re-draw from where they stood
 *   when the tally changes; nothing loops.
 * - `LadderRing`: the same outer ring at chip size, so the legend and the
 *   binding rows are a truthful key to the dial.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecycleStepTally } from '@/lib/bindings/LifecycleStepTally';

import { LADDER, tallyTotal } from './variantShared';

const RING_INK: Record<LifecycleBindingState, string> = {
  live: 'stroke-status-success',
  detected: 'stroke-status-info',
  pending: 'stroke-status-warning',
  missing: 'stroke-status-error',
  advisory: 'stroke-foreground/50',
};

const ARC_INK: Record<Exclude<LifecycleOutcome, 'unknown'>, string> = {
  done: 'stroke-status-success',
  skipped: 'stroke-status-warning',
  failed: 'stroke-status-error',
};

const ARCS: Exclude<LifecycleOutcome, 'unknown'>[] = ['done', 'skipped', 'failed'];
const EASE = [0.2, 0.8, 0.2, 1] as const;

interface OutcomeDialProps {
  tally: LifecycleStepTally;
  state: LifecycleBindingState;
  size: number;
  /** Seconds before the arcs draw, so a rail of dials sweeps left to right once. */
  delay?: number;
  children?: ReactNode;
}

export function OutcomeDial({ tally, state, size, delay = 0, children }: OutcomeDialProps) {
  const c = size / 2;
  const arcW = size >= 60 ? 4 : 3;
  const outerR = c - 1.5;
  const innerR = c - 4 - arcW;
  const C = 2 * Math.PI * innerR;
  const total = tallyTotal(tally);
  const ladder = LADDER[state];

  let start = 0;
  const arcs = ARCS.map((o) => {
    const raw = total === 0 ? 0 : (tally[o] / total) * C;
    // A 1.5px gap between segments keeps adjacent outcomes legible as two marks.
    const len = raw > 3 ? raw - 1.5 : raw;
    const arc = { o, len, start };
    start += raw;
    return arc;
  });

  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={c} cy={c} r={innerR} fill="none" strokeWidth={arcW} className="stroke-primary/10" />
        {arcs.map(({ o, len, start: s }) => (
          <motion.circle
            key={o}
            cx={c}
            cy={c}
            r={innerR}
            fill="none"
            strokeWidth={arcW}
            strokeDashoffset={-s}
            className={ARC_INK[o]}
            initial={{ strokeDasharray: `0 ${C}` }}
            animate={{ strokeDasharray: `${len} ${C}` }}
            transition={{ duration: 0.6, delay, ease: EASE }}
          />
        ))}
        <circle
          cx={c}
          cy={c}
          r={outerR}
          fill="none"
          strokeWidth={ladder.width}
          strokeDasharray={ladder.dash}
          strokeLinecap={ladder.cap}
          className={RING_INK[state]}
        />
      </svg>
      <span className="relative flex items-center justify-center">{children}</span>
    </span>
  );
}

/** The binding-state ring alone, at chip size: the key to the dial's outer ring. */
export function LadderRing({ state, size = 16 }: { state: LifecycleBindingState; size?: number }) {
  const c = size / 2;
  const ladder = LADDER[state];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle
        cx={c}
        cy={c}
        r={c - 1.5}
        fill="none"
        strokeWidth={ladder.width}
        strokeDasharray={ladder.dash}
        strokeLinecap={ladder.cap}
        className={RING_INK[state]}
      />
    </svg>
  );
}
