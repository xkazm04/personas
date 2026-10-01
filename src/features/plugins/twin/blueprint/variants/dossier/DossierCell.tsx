/**
 * Dossier (WP9): one grid cell holding one kit Tile. The cell owns what the
 * kit tile does not: its span in the bento, the layout travel when a tile
 * grows into a section board (framer `layout`; off under reduced motion, where
 * the face only fades), the press that makes the whole tile one control
 * (ContextCard's stretched-press pattern: an empty `role="button"` over the
 * tile, named by the section, with the tile's own focusable parts above it),
 * and the one-shot pulse a stage tile plays when an answer lands on it.
 */
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';
import { motion } from 'framer-motion';

import { TRANSITION_SLOW } from '@/lib/utils/animation/animationPresets';

import type { SectionId } from '../../blueprintContract';

export type CellFace = 'glance' | 'rail' | 'board' | 'stage';

interface DossierCellProps {
  section: SectionId;
  face: CellFace;
  /** Columns of 12 in the bento (ignored in a stacked rail). */
  span?: number;
  /** Present = the tile is one control (L1 tiles, L2 rail tiles). */
  onPress?: () => void;
  pressLabel?: string;
  pressRef?: Ref<HTMLDivElement>;
  /** Stage: the last answer landed here. */
  hot?: boolean;
  /** Changes with each delta phase, so the pulse replays on the reconciled one. */
  pulseKey?: string;
  reduced: boolean;
  children: ReactNode;
}

const FACE_FADE = { duration: 0.22, ease: 'linear', delay: 0.1 } as const;
const FACE_FADE_REDUCED = { duration: 0.15, ease: 'linear' } as const;
const PULSE = { duration: 1.6, ease: [0.22, 1, 0.36, 1] } as const;

export function DossierCell(props: DossierCellProps) {
  const { section, face, span = 12, onPress, pressLabel, pressRef, hot, pulseKey, reduced, children } = props;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onPress) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  };

  return (
    <motion.div
      layout={!reduced}
      transition={{ layout: TRANSITION_SLOW }}
      className="dossier-cell"
      data-section={section}
      data-face={face}
      data-span={span}
      data-hot={hot ? 'true' : undefined}
      data-testid={`dossier-cell-${section}`}
      style={{ '--span': span } as CSSProperties}
    >
      {onPress && (
        <div
          ref={pressRef}
          role="button"
          tabIndex={0}
          aria-label={pressLabel}
          className="dossier-press"
          data-testid={`dossier-press-${section}`}
          onClick={onPress}
          onKeyDown={onKeyDown}
        />
      )}
      <motion.div
        key={face}
        className="dossier-cell__face"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? FACE_FADE_REDUCED : FACE_FADE}
      >
        {children}
      </motion.div>
      {hot && !reduced && (
        <motion.span
          key={pulseKey}
          className="dossier-pulse"
          aria-hidden="true"
          data-testid={`dossier-pulse-${section}`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={PULSE}
        />
      )}
    </motion.div>
  );
}
