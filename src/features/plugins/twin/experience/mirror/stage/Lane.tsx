/**
 * What the lane shows: the question, the whisper, the answers, the offers and
 * the field — or, at the three moments there is nothing to ask, one notice in
 * their place.
 *
 * Split out of `Stage` so the composition of the centre of the screen is one
 * readable list. It owns no state: everything here is given, and every action
 * goes back to the turn that `Stage` holds.
 */

import type { DeskProposals } from '../../../setup/desk/useDeskProposals';
import type { SetupProposal, SetupSessionApi, SetupVoiceApi } from '../../../setup/setupContract';
import { Answers } from './Answers';
import { Ask } from './Ask';
import { CompleteNotice, GuideDownNotice, TrainingInvite } from './Notices';
import { OfferDock } from './OfferDock';
import { Reply } from './Reply';
import type { Turn } from './useTurn';

export interface LaneProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  turn: Turn;
  cards: SetupSessionApi['suggestions'];
  proposals: DeskProposals;
  twinName: string;
  /** The training topic's label, already translated. */
  topicLabel: string | null;
  /** The opening line, on the first turn of a sitting only. */
  greeting: string | null;
  /** Set for a few seconds after something was written down. */
  whisper: { text: string; at: number } | null;
  onKept: (proposal: SetupProposal) => void;
  onOpenFields: () => void;
  onClose: () => void;
}

export function Lane({
  session,
  voice,
  turn,
  cards,
  proposals,
  twinName,
  topicLabel,
  greeting,
  whisper,
  onKept,
  onOpenFields,
  onClose,
}: LaneProps) {
  // Every slot set, by readiness. Not `score >= 100`: the score also counts the
  // Brain, which no question on this lane fills.
  const setupDone = session.stage === 'setup' && session.checklist.every((c) => c.status === 'set');
  const memoriesInSetup = session.stage === 'setup' && session.focus === 'memories' && !setupDone;

  if (setupDone) {
    return <CompleteNotice name={twinName} onTrain={() => turn.chooseStage('training')} onClose={onClose} />;
  }
  if (memoriesInSetup) {
    return <TrainingInvite onStart={() => turn.chooseStage('training')} />;
  }

  return (
    <>
      {session.generatorError && (
        <GuideDownNotice onRetry={session.redeal} onFields={onOpenFields} />
      )}

      <Ask
        stage={session.stage}
        focus={session.focus}
        topicLabel={topicLabel}
        toneChannel={session.toneChannel}
        question={session.question}
        greeting={greeting}
        answerMode={session.answerMode}
        incoming={session.incoming}
        busy={session.busy}
      />

      {/* The whisper is two things on purpose. The live region is PERMANENT
          and starts empty, so the text arriving into it is a change assistive
          technology can observe — a region mounted in the same commit as its
          message announces nothing. The visible line is a separate node, keyed
          on the moment so its fade restarts, and hidden from the reader so the
          same sentence is not queued twice. */}
      <span className="sr-only" role="status">
        {whisper?.text ?? ''}
      </span>
      {whisper && (
        <p
          key={whisper.at}
          aria-hidden
          className="mr-whisper typo-caption text-status-success text-center"
          data-testid="mr-whisper"
        >
          {whisper.text}
        </p>
      )}

      {session.answerMode === 'pick' && (
        <Answers
          dealKey={session.question ?? ''}
          cards={cards}
          picked={turn.picked}
          busy={session.busy}
          onPick={turn.setPicked}
          onPlay={(i) => {
            const card = cards[i];
            if (card) turn.play(card.text);
          }}
        />
      )}

      <OfferDock proposals={proposals} onKept={onKept} />

      <Reply
        value={turn.draft}
        onChange={turn.setDraft}
        onSubmit={() => turn.play(turn.draft)}
        onSkip={turn.skip}
        answerMode={session.answerMode}
        busy={session.busy}
        voice={voice}
      />
    </>
  );
}

export default Lane;
