/**
 * One card on the deck: head, body, ledger well — the same three parts for
 * all four modal types; only the body and the well's type section differ.
 * The well runs the card's full height beside head + body, so the ledger is
 * never the cramped column while the argument column sits half empty.
 * The card is a frosted glass object lit by its kind's tone; it is the unit
 * that slides when walking and leaves on a verdict (`CARD_MOTION`), and it
 * wears the verdict stamp for the beat before it goes.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { chipOf, modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { CARD_MOTION, CARD_TRANSITION, STILL_CARD, STILL_TRANSITION } from './deckMotion';
import { CardHeader } from './CardHeader';
import { ChatThread } from './ChatThread';
import { DeckDock } from './DeckDock';
import { DeckStamp, stampLabel } from './DeckStamp';
import { LedgerRail } from './LedgerRail';
import { ProseBody } from './ProseBody';
import { QuestionFields } from './QuestionFields';
import { prepareDocument } from './readerDocument';
import { ReaderContents, ReportReader } from './ReportReader';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { useReader } from './useReader';

export interface CardState {
  rating: number | null;
  setRating: (n: number) => void;
  answers: Record<string, string>;
  setAnswer: (key: string, value: string) => void;
  missing: boolean;
}

function Participants({ item }: { item: DecisionItem }) {
  const names = [...new Set(item.thread?.messages.map((m) => m.name) ?? [])];
  return (
    <div className="flex flex-col gap-2 pt-4">
      <span className="typo-label">In this thread</span>
      <span className="flex items-center pl-1">
        {names.map((n) => (
          <Tooltip key={n} content={n}>
            <span className="r2a-avatar r2a-avatar--stack h-8 w-8 typo-label" tabIndex={0} aria-label={n}>{([...n][0] ?? '?').toUpperCase()}</span>
          </Tooltip>
        ))}
      </span>
    </div>
  );
}

export function DeckCard({ item, deck, act, state, titleId }: {
  item: DecisionItem;
  deck: DeckController;
  act: DeckActions;
  state: CardState;
  titleId: string;
}) {
  const still = useReducedMotion();
  const type = modalTypeOf(item.kind);
  const isMd = item.document?.format === 'markdown';
  const mdSource = isMd ? item.document!.content : '';
  const doc = useMemo(() => prepareDocument(mdSource, `r2a-${item.sourceId}`), [mdSource, item.sourceId]);
  const reader = useReader(doc.headings, item.id);
  const stamp = deck.stamp && deck.stamp !== 'walk' ? deck.stamp : null;

  const body = type === 'report'
    ? <ReportReader item={item} doc={doc} reader={reader} />
    : type === 'chat'
      ? <ChatThread item={item} onSend={act.reply} />
      : (
        <ProseBody item={item}>
          {item.input && <QuestionFields input={item.input} answers={state.answers} onAnswer={state.setAnswer} missing={state.missing} />}
        </ProseBody>
      );

  const extra = type === 'report'
    ? <ReaderContents doc={doc} reader={reader} isHtml={!isMd} />
    : type === 'chat' ? <Participants item={item} /> : null;

  return (
    <motion.article
      custom={deck.motion}
      variants={still ? STILL_CARD : CARD_MOTION}
      initial="enter"
      animate="center"
      exit="exit"
      transition={still ? STILL_TRANSITION : CARD_TRANSITION}
      className="r2a-card r2a-hairline"
      data-r2a-kind={chipOf(item.kind)}
      data-testid="r2a-card"
      data-item={item.id}
    >
      <div className="flex min-h-0 flex-1 gap-1 p-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <CardHeader item={item} titleId={titleId} />
          {body}
        </div>
        <LedgerRail
          item={item}
          extra={extra}
          dock={<DeckDock item={item} deck={deck} act={act} rating={state.rating} onRate={state.setRating} />}
        />
      </div>
      {/* The live region is born empty and stays mounted; only its text follows the stamp. */}
      <span className="sr-only" aria-live="polite">{stamp ? stampLabel(item, stamp) : ''}</span>
      {stamp && <DeckStamp item={item} leave={stamp} />}
    </motion.article>
  );
}
