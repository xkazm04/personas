/**
 * One answer card: its key, the answer as the person would send it, and a
 * line on what playing it tells the twin. Picked, it rises and its foil
 * turns; pressed again (or double-clicked) it is played.
 */

import { CornerDownLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSuggestion } from '../../../setup/setupContract';

interface AnswerCardProps {
  index: number;
  card: SetupSuggestion;
  picked: boolean;
  /** Pick when not picked, play when picked. */
  onPress: () => void;
  onPlay: () => void;
}

export function AnswerCard({ index, card, picked, onPress, onPlay }: AnswerCardProps) {
  const { t } = useTranslation();
  const xo = t.twin.experience_opus.table;
  const reduced = useReducedMotion();

  return (
    <motion.button
      type="button"
      onClick={onPress}
      onDoubleClick={onPlay}
      aria-pressed={picked}
      data-picked={picked}
      data-testid={`xo-card-${index + 1}`}
      whileHover={reduced || picked ? undefined : { y: -10, transition: { duration: 0.18 } }}
      className={`focus-ring w-full min-h-[7.5rem] xo-card xo-foil rounded-modal p-3.5 flex flex-col gap-2 text-left ${
        picked ? 'xo-card-raised xo-foil-live xo-glow' : ''
      }`}
    >
      <span className="flex items-center justify-between">
        <span className="xo-key typo-label text-foreground">{index + 1}</span>
        {picked && (
          <span className="inline-flex items-center gap-1 typo-caption text-primary">
            <CornerDownLeft className="w-3.5 h-3.5" aria-hidden />
            {xo.playHint}
          </span>
        )}
      </span>
      <span className="typo-body-lg text-foreground whitespace-pre-wrap">{card.text}</span>
      {card.reason && <span className="mt-auto typo-caption">{card.reason}</span>}
    </motion.button>
  );
}

export default AnswerCard;
