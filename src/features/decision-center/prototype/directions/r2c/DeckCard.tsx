/**
 * One card on the deck: head, body, ledger rail — the same three parts for
 * all four modal types; only the body and the rail's type section differ.
 * The card is the unit that slides when walking and leaves on a verdict
 * (`CARD_MOTION`), and it wears the verdict stamp for the beat before it goes.
 *
 * Aurora material: a layered surface lit from the kind tile's corner, a
 * living conic border in the kind tone (static under reduced motion), a tier
 * spine of light on the left edge, and the ledger rail sunk into a well.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, CornerUpRight, SkipForward, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { BURST_MOTION, CARD_MOTION, CARD_TRANSITION, STAMP_MOTION, STILL_CARD, STILL_TRANSITION, type Leave } from './deckMotion';
import { CardHeader } from './CardHeader';
import { ChatThread } from './ChatThread';
import { DeckDock } from './DeckDock';
import { LedgerRail } from './LedgerRail';
import { ProseBody } from './ProseBody';
import { QuestionFields } from './QuestionFields';
import { prepareDocument } from './readerDocument';
import { ReaderContents, ReportReader } from './ReportReader';
import { ThreadPeople } from './ThreadPeople';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { useReader } from './useReader';

const STAMP: Record<Exclude<Leave, 'walk'>, { lamp: string; icon: LucideIcon }> = {
  accept: { lamp: 'au-l-success', icon: Check },
  reject: { lamp: 'au-l-danger', icon: X },
  done: { lamp: 'au-l-accent', icon: Check },
  skip: { lamp: 'au-l-neutral', icon: SkipForward },
};

function stampLabel(item: DecisionItem, leave: Exclude<Leave, 'walk'>): string {
  if (leave === 'done') return modalTypeOf(item.kind) === 'chat' ? 'Done' : 'Read';
  if (leave === 'skip') return item.verdictLabels.skip;
  if (leave === 'accept' && modalTypeOf(item.kind) === 'chat') return 'Sent';
  return leave === 'accept' ? item.verdictLabels.accept : item.verdictLabels.reject;
}

function Stamp({ item, leave, still }: { item: DecisionItem; leave: Exclude<Leave, 'walk'>; still: boolean }) {
  const s = STAMP[leave];
  const Icon = leave === 'accept' && modalTypeOf(item.kind) === 'chat' ? CornerUpRight : s.icon;
  return (
    <div className={`${s.lamp} pointer-events-none absolute inset-0 z-20 flex items-center justify-center`} aria-hidden>
      {!still && <motion.span {...BURST_MOTION} className="au-burst absolute h-72 w-72" />}
      <motion.span
        initial={still ? { opacity: 0 } : STAMP_MOTION.initial}
        animate={still ? { opacity: 1 } : STAMP_MOTION.animate}
        className="au-stamp flex items-center gap-3 rounded-modal px-7 py-3 typo-hero uppercase"
      >
        <Icon className="h-10 w-10" strokeWidth={3} aria-hidden />
        {stampLabel(item, leave)}
      </motion.span>
    </div>
  );
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
        <ThreadPeople item={item} />
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
      className="au-card au-living absolute inset-0 flex flex-col overflow-hidden rounded-modal"
      data-testid="p2-card"
      data-item={item.id}
    >
      <span className="au-spine" aria-hidden />
      <div className="flex min-h-0 flex-1 gap-2 p-3 pl-0">
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
      {stamp && <Stamp item={item} leave={stamp} still={still} />}
    </motion.article>
  );
}
