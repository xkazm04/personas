/**
 * Level 3 — the deck. ONE modal for all four types, on BaseModal (portal,
 * stack, focus trap, Esc). BaseModal's own panel is made transparent so the
 * deck draws its own surface: a tray holding a stack of cards, the top card
 * readable, the ones beneath peeking out to show how deep the queue is.
 *
 * The tray grows out of the chip / peek row that opened it and shrinks back
 * into it on close (origin morph); walking slides cards by direction; a
 * verdict stamps the card and sends it off toward its meaning.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DecisionItem } from '../../../model/decisionModel';
import { modalTypeOf } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import { originMotion, type OriginBox } from './deckMotion';
import { DeckCard } from './DeckCard';
import { DeckTray } from './DeckTray';
import { useDeck, type DeckScope } from './useDeck';
import { useDeckActions } from './useDeckActions';
import { useDeckKeys } from './useDeckKeys';

const TITLE_ID = 'p2-deck-title';

/** One opening of the deck. `key` changes per opening so state starts fresh. */
export interface DeckSession {
  key: number;
  scope: DeckScope;
  scopeLabel: string;
  startId: string;
  origin: OriginBox | null;
}

interface SessionProps extends Omit<DeckSession, 'key'> {
  items: DecisionItem[];
  ready: DecisionItem[];
  onDecide: (v: PrototypeVerdict) => void;
  onBack: () => void;
  /** Set by the open session: undoes an armed verdict / open reason prompt; true when it did. */
  escapeGuard: MutableRefObject<(() => boolean) | null>;
}

/**
 * BaseModal stays mounted and toggles `isOpen`, so its AnimatePresence keeps
 * the closing session on screen long enough for the shrink-to-origin exit.
 */
export function DeckModal({ session, ...rest }: Omit<SessionProps, keyof Omit<DeckSession, 'key'> | 'escapeGuard'> & { session: DeckSession | null }) {
  const escapeGuard = useRef<(() => boolean) | null>(null);
  // Esc (BaseModal) and the backdrop both land here: the first press undoes
  // what is armed, only a press with nothing to undo steps back.
  const close = () => {
    if (escapeGuard.current?.()) return;
    rest.onBack();
  };
  return (
    <BaseModal
      isOpen={!!session}
      onClose={close}
      titleId={TITLE_ID}
      portal
      staggerChildren={false}
      maxWidthClass="max-w-[min(1320px,94vw)]"
      panelClassName="relative flex justify-center overflow-visible bg-transparent"
    >
      {session && (
        <DeckSessionView
          key={session.key}
          scope={session.scope}
          scopeLabel={session.scopeLabel}
          startId={session.startId}
          origin={session.origin}
          {...rest}
          escapeGuard={escapeGuard}
        />
      )}
    </BaseModal>
  );
}

function DeckSessionView({ scope, scopeLabel, startId, origin, items, ready, onDecide, onBack, escapeGuard }: SessionProps) {
  const still = useReducedMotion();
  const deck = useDeck({ scope, startId, items, ready, onDecide, onEmpty: onBack });
  const [rating, setRating] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const item = deck.item;

  useEffect(() => {
    setRating(null);
    setAnswers({});
    setMissing(false);
  }, [item?.id]);

  const act = useDeckActions(deck, { rating, answers, onIncomplete: () => setMissing(true) });
  useDeckKeys(deck, act, { enabled: !!item, onRate: setRating });
  useEffect(() => {
    escapeGuard.current = () => {
      if (deck.prompt) { deck.setPrompt(null); return true; }
      if (deck.armed) { deck.setArmed(null); return true; }
      return false;
    };
  });
  useEffect(() => () => { escapeGuard.current = null; }, [escapeGuard]);

  const wide = item ? modalTypeOf(item.kind) === 'report' : false;
  const morph = originMotion(origin, still);

  return (
    <motion.div initial={morph.initial} animate={morph.animate} exit={morph.exit} className={`relative w-full ${wide ? '' : 'max-w-[min(1120px,92vw)]'}`} data-testid="p2-deck">
        <DeckTray
          scopeLabel={scopeLabel}
          queue={deck.queue}
          index={deck.index}
          type={item ? modalTypeOf(item.kind) : 'approval'}
          isCouncil={item?.kind === 'council'}
          onWalk={deck.walk}
          onClose={onBack}
          tall={wide}
        >
          <AnimatePresence initial={false} custom={deck.motion} mode="popLayout">
            {item && (
              <DeckCard
                key={item.id}
                item={item}
                deck={deck}
                act={act}
                titleId={TITLE_ID}
                state={{
                  rating,
                  setRating,
                  answers,
                  setAnswer: (k, v) => setAnswers((a) => ({ ...a, [k]: v })),
                  missing,
                }}
              />
            )}
          </AnimatePresence>
        </DeckTray>
    </motion.div>
  );
}
