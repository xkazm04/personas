/**
 * One live deck session: the walk, the card in hand, its verbs and keys.
 *
 * Owns the per-card state the verbs read — question answers, the report's
 * rating and same-run reviews (`useReportDoors`), the card-wide fold signal
 * (`I`), the key map — and reports the card in hand up to the stage
 * (`onHead`) so the aurora follows it.
 *
 * After a verdict lands the tray keeps a receipt ("Accepted: <title>") until
 * the next one. When the queue runs out the deck closes as before, unless
 * other chips still hold cards: then it stays on the empty card and offers
 * them (`offers`).
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../model/decisionModel';
import { modalTypeOf } from '../model/decisionModel';
import { DECK_TITLE_ID, type DeckLanded, type DeckVerdict } from './deckTypes';
import { DeckCard } from './DeckCard';
import { FOLDS_CLOSED, type FoldSignal } from './DeckFold';
import { EmptyCard } from './DeckStates';
import { DeckTray } from './DeckTray';
import type { ChipOffer } from './EmptyOffers';
import { receiptLine } from './outcome';
import { useDeck } from './useDeck';
import { armsAccept, useDeckActions } from './useDeckActions';
import { useDeckKeys } from './useDeckKeys';
import { useReportDoors } from './useReportDoors';
import { useShapeController } from './shapes/useShapeController';

const LEAVE_OF = { accept: 'accept', reply: 'accept', reject: 'reject', done: 'done' } as const;

export function DeckSession({ scopeLabel, readOnly, queue, startId, offers = [], onDecide, onBack, onOpenLink, onHead, escapeGuard }: {
  scopeLabel: string;
  readOnly: boolean;
  queue: DecisionItem[];
  startId: string;
  /** Other chips that still hold cards, offered when this queue runs out. */
  offers?: ChipOffer[];
  /** Resolves when the verdict landed (optionally with its own receipt); rejects when it did not. */
  onDecide: (v: DeckVerdict) => Promise<DeckLanded | void>;
  onBack: () => void;
  onOpenLink: (item: DecisionItem, linkId: string) => void;
  onHead: (item: DecisionItem | undefined) => void;
  /** Set here: undoes an armed verdict / open reason prompt / key map; true when it did. */
  escapeGuard: MutableRefObject<(() => boolean) | null>;
}) {
  const { t, tx } = useTranslation();
  const [receipt, setReceipt] = useState<string | null>(null);
  const offersRef = useRef(offers);
  useEffect(() => { offersRef.current = offers; }, [offers]);

  const decideWithReceipt = useCallback(async (v: DeckVerdict) => {
    const landed = await onDecide(v);
    if (v.verdict !== 'skip') setReceipt(landed?.receipt ?? receiptLine(t.monitor, tx, v.item, LEAVE_OF[v.verdict]));
  }, [onDecide, t, tx]);
  const onEmpty = useCallback(() => {
    if (offersRef.current.length === 0) onBack();
  }, [onBack]);

  const deck = useDeck({ queue, startId, onDecide: decideWithReceipt, onEmpty });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [folds, setFolds] = useState<FoldSignal>(FOLDS_CLOSED);
  const item = deck.item;
  const report = useReportDoors(item);
  const shape = useShapeController(item, deck);

  useEffect(() => {
    setAnswers({});
    setMissing(false);
    setFolds(FOLDS_CLOSED);
  }, [item?.id]);
  useEffect(() => { onHead(item); }, [item, onHead]);

  const act = useDeckActions(deck, {
    answers,
    onIncomplete: () => setMissing(true),
    linkedReviews: report.linkedReviews,
    readOnly,
    onOpenLink,
    shape: { accept: shape.accept, offset: shape.offset },
  });
  const rate = (n: number) => { if (!readOnly) void report.rate(n); };
  const toggleFolds = () => setFolds((f) => ({ open: !f.open, gen: f.gen + 1 }));
  useDeckKeys(deck, act, {
    enabled: !!item,
    onRate: rate,
    onKeys: () => setKeysOpen((o) => !o),
    onFold: toggleFolds,
    onShapeKey: (e, digit) => !readOnly && shape.onKey(e, digit, act.defaultAccept),
  });
  useEffect(() => {
    escapeGuard.current = () => {
      if (keysOpen) { setKeysOpen(false); return true; }
      if (deck.prompt) { deck.setPrompt(null); return true; }
      if (deck.armed) { deck.setArmed(null); return true; }
      return false;
    };
  });
  useEffect(() => () => { escapeGuard.current = null; }, [escapeGuard]);

  const type = item ? modalTypeOf(item.kind) : 'approval';
  return (
    <DeckTray
      scopeLabel={scopeLabel}
      queue={deck.queue}
      index={deck.index}
      type={type}
      isCouncil={item?.kind === 'council'}
      armsAccept={item ? armsAccept(item) || shape.arms : false}
      shape={shape.shape}
      onWalk={deck.walk}
      onClose={onBack}
      tall={type === 'report'}
      keysOpen={keysOpen}
      onKeys={setKeysOpen}
      readOnly={readOnly}
      receipt={receipt}
    >
      <AnimatePresence initial={false} custom={deck.motion} mode="popLayout">
        {item ? (
          <DeckCard
            key={item.id}
            item={item}
            deck={deck}
            act={act}
            titleId={DECK_TITLE_ID}
            onClose={onBack}
            shape={shape}
            state={{
              rating: report.rating,
              setRating: rate,
              answers,
              setAnswer: (k, v) => setAnswers((a) => ({ ...a, [k]: v })),
              missing,
              folds,
            }}
          />
        ) : (
          <EmptyCard key="empty" offers={offers} />
        )}
      </AnimatePresence>
    </DeckTray>
  );
}
