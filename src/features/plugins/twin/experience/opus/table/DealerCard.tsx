/**
 * The question card, face up in the middle of the table.
 *
 * It wears the suit it is dealing from. A `write` question also carries the
 * message being replied to, drawn as the message itself (a bubble from that
 * channel), because the answer to it is going to be kept as a writing sample
 * and the person should be replying to something, not describing a reply.
 *
 * While the next question is being drawn the card shows a calm ghost of
 * itself — the geometry of a question, no spinner (loading pattern v2).
 */

import { Wand2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupAnswerMode, SetupFocus, SetupStage } from '../../../setup/setupContract';
import { SUITS, SUIT_TEXT, channelName } from '../suits';

interface DealerCardProps {
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

export function DealerCard({
  stage,
  focus,
  topicLabel,
  toneChannel,
  question,
  greeting,
  answerMode,
  incoming,
  busy,
}: DealerCardProps) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus;
  const suit = SUITS[stage === 'training' ? 'memories' : focus];
  const eyebrow = stage === 'training' ? (topicLabel ?? xo.table.training) : xo.suits[focus];
  // A reply drill for the generic register is not "on" any channel.
  const channel = toneChannel && toneChannel !== 'generic' ? channelName(toneChannel, '') : null;

  return (
    <div
      className={`${suit.hue} xo-card xo-card-raised xo-foil xo-glow rounded-modal px-6 py-5 md:px-8 md:py-6`}
      data-testid="xo-dealer"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="w-8 h-8 rounded-full flex items-center justify-center bg-[color-mix(in_oklab,var(--xo-hue)_18%,transparent)]"
        >
          <Wand2 className={`w-4 h-4 ${SUIT_TEXT}`} />
        </span>
        <suit.Icon className={`w-4 h-4 ${SUIT_TEXT}`} aria-hidden />
        <span className={`typo-label uppercase ${SUIT_TEXT}`}>{eyebrow}</span>
        {toneChannel && (
          <span className="ml-auto px-2 py-0.5 rounded-pill border border-primary/20 typo-caption text-foreground">
            {channelName(toneChannel, xo.twinCard.everywhere)}
          </span>
        )}
      </div>

      {busy ? (
        <div className="mt-4 space-y-3" aria-hidden>
          <span className="block h-7 w-3/4 rounded-card bg-secondary/60" />
          <span className="block h-7 w-1/2 rounded-card bg-secondary/40" />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {greeting && (
            <p className="typo-body-lg text-foreground" data-testid="xo-dealer-greeting">
              {greeting}
            </p>
          )}
          <h3 className="typo-heading-lg text-foreground" data-testid="xo-dealer-question">
            {question ?? xo.table.noQuestion}
          </h3>
          {answerMode === 'write' && (
            <div className="pt-1 space-y-2" data-testid="xo-dealer-incoming">
              {incoming && (
                <div className="max-w-xl rounded-card rounded-bl-none border border-primary/20 bg-secondary/60 px-4 py-3">
                  <p className="typo-label text-primary">
                    {channel ? tx(xo.table.incomingFrom, { channel }) : xo.table.incoming}
                  </p>
                  <p className="typo-body-lg text-foreground whitespace-pre-wrap">{incoming}</p>
                </div>
              )}
              <p className="typo-caption">{xo.table.writeHint}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DealerCard;
