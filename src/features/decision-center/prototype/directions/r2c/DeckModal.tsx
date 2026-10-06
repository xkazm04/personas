/**
 * Level 3 — the deck. ONE modal for all four types, on BaseModal (portal,
 * stack, focus trap, Esc). BaseModal's own panel is made transparent so the
 * deck draws its own surface: a tray holding a stack of cards, the top card
 * readable, the ones beneath peeking out to show how deep the queue is.
 *
 * The tray grows out of the chip / peek row that opened it and shrinks back
 * into it on close (origin morph); walking slides cards by direction; a
 * verdict stamps the card and sends it off toward its meaning.
 *
 * Aurora: the whole session sits in a field of slow light keyed to the card
 * in hand (kind tone, primary, tier tone) over a vignetted floor, so the deck
 * is the lit object in the room. The field re-tints as you walk.
 */
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DecisionItem } from '../../../model/decisionModel';
import { modalTypeOf } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import { CONTENT_FADE, originMotion, type OriginBox } from './deckMotion';
import { kindTone, tierOf } from './deckMeta';
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
  const [keysOpen, setKeysOpen] = useState(false);
  const item = deck.item;

  useEffect(() => {
    setRating(null);
    setAnswers({});
    setMissing(false);
  }, [item?.id]);

  const act = useDeckActions(deck, { rating, answers, onIncomplete: () => setMissing(true) });
  useDeckKeys(deck, act, { enabled: !!item, onRate: setRating, onKeys: () => setKeysOpen((o) => !o) });
  useEffect(() => {
    escapeGuard.current = () => {
      if (keysOpen) { setKeysOpen(false); return true; }
      if (deck.prompt) { deck.setPrompt(null); return true; }
      if (deck.armed) { deck.setArmed(null); return true; }
      return false;
    };
  });
  useEffect(() => () => { escapeGuard.current = null; }, [escapeGuard]);

  const wide = item ? modalTypeOf(item.kind) === 'report' : false;
  const morph = originMotion(origin, still);

  return (
    <motion.div
      initial={morph.initial}
      animate={morph.animate}
      exit={morph.exit}
      className={`au-scope au-t-${item ? kindTone(item) : 'accent'} au-tier-${item ? tierOf(item) : 2} relative w-full ${wide ? '' : 'max-w-[min(1120px,92vw)]'}`}
      data-testid="p2-deck"
      data-still={still ? '' : undefined}
    >
        <motion.div className="au-vignette" aria-hidden {...CONTENT_FADE} />
        <motion.div className="au-aurora" aria-hidden {...CONTENT_FADE}><i /><i /><i /></motion.div>
        <DeckTray
          scopeLabel={scopeLabel}
          queue={deck.queue}
          index={deck.index}
          type={item ? modalTypeOf(item.kind) : 'approval'}
          isCouncil={item?.kind === 'council'}
          onWalk={deck.walk}
          onClose={onBack}
          tall={wide}
          keysOpen={keysOpen}
          onKeys={setKeysOpen}
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
