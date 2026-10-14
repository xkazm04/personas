/**
 * The Decision Deck. ONE modal for all four types, on BaseModal (portal,
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
 *
 * Until the roster says which card opens (`useDeckStart`) the stack holds a
 * ghost card; the frame, aurora and origin morph are already there, so the
 * deck never re-opens when the cards arrive.
 */
import './aurora.css';
import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { motion } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { DECISION_CHIPS, modalTypeOf, type ChipCount, type DecisionItem, type HubChip } from '../model/decisionModel';
import type { DeckRequestScope } from './deckStore';
import { DECK_TITLE_ID, type DeckVerdict } from './deckTypes';
import { CONTENT_FADE, originMotion, type OriginBox } from './deckMotion';
import { kindTone, tierOf } from './deckMeta';
import { DECK_PRIORITY } from './keys';
import { DeckSession } from './DeckSession';
import { DeckTray } from './DeckTray';
import type { ChipOffer } from './EmptyOffers';
import { GhostCard } from './DeckStates';
import { queueOf } from './useDeck';
import { useDeckStart } from './useDeckStart';

/** One opening of the deck. `key` changes per opening so state starts fresh. */
export interface DeckSessionSpec {
  key: number;
  scope: DeckRequestScope;
  scopeLabel: string;
  focusId?: string;
  origin: OriginBox | null;
  /** History row: no verdicts, just the card and Close. */
  readOnly: boolean;
}

export interface DeckModalProps {
  session: DeckSessionSpec | null;
  /** The roster's loaded items (`compareDecision` order). */
  items: DecisionItem[];
  loading: boolean;
  /** The roster's chip counts; an empty chip deck offers the others that still hold cards. */
  counts?: Record<HubChip, ChipCount>;
  /** The write. Rejects when it did not land (the caller has toasted). */
  onDecide: (v: DeckVerdict) => Promise<void>;
  onBack: () => void;
  /** A card's `links` entry was followed (navigation). */
  onOpenLink: (item: DecisionItem, linkId: string) => void;
}

/**
 * BaseModal stays mounted and toggles `isOpen`, so its AnimatePresence keeps
 * the closing session on screen long enough for the shrink-to-origin exit.
 */
export function DeckModal({ session, ...rest }: DeckModalProps) {
  const escapeGuard = useRef<(() => boolean) | null>(null);
  // Esc and the backdrop both land here: the first press undoes what is
  // armed, only a press with nothing to undo steps back.
  const close = () => {
    if (escapeGuard.current?.()) return;
    rest.onBack();
  };
  // The deck takes Escape itself, above BaseModal (80), and CONSUMES it: the
  // Monitor behind it closes on a raw window Escape listener, and the close
  // that reopens the hub's peek (closedReturnTo) must not be the same press
  // that tears the Monitor down. The provider's window listener is mounted at
  // app boot, before any surface's own, so stopping it here stops theirs.
  useAppKeyboard((e) => {
    if (e.key !== 'Escape') return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
    return true;
  }, { enabled: !!session, priority: DECK_PRIORITY });
  return (
    <BaseModal
      isOpen={!!session}
      onClose={close}
      titleId={DECK_TITLE_ID}
      portal
      staggerChildren={false}
      maxWidthClass="max-w-[min(1320px,94vw)]"
      panelClassName="relative flex justify-center overflow-visible bg-transparent"
    >
      {session && <DeckStage key={session.key} session={session} {...rest} escapeGuard={escapeGuard} />}
    </BaseModal>
  );
}

/**
 * The chips an empty chip deck offers: every other decision chip whose count
 * read landed and is above zero. A deck over everything, or one card, offers
 * nothing (it closes when it runs out, as it always did).
 */
export function offersOf(scope: DeckSessionSpec['scope'], counts: Record<HubChip, ChipCount> | undefined): ChipOffer[] {
  if (scope.kind !== 'chip' || !counts) return [];
  return DECISION_CHIPS
    .filter((c) => c !== scope.chip && !counts[c]?.failed && (counts[c]?.n ?? 0) > 0)
    .map((c) => ({ chip: c, n: counts[c]!.n }));
}

function DeckStage({ session, items, loading, counts, onDecide, onBack, onOpenLink, escapeGuard }: Omit<DeckModalProps, 'session'> & {
  session: DeckSessionSpec;
  escapeGuard: MutableRefObject<(() => boolean) | null>;
}) {
  const still = useReducedMotion();
  const queue = useMemo(() => queueOf(session.scope, items), [session.scope, items]);
  const startId = useDeckStart(queue, session.focusId, loading);
  const offers = useMemo(() => offersOf(session.scope, counts), [session.scope, counts]);
  const [head, setHead] = useState<DecisionItem | undefined>(undefined);
  const wide = head ? modalTypeOf(head.kind) === 'report' : false;
  const morph = originMotion(session.origin, still);

  return (
    <motion.div
      initial={morph.initial}
      animate={morph.animate}
      exit={morph.exit}
      className={`au-scope au-t-${head ? kindTone(head) : 'accent'} au-tier-${head ? tierOf(head) : 2} relative w-full ${wide ? '' : 'max-w-[min(1120px,92vw)]'}`}
      data-testid="decision-deck"
      data-still={still ? '' : undefined}
    >
      <motion.div className="au-vignette" aria-hidden {...CONTENT_FADE} />
      <motion.div className="au-aurora" aria-hidden {...CONTENT_FADE}><i /><i /><i /></motion.div>
      {startId === null ? (
        <DeckTray scopeLabel={session.scopeLabel} queue={[]} index={0} pending>
          <GhostCard />
        </DeckTray>
      ) : (
        <DeckSession
          scopeLabel={session.scopeLabel}
          readOnly={session.readOnly}
          queue={queue}
          startId={startId}
          offers={offers}
          onDecide={onDecide}
          onBack={onBack}
          onOpenLink={onOpenLink}
          onHead={setHead}
          escapeGuard={escapeGuard}
        />
      )}
    </motion.div>
  );
}
