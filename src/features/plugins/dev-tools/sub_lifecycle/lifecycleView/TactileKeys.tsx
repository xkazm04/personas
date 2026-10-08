/**
 * VARIANT 3 (Tactile) - the material parts. A step is a KEY you press, its
 * binding state is the key's indicator strip, its evidence is a row of beads
 * seated in a slot:
 *
 * - `LED`: the baseline's stroke ladder on one top edge (solid 2 / solid 1 /
 *   dashed 2 / dotted 2 / dashed 1), so a key's state still reads without
 *   colour.
 * - `KeyCap`: raised (elevation, hairline border) at rest; when its step is the
 *   selected one it SEATS - springs down a pixel, scales in, its shadow turns
 *   inward. A click-gated state change, never a hover lift.
 * - `MiniKey`: the same cap at chip size, for the legend and binding plates.
 * - `BeadTrack`: up to eight outcome beads in a recessed slot; they pop into
 *   their seats once on mount.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { OUTCOME_DOT } from '../journey/journeyStyles';

const LED: Record<LifecycleBindingState, string> = {
  live: 'border-t-2 border-solid border-status-success',
  detected: 'border-t border-solid border-status-info',
  pending: 'border-t-2 border-dashed border-status-warning',
  missing: 'border-t-2 border-dotted border-status-error',
  advisory: 'border-t border-dashed border-foreground/55',
};

const SEAT = { type: 'spring', stiffness: 600, damping: 30 } as const;

interface KeyCapProps {
  state: LifecycleBindingState;
  pressed?: boolean;
  /** 'md' is the rail key (fills a 44px control); 'lg' the state panel's header key. */
  size?: 'md' | 'lg';
  children?: ReactNode;
}

export function KeyCap({ state, pressed = false, size = 'md', children }: KeyCapProps) {
  const box = size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';
  return (
    <motion.span
      className={`relative flex items-center justify-center rounded-card border transition-[box-shadow,background-color,border-color] duration-150 ${box} ${
        pressed ? 'border-primary/40 bg-primary/10 shadow-inner' : 'border-primary/15 bg-background shadow-elevation-2'
      }`}
      initial={false}
      animate={pressed ? { scale: 0.94, y: 1 } : { scale: 1, y: 0 }}
      transition={SEAT}
    >
      <span aria-hidden className={`absolute left-2 right-2 top-1 ${LED[state]}`} />
      {children}
    </motion.span>
  );
}

export function MiniKey({ state }: { state: LifecycleBindingState }) {
  return (
    <span aria-hidden className="relative block h-5 w-5 shrink-0 rounded-interactive border border-primary/15 bg-background shadow-elevation-1">
      <span className={`absolute left-1 right-1 top-0.5 ${LED[state]}`} />
    </span>
  );
}

export function Bead({ outcome }: { outcome: LifecycleOutcome }) {
  return <span className={`block h-1.5 w-1.5 rounded-full ${OUTCOME_DOT[outcome]}`} />;
}

interface BeadTrackProps {
  beads: { key: string; outcome: LifecycleOutcome }[];
  /** Seconds before the first bead seats. */
  delay?: number;
}

export function BeadTrack({ beads, delay = 0 }: BeadTrackProps) {
  return (
    <span className="inline-flex h-3 items-center gap-0.5 rounded-full bg-secondary/60 px-1 shadow-inner">
      {beads.map((b, j) => (
        <motion.span
          key={b.key}
          data-outcome={b.outcome}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 700, damping: 22, delay: delay + j * 0.025 }}
        >
          <Bead outcome={b.outcome} />
        </motion.span>
      ))}
    </span>
  );
}
