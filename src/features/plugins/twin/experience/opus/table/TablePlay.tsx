/**
 * The table in play: suits (or the training deck) on the left, the question,
 * its offers and the hand in the middle, the twin's card on the right.
 * Everything it does goes through `SetupSessionApi`: an answer is `answer`, a
 * skip is `skip`, an offer is `accept`/`dismiss` — nothing here writes
 * anything by itself.
 *
 * The centre column is the one interaction and it is sized to FIT: a normal
 * turn (question, offers, hand, composer) has to sit inside 1280×800 without
 * the main column scrolling, which is why the vertical rhythm here is gap-4
 * and every card names a modest minimum rather than a comfortable one.
 */

import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TopicCoverage } from '../../../sub_training/topicCoverage';
import type { TwinSlotId } from '../../../shared/twinStatus';
import type { SetupSessionApi, SetupVoiceApi } from '../../../setup/setupContract';
import { deriveDeskTrail } from '../../../setup/desk/trailModel';
import { useDeskProposals } from '../../../setup/desk/useDeskProposals';
import { SuitRail } from './SuitRail';
import { TopicRail } from './TopicRail';
import { DealerSlot } from './DealerSlot';
import { LootRow } from './LootRow';
import { Hand } from './Hand';
import { Composer } from './Composer';
import { TwinCardPanel } from './TwinCardPanel';
import { SideRows } from './SideRows';
import { CompleteCard, GuideDownNotice, TrainingInvite } from './TableNotices';
import { KeyLegend } from './KeyLegend';
import { TOPIC_DECK, type TopicCard } from './topicDeck';
import { useSuitFlare } from './useSuitFlare';
import { useTableTurn } from './useTableTurn';
import type { StyleDock as StyleDockModel } from './useStyleDock';

export interface TablePlayProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  twinName: string;
  /** A twin made in this sitting: the first question greets it. */
  fresh: boolean;
  dock: StyleDockModel;
  coverage: TopicCoverage[];
  momentum: { sessions: number; lastTrainedAt: string | null };
  onPickTopic: (card: TopicCard, prompt: string) => void;
  onStartTraining: () => void;
  onOpenStyle: () => void;
  onOpenFields: () => void;
  onOpenHub: (slot: TwinSlotId) => void;
  onClose: () => void;
}

export function TablePlay(props: TablePlayProps) {
  const { session, voice, twinName, fresh, dock, onOpenHub } = props;
  const { t, tx, language } = useTranslation();
  const xo = t.twin.experience_opus;
  const { rootRef, cards, picked, setPicked, draft, setDraft, verdict, play, onKeyDown } =
    useTableTurn(session);
  const flare = useSuitFlare(session.checklist);
  const proposals = useDeskProposals(session, setDraft);
  const trail = useMemo(() => deriveDeskTrail(session.history, session.question), [session.history, session.question]);
  const topicCard = TOPIC_DECK.find((c) => c.id === session.topicPreset) ?? null;

  // The opening line exists only where it is true: the first turn of a
  // sitting, naming the suits still open, joined the way the language joins a
  // list (never with a hard-coded English comma).
  const open = session.checklist.filter((c) => c.status !== 'set').map((c) => xo.suits[c.id]);
  const list = new Intl.ListFormat(language, { type: 'conjunction' }).format(open);
  const greeting =
    trail.isOpening && session.stage === 'setup' && open.length > 0
      ? fresh
        ? tx(xo.table.greetingFresh, { name: twinName, items: list })
        : tx(xo.table.greeting, { items: list })
      : null;

  // Every suit set, by readiness. Not `score >= 100`: the score also counts
  // the Brain, which no suit on this table fills.
  const setupDone = session.stage === 'setup' && session.checklist.every((c) => c.status === 'set');
  const memoriesInSetup = session.stage === 'setup' && session.focus === 'memories' && !setupDone;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="xo-table"
        className="flex-1 min-h-0 grid gap-5 px-6 py-4 outline-none lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_19rem]"
      >
        <aside className="hidden lg:block min-h-0 overflow-y-auto pr-1 pb-2">
          {session.stage === 'setup' ? (
            <SuitRail items={session.checklist} focus={session.focus} flare={flare} onFocus={session.focusOn} onOpenHub={onOpenHub} />
          ) : (
            <TopicRail
              topicPreset={session.topicPreset}
              coverage={props.coverage}
              sessions={props.momentum.sessions}
              lastTrainedAt={props.momentum.lastTrainedAt}
              onPick={props.onPickTopic}
            />
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-4 w-full max-w-5xl mx-auto pb-2">
          {session.generatorError && <GuideDownNotice onRetry={session.redeal} onFields={props.onOpenFields} />}
          {setupDone ? (
            <CompleteCard name={twinName} onTrain={props.onStartTraining} onClose={props.onClose} />
          ) : memoriesInSetup ? (
            <TrainingInvite onStart={props.onStartTraining} />
          ) : (
            <>
              <DealerSlot
                verdict={verdict}
                stage={session.stage}
                focus={session.focus}
                topicLabel={topicCard ? xo.topics[topicCard.key].label : null}
                toneChannel={session.toneChannel}
                question={session.question}
                greeting={greeting}
                answerMode={session.answerMode}
                incoming={session.incoming}
                busy={session.busy}
              />
              <LootRow proposals={proposals} />
              {session.answerMode === 'pick' && (
                <Hand
                  dealKey={session.question ?? ''}
                  cards={cards}
                  picked={picked}
                  verdict={verdict}
                  busy={session.busy}
                  onPick={setPicked}
                  onPlay={(i) => {
                    const card = cards[i];
                    if (card) play(card.text);
                  }}
                />
              )}
              <Composer
                value={draft}
                onChange={setDraft}
                onSubmit={() => play(draft)}
                voice={voice}
                answerMode={session.answerMode}
                toneChannel={session.toneChannel}
                disabled={false}
              />
            </>
          )}
        </main>

        {/* ONE ambient panel, where there were three: the twin's card, with
            the style studio and the played pile as rows in its foot. */}
        <aside className="hidden xl:flex flex-col min-h-0 overflow-y-auto pb-2">
          <TwinCardPanel
            session={session}
            footer={
              <SideRows
                phase={dock.studio.phase}
                styleName={dock.studio.chosen?.name ?? null}
                trail={trail}
                onOpenStyle={props.onOpenStyle}
              />
            }
          />
        </aside>
      </div>
      <KeyLegend />
    </div>
  );
}

export default TablePlay;
