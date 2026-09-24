/**
 * The question, as the card dealt face up in the middle of the table: suit
 * pip, slot name and hint, the line itself, and the suit's rank in the corner.
 *
 * The rank letter is a corner MARK, not a headline — `typo-data-lg`, tinted
 * back — so the question is the loudest thing on the card. It was `typo-hero`
 * (the page-greeting tier) in an earlier draft, which made a decorative pip
 * shout over the one line the person is meant to read.
 *
 * A `write` turn also carries the message being replied to, drawn as the
 * message itself. That answer is kept verbatim as a writing sample, so the
 * person should be replying to something rather than describing a reply.
 *
 * While the next turn is in flight the card holds a calm ghost of itself — the
 * geometry of a question, never a spinner (loading pattern v2).
 */

import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import type { SetupAnswerMode, SetupFocus, SetupStage } from '../../setup/setupContract';
import { channelName } from '../channels';
import { DEALER_VARIANTS } from '../cardMotion';
import { SUITS } from '../suits';

interface DealerCardProps {
  stage: SetupStage;
  focus: SetupFocus;
  /** The training topic's label, already translated, when a round has one. */
  topicLabel: string | null;
  toneChannel: string | null;
  greeting: string | null;
  question: string;
  answerMode: SetupAnswerMode;
  incoming: string | null;
  busy: boolean;
}

export function DealerCard({
  stage,
  focus,
  topicLabel,
  toneChannel,
  greeting,
  question,
  answerMode,
  incoming,
  busy,
}: DealerCardProps) {
  const { t, tx: fmt } = useTranslation();
  const tx = t.twin.experience;
  const variants = useMotionVariants(DEALER_VARIANTS);
  // Training rounds are not about a setup slot, so they wear the memories suit
  // and say what the round is about instead of which slot is being filled.
  const suit = SUITS[stage === 'training' ? 'memories' : focus];
  const Icon = suit.Icon;
  const eyebrow = stage === 'training' ? (topicLabel ?? tx.table.training) : tx.slots[focus].label;
  const hint = stage === 'training' ? null : tx.slots[focus].hint;
  // A reply drill for the generic register is not "on" any channel.
  const namedChannel = toneChannel && toneChannel !== 'generic' ? channelName(toneChannel, '') : null;

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
              <span className="sr-only" role="status">
                {tx.table.thinking}
              </span>
            </>
          ) : (
            <>
              {greeting && (
                <p className="typo-body text-foreground leading-relaxed" data-testid="setup-desk-greeting">
                  {greeting}
                </p>
              )}
              <p className={`flex items-center gap-2 typo-label text-primary ${greeting ? 'mt-3' : ''}`}>
                {eyebrow}
                {toneChannel && (
                  <span className="px-2 py-0.5 rounded-pill border border-primary/20 typo-caption">
                    {channelName(toneChannel, tx.table.everywhere)}
                  </span>
                )}
              </p>
              {hint && <p className="typo-caption mt-0.5">{hint}</p>}
              <h2 className="mt-2 typo-heading-lg text-foreground" data-testid="setup-desk-question">
                {question}
              </h2>
              {answerMode === 'write' && (
                <div className="mt-3 space-y-2" data-testid="setup-desk-incoming">
                  {incoming && (
                    <div className="max-w-xl rounded-card rounded-bl-none border border-primary/20 bg-secondary/60 px-4 py-3">
                      <p className="typo-label text-primary">
                        {namedChannel ? fmt(tx.table.incomingFrom, { channel: namedChannel }) : tx.table.incoming}
                      </p>
                      <p className="typo-body-lg text-foreground whitespace-pre-wrap">{incoming}</p>
                    </div>
                  )}
                  <p className="typo-caption">{tx.table.writeHint}</p>
                </div>
              )}
            </>
          )}
        </div>
        <span aria-hidden className="self-start typo-data-lg text-primary/40 leading-none">
          {suit.rank}
        </span>
      </div>
    </motion.div>
  );
}

export default DealerCard;
