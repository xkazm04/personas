/**
 * The table in play: what was played so far, the question, the fan of three,
 * the offers, and the composer.
 *
 * Keyboard scope lives on the table element so the composer still takes
 * typing. That element is `tabIndex={-1}` — programmatically focusable, never
 * a tab stop — because a scroll container that swallows a Tab press is a trap
 * for every keyboard user and buys nothing the shortcuts do not already give.
 *
 * Only the middle band scrolls. The composer is pinned below it, so the hand
 * you play from does not slide off the bottom of the table.
 *
 * The hand floats over the blueprint (spark twin-portable-blueprint): while no
 * question is live (`busy`) it is not dealt at all, so the blueprint under it
 * is the waiting surface and no ghost card stands in for it; and while the
 * answer beat `holding` it, the hand lifts away so the blueprint can show what
 * the answer changed, and is dealt back when the beat ends.
 *
 * Every rule about WHEN a turn may be answered lives in `useTurn`, not here.
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import type { SetupSessionApi, SetupVoiceApi } from '../../setup/setupContract';
import { deriveDeskTrail } from '../../setup/desk/trailModel';
import { useHandVariants } from '../../blueprint/beatMotion';
import { DEALER_VARIANTS } from '../cardMotion';
import { DealerCard } from './DealerCard';
import { DecisionFan } from './DecisionFan';
import { ProposalFan } from './ProposalFan';
import { TableComposer } from './TableComposer';
import { TableTrail } from './TableTrail';
import { tableKeyHandler } from './keys';
import type { Turn } from './useTurn';

interface CardTableProps {
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  turn: Turn;
  /** The training topic's label, already translated. */
  topicLabel: string | null;
  /** The answer beat holds the hand off the table. Absent: the hand is dealt whenever a question is live. */
  holding?: boolean;
}

export function CardTable({ session, voice, turn, topicLabel, holding = false }: CardTableProps) {
  const { t, tx: fmt, language } = useTranslation();
  const tx = t.twin.experience;
  const tableRef = useRef<HTMLDivElement>(null);
  const exitVariants = useMotionVariants(DEALER_VARIANTS);
  const handVariants = useHandVariants();
  const dealt = !session.busy && !holding;

  // A `write` turn deals no cards by contract: its answer has to be typed,
  // because it becomes a writing sample in the person's own words.
  const cards = useMemo(
    () => (session.answerMode === 'write' ? [] : session.suggestions.slice(0, 3)),
    [session.answerMode, session.suggestions],
  );
  const trail = useMemo(
    () => deriveDeskTrail(session.history, session.question),
    [session.history, session.question],
  );

  // The open slots are joined the way the reader's language joins a list —
  // never with a hard-coded English comma.
  const open = session.checklist
    .filter((item) => item.status !== 'set')
    .map((item) => tx.slots[item.id].label);
  const greeting =
    trail.isOpening && session.stage === 'setup' && open.length > 0
      ? fmt(tx.table.greeting, {
          items: new Intl.ListFormat(language, { type: 'conjunction' }).format(open),
        })
      : null;

  // Focus the table whenever the hand is dealt, unless the person has moved
  // focus somewhere else on purpose: a composer that left with the hand drops
  // focus to the body, and the keys have to work on the card that replaced it.
  useEffect(() => {
    if (!dealt) return;
    const table = tableRef.current;
    const active = document.activeElement;
    if (table && (!active || active === document.body || table.contains(active))) table.focus();
  }, [dealt]);

  const edit = useCallback(
    (index: number) => {
      const card = cards[index];
      if (!card) return;
      turn.setDraft(card.text);
      tableRef.current?.querySelector<HTMLTextAreaElement>('[data-testid="setup-desk-composer"]')?.focus();
    },
    [cards, turn],
  );

  // No keys reach a hand that is not on the table: during the beat a press
  // deals early (the beat owns that), and must not also play the card it is
  // about to reveal.
  const onKeyDown = dealt
    ? tableKeyHandler({
        count: cards.length,
        picked: turn.picked,
        setPicked: turn.setPicked,
        play: (i) => {
          const card = cards[i];
          if (card) turn.play(card.text);
        },
        edit,
        skip: turn.skip,
      })
    : undefined;

  // Reading an answer, or drawing up the plan, behind a question already here.
  const working = session.reconciling || session.planning;
  const status = holding
    ? t.twin.blueprint.delta.recorded
    : session.busy
      ? tx.table.thinking
      : working
        ? tx.table.reconciling
        : '';

  const exitKey =
    turn.verdict === 'played' ? 'exitAccept' : turn.verdict === 'skipped' ? 'exitSkip' : 'exitNone';

  return (
    <div
      ref={tableRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="setup-desk"
      className="flex-1 min-h-0 flex flex-col outline-none"
    >
      {/* The table's one status region. It lives OUTSIDE the hand and the keyed
          deal so it exists before its text does: a region remounted with each
          card is born with its message and never announces it (census
          `live-region-born-with-its-message`). */}
      <span className="sr-only" role="status" data-testid="setup-desk-status">
        {status}
      </span>
      <AnimatePresence initial={false}>
        {dealt && (
          <motion.div
            key="hand"
            variants={handVariants}
            initial="hidden"
            animate="show"
            exit="exitAccept"
            className="tx-hand flex-1 min-h-0 flex flex-col"
            data-testid="setup-desk-hand"
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-5">
              <TableTrail history={session.history} question={session.question} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={session.question ?? 'idle'} variants={exitVariants} initial="hidden" animate="show" exit={exitKey}>
                  <DealerCard
                    stage={session.stage}
                    focus={session.focus}
                    topicLabel={topicLabel}
                    toneChannel={session.toneChannel}
                    greeting={greeting}
                    question={session.question ?? tx.table.noQuestion}
                    answerMode={session.answerMode}
                    incoming={session.incoming}
                    working={working}
                  />
                  <DecisionFan
                    cards={cards}
                    picked={turn.picked}
                    busy={session.busy}
                    focus={session.focus}
                    onPick={turn.setPicked}
                    onCommit={(text) => turn.play(text)}
                  />
                </motion.div>
              </AnimatePresence>
              <ProposalFan session={session} intoComposer={turn.setDraft} />
            </div>
            <div className="flex-shrink-0 border-t border-primary/15 bg-background/70 px-4 md:px-8 py-3">
              <TableComposer
                draft={turn.draft}
                onDraft={turn.setDraft}
                onSubmit={() => turn.play(turn.draft)}
                onSkip={turn.skip}
                answerMode={session.answerMode}
                busy={session.busy}
                voice={voice}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default CardTable;
