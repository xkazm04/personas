/**
 * One live deck session: the walk, the card in hand, its verbs and keys.
 *
 * Owns the per-card state the verbs read — question answers, the report's
 * rating and same-run reviews (`useReportDoors`), the key map — and reports
 * the card in hand up to the stage (`onHead`) so the aurora follows it.
 */
import { useEffect, useState, type MutableRefObject } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { DecisionItem } from '../model/decisionModel';
import { modalTypeOf } from '../model/decisionModel';
import { DECK_TITLE_ID, type DeckVerdict } from './deckTypes';
import { DeckCard } from './DeckCard';
import { EmptyCard } from './DeckStates';
import { DeckTray } from './DeckTray';
import { useDeck } from './useDeck';
import { useDeckActions } from './useDeckActions';
import { useDeckKeys } from './useDeckKeys';
import { useReportDoors } from './useReportDoors';

export function DeckSession({ scopeLabel, readOnly, queue, startId, onDecide, onBack, onOpenLink, onHead, escapeGuard }: {
  scopeLabel: string;
  readOnly: boolean;
  queue: DecisionItem[];
  startId: string;
  onDecide: (v: DeckVerdict) => Promise<void>;
  onBack: () => void;
  onOpenLink: (item: DecisionItem, linkId: string) => void;
  onHead: (item: DecisionItem | undefined) => void;
  /** Set here: undoes an armed verdict / open reason prompt / key map; true when it did. */
  escapeGuard: MutableRefObject<(() => boolean) | null>;
}) {
  const deck = useDeck({ queue, startId, onDecide, onEmpty: onBack });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const item = deck.item;
  const report = useReportDoors(item);

  useEffect(() => {
    setAnswers({});
    setMissing(false);
  }, [item?.id]);
  useEffect(() => { onHead(item); }, [item, onHead]);

  const act = useDeckActions(deck, {
    answers,
    onIncomplete: () => setMissing(true),
    linkedReviews: report.linkedReviews,
    readOnly,
    onOpenLink,
  });
  const rate = (n: number) => { if (!readOnly) void report.rate(n); };
  useDeckKeys(deck, act, { enabled: !!item, onRate: rate, onKeys: () => setKeysOpen((o) => !o) });
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
      onWalk={deck.walk}
      onClose={onBack}
      tall={type === 'report'}
      keysOpen={keysOpen}
      onKeys={setKeysOpen}
      readOnly={readOnly}
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
            state={{
              rating: report.rating,
              setRating: rate,
              answers,
              setAnswer: (k, v) => setAnswers((a) => ({ ...a, [k]: v })),
              missing,
            }}
          />
        ) : (
          <EmptyCard key="empty" />
        )}
      </AnimatePresence>
    </DeckTray>
  );
}
