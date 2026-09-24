/**
 * One card of the starting-style deck. The face says what the style is; turn
 * it over (hover or keyboard focus) and it shows how it SOUNDS — a real reply
 * in that style, and the one thing it never does. Hearing a voice beats
 * reading a label for it, which is the whole case for samples over adjectives
 * that the research behind this experience makes.
 */

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { hoverLift } from '../cardMotion';

interface StyleFlipCardProps {
  picked: boolean;
  onPick: () => void;
  testId: string;
  icon: ReactNode;
  title: string;
  summary: string;
  /** The back of the card. Omit for a card with nothing to turn over. */
  back?: { sample: string; avoid: string; avoidLabel: string };
  flipHint?: string;
  dashed?: boolean;
}

export function StyleFlipCard({
  picked,
  onPick,
  testId,
  icon,
  title,
  summary,
  back,
  flipHint,
  dashed,
}: StyleFlipCardProps) {
  const reduced = useReducedMotion();

  const face = (
    <span className="flex h-full flex-col gap-2 p-4 text-left">
      <span className="flex items-center gap-2 text-primary">
        {icon}
        {picked && <Check className="ml-auto w-4 h-4" aria-hidden />}
      </span>
      <span className="typo-title-lg">{title}</span>
      <span className="typo-body text-foreground">{summary}</span>
      {flipHint && <span className="mt-auto typo-caption">{flipHint}</span>}
    </span>
  );

  const frontClass = `xo-card xo-foil rounded-modal block ${picked ? 'xo-foil-live xo-glow' : ''} ${
    dashed ? 'border border-dashed border-primary/25' : ''
  }`;

  return (
    <motion.button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      data-picked={picked}
      data-testid={testId}
      whileHover={hoverLift(reduced)}
      className={`focus-ring h-56 rounded-modal text-left ${back ? 'xo-flip' : ''}`}
    >
      {back ? (
        <span className="xo-flip-inner block">
          <span className={`xo-face ${frontClass}`} data-picked={picked}>
            {face}
          </span>
          <span
            className="xo-face xo-face-back xo-card xo-card-raised xo-foil rounded-modal flex flex-col gap-3 p-4"
            data-picked={picked}
          >
            <span className="rounded-card rounded-bl-none bg-primary/10 border border-primary/20 px-3 py-2 typo-body text-foreground">
              {back.sample}
            </span>
            <span className="mt-auto typo-caption">
              <span className="typo-label text-foreground">{back.avoidLabel}</span> {back.avoid}
            </span>
          </span>
        </span>
      ) : (
        <span className={`h-full ${frontClass}`} data-picked={picked}>
          {face}
        </span>
      )}
    </motion.button>
  );
}

export default StyleFlipCard;
