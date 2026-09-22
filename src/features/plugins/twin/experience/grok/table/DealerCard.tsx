/**
 * The question as a dealer card: suit pip, slot name, the spoken line.
 * A calm ghost while the next turn is in flight — never a spinner.
 */

import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import type { SetupFocus } from '../../../setup/setupContract';
import { DEALER_VARIANTS } from '../cardMotion';
import { SLOT_SUITS } from '../slotSuits';

interface DealerCardProps {
  focus: SetupFocus;
  greeting: string | null;
  question: string;
  busy: boolean;
}

export function DealerCard({ focus, greeting, question, busy }: DealerCardProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;
  const variants = useMotionVariants(DEALER_VARIANTS);
  const suit = SLOT_SUITS[focus];
  const Icon = suit.Icon;

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="show"
      className={`relative mx-auto w-full max-w-[52rem] rounded-card border-2 ${suit.border} bg-card-bg shadow-elevation-2 overflow-hidden`}
      data-testid="setup-desk-turn"
    >
      <span aria-hidden className="pointer-events-none absolute inset-1 rounded-card border border-primary/10" />
      <div className="flex gap-4 px-6 py-5">
        <span
          aria-hidden
          className={`mt-0.5 w-10 h-10 flex-shrink-0 rounded-card ${suit.wash} border ${suit.border} flex items-center justify-center ${suit.pip}`}
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          {busy ? (
            <>
              <span aria-hidden className="block h-4 w-36 rounded-interactive bg-secondary/50" />
              <span aria-hidden className="mt-3 block h-7 w-2/3 rounded-card bg-secondary/40" />
              <span className="sr-only" role="status">{xg.table.thinking}</span>
            </>
          ) : (
            <>
              {greeting && (
                <p className="typo-body text-foreground leading-relaxed" data-testid="setup-desk-greeting">
                  {greeting}
                </p>
              )}
              <p className={`typo-label text-primary ${greeting ? 'mt-3' : ''}`}>
                {xg.slots[focus].label}
              </p>
              <p className="typo-caption text-primary mt-0.5">{xg.slots[focus].hint}</p>
              <h2 className="mt-2 typo-heading-lg text-foreground" data-testid="setup-desk-question">
                {question}
              </h2>
            </>
          )}
        </div>
        <span aria-hidden className={`self-start typo-hero ${suit.pip} leading-none`}>
          {suit.rank}
        </span>
      </div>
    </motion.div>
  );
}

export default DealerCard;
