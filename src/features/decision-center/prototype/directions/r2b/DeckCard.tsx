/**
 * One card on the deck: head, body, ledger rail — the same three parts for
 * all four modal types; only the body and the rail's type section differ.
 * The card is the unit that slides when walking and leaves on a verdict
 * (`CARD_MOTION`), and it wears the verdict stamp for the beat before it goes.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { CARD_MOTION, CARD_TRANSITION, STAMP_MOTION, STILL_CARD, STILL_TRANSITION, type Leave } from './deckMotion';
import { CardHeader } from './CardHeader';
import { ChatThread } from './ChatThread';
import { DeckDock } from './DeckDock';
import { LedgerRail } from './LedgerRail';
import { ProseBody } from './ProseBody';
import { QuestionFields } from './QuestionFields';
import { prepareDocument } from './readerDocument';
import { ReaderContents, ReportReader } from './ReportReader';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { useReader } from './useReader';

const STAMP_TONE: Record<Exclude<Leave, 'walk'>, string> = {
  accept: 'border-status-success text-status-success',
  reject: 'border-status-error text-status-error',
  done: 'border-primary text-primary',
  skip: 'border-muted-foreground text-muted-foreground',
};

function stampLabel(item: DecisionItem, leave: Exclude<Leave, 'walk'>): string {
  if (leave === 'done') return modalTypeOf(item.kind) === 'chat' ? 'Done ✓' : 'Read ✓';
  if (leave === 'skip') return item.verdictLabels.skip;
  if (leave === 'accept' && modalTypeOf(item.kind) === 'chat') return 'Sent ✓';
  return leave === 'accept' ? `${item.verdictLabels.accept} ✓` : `${item.verdictLabels.reject} ✕`;
}

export interface CardState {
  rating: number | null;
  setRating: (n: number) => void;
  answers: Record<string, string>;
  setAnswer: (key: string, value: string) => void;
  missing: boolean;
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
  const doc = useMemo(() => prepareDocument(mdSource, `p2-${item.sourceId}`), [mdSource, item.sourceId]);
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
    : type === 'chat'
      ? (
        <div className="flex flex-col gap-1 pt-4">
          <span className="typo-label">In this thread</span>
          <span className="typo-body text-foreground">{[...new Set(item.thread?.messages.map((m) => m.name) ?? [])].join(', ')}</span>
        </div>
      )
      : null;

  return (
    <motion.article
      custom={deck.motion}
      variants={still ? STILL_CARD : CARD_MOTION}
      initial="enter"
      animate="center"
      exit="exit"
      transition={still ? STILL_TRANSITION : CARD_TRANSITION}
      className="absolute inset-0 flex flex-col overflow-hidden rounded-modal border border-primary/15 bg-background shadow-elevation-4"
      data-testid="p2-card"
      data-item={item.id}
    >
      <CardHeader item={item} titleId={titleId} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
        <LedgerRail
          item={item}
          extra={extra}
          dock={<DeckDock item={item} deck={deck} act={act} rating={state.rating} onRate={state.setRating} />}
        />
      </div>
      {/* The live region is born empty and stays mounted; only its text follows the stamp. */}
      <span className="sr-only" aria-live="polite">{stamp ? stampLabel(item, stamp) : ''}</span>
      {stamp && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <motion.span
            initial={still ? { opacity: 0 } : STAMP_MOTION.initial}
            animate={still ? { opacity: 1 } : STAMP_MOTION.animate}
            className={`rounded-card border-4 bg-background/80 px-6 py-2 typo-hero uppercase ${STAMP_TONE[stamp]}`}
          >
            {stampLabel(item, stamp)}
          </motion.span>
        </div>
      )}
    </motion.article>
  );
}
