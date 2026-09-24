/**
 * FramePiece — one floating piece of the four-edge chat, positioned and
 * surfaced by the active look. A `framed` look wraps the piece in the
 * workforce state frame (`.athena-frame`), so every piece carries the same
 * irregular state colouring and working glow as the full-size modal.
 */

import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { FrameLook } from './frameLook';

type Edge = 'top' | 'bottom' | 'left' | 'right' | 'center';

const ENTER: Record<Edge, { x?: number; y?: number }> = {
  top: { y: -16 },
  bottom: { y: 16 },
  left: { x: -16 },
  right: { x: 16 },
  center: { y: 10 },
};

export function FramePiece({
  edge,
  look,
  frame,
  working,
  className = '',
  sectionClassName = '',
  children,
  label,
}: {
  edge: Edge;
  look: FrameLook;
  /** The workforce conic gradient, for framed looks. */
  frame?: string;
  working?: boolean;
  className?: string;
  /** Extra placement on the outer piece (e.g. letting the top edge grow). */
  sectionClassName?: string;
  children: ReactNode;
  label?: string;
}) {
  const place = look.place[edge];
  const surface = look.surface[edge];
  return (
    <motion.section
      initial={{ opacity: 0, ...ENTER[edge] }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label={label}
      className={`pointer-events-auto ${place} ${sectionClassName} ${look.framed ? `athena-frame ${surface}` : ''}`}
      style={look.framed ? ({ ['--athena-frame' as string]: frame } as CSSProperties) : undefined}
      data-working={look.framed && working ? 'true' : 'false'}
    >
      <div
        className={`relative h-full ${
          look.framed ? 'rounded-[calc(var(--radius-modal,1rem)-1.5px)] bg-background/92 backdrop-blur-md' : surface
        } ${className}`}
      >
        {children}
      </div>
    </motion.section>
  );
}
