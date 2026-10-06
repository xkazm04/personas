/**
 * One card on the deck: head, body, ledger rail — the same three parts for
 * all four modal types; only the body and the rail's type section differ.
 * The card wears its kind's ONE accent (`--r2b-tone`): the index rule along
 * its top edge, the kind tile and the eyebrow. It is the unit that slides when
 * walking and leaves on a verdict (`CARD_MOTION`), wearing the verdict stamp
 * for the beat before it goes.
 */
import { useMemo, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Check, CornerDownRight, SkipForward, X } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { CARD_MOTION, CARD_TRANSITION, STAMP_MOTION, STILL_CARD, STILL_TRANSITION, type Leave } from './deckMotion';
import { toneOf } from './deckMeta';
import { CardHeader } from './CardHeader';
import { ChatThread, ThreadPeople } from './ChatThread';
import { DeckDock } from './DeckDock';
import { KeyMap, KeysButton } from './KeyLegend';
import { LedgerRail } from './LedgerRail';
import { ProseBody } from './ProseBody';
import { QuestionFields } from './QuestionFields';
import { prepareDocument } from './readerDocument';
import { ReaderContents, ReportReader } from './ReportReader';
import type { DeckActions } from './useDeckActions';
import type { DeckController } from './useDeck';
import { useReader } from './useReader';

const STAMP: Record<Exclude<Leave, 'walk'>, { tone: string; Glyph: typeof Check }> = {
  accept: { tone: 'text-status-success', Glyph: Check },
  reject: { tone: 'text-status-error', Glyph: X },
  done: { tone: 'text-primary', Glyph: Check },
  skip: { tone: 'text-muted-foreground', Glyph: SkipForward },
};

function stampLabel(item: DecisionItem, leave: Exclude<Leave, 'walk'>): string {
  if (leave === 'done') return modalTypeOf(item.kind) === 'chat' ? 'Done' : 'Read';
  if (leave === 'skip') return item.verdictLabels.skip;
  if (leave === 'accept' && modalTypeOf(item.kind) === 'chat') return 'Sent';
  return leave === 'accept' ? item.verdictLabels.accept : item.verdictLabels.reject;
}

export interface CardState {
  rating: number | null;
  setRating: (n: number) => void;
  answers: Record<string, string>;
  setAnswer: (key: string, value: string) => void;
  missing: boolean;
}

export function DeckCard({ item, deck, act, state, titleId, keys }: {
  item: DecisionItem;
  deck: DeckController;
  act: DeckActions;
  state: CardState;
  titleId: string;
  keys: { open: boolean; toggle: () => void };
}) {
  const still = useReducedMotion();
  const type = modalTypeOf(item.kind);
  const isMd = item.document?.format === 'markdown';
  const mdSource = isMd ? item.document!.content : '';
  const doc = useMemo(() => prepareDocument(mdSource, `r2b-${item.sourceId}`), [mdSource, item.sourceId]);
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
    : type === 'chat' ? <ThreadPeople item={item} /> : null;

  const Glyph = stamp ? STAMP[stamp].Glyph : CornerDownRight;
  return (
    <motion.article
      custom={deck.motion}
      variants={still ? STILL_CARD : CARD_MOTION}
      initial="enter"
      animate="center"
      exit="exit"
      transition={still ? STILL_TRANSITION : CARD_TRANSITION}
      className="r2b-card"
      style={{ '--r2b-tone': toneOf(item) } as CSSProperties}
      data-testid="r2b-card"
      data-item={item.id}
    >
      <CardHeader item={item} titleId={titleId} keys={<KeysButton open={keys.open} onToggle={keys.toggle} />} />
      <KeyMap open={keys.open} type={type} isCouncil={item.kind === 'council'} labels={item.verdictLabels} />
      <div className="r2b-split">
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
        <LedgerRail
          item={item}
          plainInRail={type === 'report'}
          extra={extra}
          dock={<DeckDock item={item} deck={deck} act={act} rating={state.rating} onRate={state.setRating} />}
        />
      </div>
      {/* The live region is born empty and stays mounted; only its text follows the stamp. */}
      <span className="sr-only" aria-live="polite">{stamp ? stampLabel(item, stamp) : ''}</span>
      {stamp && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" aria-hidden>
          <motion.span
            initial={still ? { opacity: 0 } : STAMP_MOTION.initial}
            animate={still ? { opacity: 1 } : STAMP_MOTION.animate}
            className={`r2b-stamp typo-heading-lg uppercase ${STAMP[stamp].tone}`}
          >
            <Glyph className="h-6 w-6" strokeWidth={2.5} aria-hidden />
            {stampLabel(item, stamp)}
          </motion.span>
        </div>
      )}
    </motion.article>
  );
}
