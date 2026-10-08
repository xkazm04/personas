/**
 * The rail's material parts. A step is a KEY you press, and its binding state
 * is the key's indicator strip:
 *
 * - `LED`: the binding ladder's stroke (solid 2 / solid 1 / dashed 2 / dotted 2
 *   / dashed 1) on one top edge, so a key's state still reads without colour.
 * - `KeyCap`: raised (elevation, hairline border) at rest; when its step is the
 *   selected one it SEATS - springs down a pixel, scales in, its shadow turns
 *   inward. A click-gated state change, never a hover lift; instant under
 *   reduced motion.
 * - `MiniKey`: the same cap at chip size, for the binding list.
 *
 * The evidence beads that used to sit in a slot under every key left layer one
 * in wave 2 of Lifecycle excellence: at 6px they were decoration, and a step's
 * recent outcomes are now labelled marks in its card's peek (`rail/PeekEvidence`).
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';

import { lcShape } from './system/lcSurface';
import { KEY } from './system/scales';

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
  /** `md` is the rail key (fills a 44px control); `lg` the step screen's header key. */
  size?: keyof typeof KEY;
  children?: ReactNode;
}

export function KeyCap({ state, pressed = false, size = 'md', children }: KeyCapProps) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className={`relative flex items-center justify-center border transition-[box-shadow,background-color,border-color] duration-150 ${lcShape('card')} ${KEY[size]} ${
        pressed ? 'border-primary/40 bg-primary/10 shadow-inner' : 'border-primary/15 bg-background shadow-elevation-2'
      }`}
      initial={false}
      animate={pressed ? { scale: 0.94, y: 1 } : { scale: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : SEAT}
    >
      <span aria-hidden className={`absolute left-2 right-2 top-1 ${LED[state]}`} />
      {children}
    </motion.span>
  );
}

export function MiniKey({ state }: { state: LifecycleBindingState }) {
  return (
    <span aria-hidden className={`relative block h-5 w-5 shrink-0 border border-primary/15 bg-background shadow-elevation-1 ${lcShape('chip')}`}>
      <span className={`absolute left-1 right-1 top-0.5 ${LED[state]}`} />
    </span>
  );
}
