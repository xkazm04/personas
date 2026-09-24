/**
 * The question, in the one lit frame on the surface.
 *
 * The frame is drawn before there is anything in it and stays drawn while the
 * next question is being written — what changes inside it is the text, never
 * the geometry, so the lane never reflows under the person and there is never
 * a spinner (loading pattern v2).
 *
 * A `write` question also carries the message being replied to, drawn as the
 * message itself. That turn's answer is kept verbatim as a writing sample, so
 * the person should be replying to something rather than describing a reply.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupAnswerMode, SetupFocus, SetupStage } from '../../../setup/setupContract';
import { channelName } from '../channels';
import { askVariants } from '../motion';

interface AskProps {
  stage: SetupStage;
  focus: SetupFocus;
  /** The training topic's label, when a training round has one. */
  topicLabel: string | null;
  toneChannel: string | null;
  question: string | null;
  /** First turn of a sitting only. */
  greeting: string | null;
  answerMode: SetupAnswerMode;
  incoming: string | null;
  busy: boolean;
}

export function Ask({
  stage,
  focus,
  topicLabel,
  toneChannel,
  question,
  greeting,
  answerMode,
  incoming,
  busy,
}: AskProps) {
  const { t, tx } = useTranslation();
  const mr = t.twin.experience_mirror;
  const reduced = useReducedMotion();
  const eyebrow = stage === 'training' ? (topicLabel ?? mr.ask.training) : t.twin.setup.checklist[focus];
  // A reply drill for the generic register is not "on" any channel.
  const channel = toneChannel && toneChannel !== 'generic' ? channelName(toneChannel, '') : null;

  return (
    <section className="mr-frame mr-frame-lit rounded-modal px-6 py-5 md:px-8 md:py-6" data-testid="mr-ask">
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-1 h-1 rounded-full bg-primary" />
        <span className="typo-label text-primary">{eyebrow}</span>
        {toneChannel && (
          <span className="ml-auto px-2 py-0.5 rounded-pill border border-primary/20 typo-caption">
            {channelName(toneChannel, mr.ask.everywhere)}
          </span>
        )}
      </div>

      {/* The live region lives OUTSIDE the keyed block so it exists before its
          message does — a region born holding its text is never announced. */}
      <span className="sr-only" role="status">
        {busy ? t.twin.setup.desk.thinking : ''}
      </span>

      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.div
            key="thinking"
            aria-hidden
            variants={askVariants(reduced)}
            initial="enter"
            animate="rest"
            exit="gone"
            className="mt-4 space-y-2.5"
          >
            <span className="block h-6 w-4/5 rounded-card bg-secondary/60" />
            <span className="block h-6 w-3/5 rounded-card bg-secondary/40" />
          </motion.div>
        ) : (
          <motion.div
            key={`q:${question ?? ''}`}
            variants={askVariants(reduced)}
            initial="enter"
            animate="rest"
            exit="gone"
            className="mt-4 space-y-3"
          >
            {greeting && (
              <p className="typo-body-lg text-foreground" data-testid="mr-ask-greeting">
                {greeting}
              </p>
            )}
            <h3 className="typo-heading-lg text-foreground leading-snug" data-testid="mr-ask-question">
              {question ?? t.twin.setup.desk.noQuestion}
            </h3>
            {answerMode === 'write' && (
              <div className="pt-1 space-y-2" data-testid="mr-ask-incoming">
                {incoming && (
                  <div className="max-w-xl rounded-card rounded-bl-none border border-primary/20 bg-secondary/60 px-4 py-3">
                    <p className="typo-label text-primary">
                      {channel ? tx(mr.ask.incomingFrom, { channel }) : mr.ask.incoming}
                    </p>
                    <p className="typo-body-lg text-foreground whitespace-pre-wrap">{incoming}</p>
                  </div>
                )}
                <p className="typo-caption">{mr.ask.writeHint}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default Ask;
