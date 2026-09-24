/**
 * One flying suggestion card. Rank in both corners, suit pip, foil-ish
 * double border. Hover lifts; the picked card sits higher still.
 */

import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { SetupFocus } from '../../../setup/setupContract';
import type { SetupSuggestion } from '../../../setup/setupContract';
import { CARD_HOVER, FAN_ROTATE, FAN_X, FAN_Y } from '../cardMotion';
import { SLOT_SUITS } from '../slotSuits';

interface DecisionCardProps {
  card: SetupSuggestion;
  index: number;
  picked: boolean;
  busy: boolean;
  focus: SetupFocus;
  pickLabel: string;
  onPick: () => void;
  onCommit: () => void;
}

export function DecisionCard({
  card,
  index,
  picked,
  busy,
  focus,
  pickLabel,
  onPick,
  onCommit,
}: DecisionCardProps) {
  const motionCfg = useMotion();
  const suit = SLOT_SUITS[focus];
  const Icon = suit.Icon;
  const rank = String(index + 1);
  const rotate = motionCfg.shouldAnimate ? (FAN_ROTATE[index] ?? 0) : 0;
  const x = motionCfg.shouldAnimate ? (FAN_X[index] ?? 0) : 0;
  const y = motionCfg.shouldAnimate ? (FAN_Y[index] ?? 0) : 0;

  return (
    <motion.button
      type="button"
      custom={index}
      initial={motionCfg.shouldAnimate ? { opacity: 0, y: 56, rotate: rotate + 10, x } : { opacity: 0 }}
      animate={{
        opacity: 1,
        x,
        y: picked ? y - 8 : y,
        rotate,
        scale: picked ? 1.04 : 1,
        zIndex: picked ? 3 : 1,
      }}
      exit={
        motionCfg.shouldAnimate
          ? { opacity: 0, y: 24, scale: 0.92 }
          : { opacity: 0 }
      }
      transition={{
        duration: motionCfg.shouldAnimate ? 0.42 : 0.01,
        delay: motionCfg.shouldAnimate ? index * 0.08 : 0,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={motionCfg.shouldAnimate ? CARD_HOVER.hover : undefined}
      onClick={onPick}
      onDoubleClick={onCommit}
      disabled={busy}
      aria-pressed={picked}
      aria-label={pickLabel}
      data-testid={`setup-desk-suggestion-${index + 1}`}
      className={`relative h-full min-h-[14rem] w-full max-w-[18rem] flex flex-col text-left rounded-card border-2 bg-card-bg shadow-elevation-2 focus-ring overflow-hidden ${
        picked ? `${suit.borderPicked} ${suit.wash} shadow-elevation-3` : `${suit.border}`
      }`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-1 rounded-card border border-primary/10"
      />
      <span className={`absolute top-3 left-3 flex flex-col items-center ${suit.pip}`}>
        <span className="typo-heading tabular-nums leading-none">{rank}</span>
        <Icon className="w-3.5 h-3.5 mt-0.5" />
      </span>
      <span
        aria-hidden
        className={`absolute bottom-3 right-3 flex flex-col items-center rotate-180 ${suit.pip}`}
      >
        <span className="typo-heading tabular-nums leading-none">{rank}</span>
        <Icon className="w-3.5 h-3.5 mt-0.5" />
      </span>

      <span className="flex-1 flex flex-col justify-center px-8 py-8 gap-3">
        <span className="typo-body-lg text-foreground leading-relaxed">{card.text}</span>
        <span className="typo-caption text-primary leading-relaxed">{card.reason}</span>
      </span>
    </motion.button>
  );
}

export default DecisionCard;
