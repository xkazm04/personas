/**
 * HandStage — Halo · Hand's decision stage, a card game played over the app.
 *
 * Rounds:
 * 1. Open: every waiting item is dealt from the right edge into a fanned hand
 *    tucked behind the input bar; the app behind dims (the chat pieces stay
 *    lit and usable).
 * 2. Play: the focused card lifts out of the hand, flips (rotateY) and grows to
 *    the centre as the full `CardFrame`, whose text box is the real
 *    `WorkItemBody`.
 * 3. Resolve: when the played item leaves `items` (the operator acted through
 *    the product's own verb) the card burns out upward (scale + blur + fade)
 *    and the next card is drawn from the hand: the next round.
 * 4. End: an empty hand shows a short "Turn ended" banner, then `onClose`.
 *
 * Keys (via `useAppKeyboard`, one rung above the layer): 1-9 pick a hand card,
 * Enter plays the picked one, Esc returns the hand (cards fly back right).
 */

import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { KIND_VAR } from '../../../tones';
import { NEXT_COPY as N } from '../../../nextCopy';
import type { WorkItem } from '../../../useWorkforce';
import type { DecisionStageProps } from '../../slots';
import { CardBackFace } from './CardBack';
import { CardFrame } from './CardFrame';
import { HAND_COPY as C } from './copy';
import { HAND_VISIBLE, HandFan } from './HandFan';
import { GOLD, GOLD_SOFT } from './handTokens';

const LEAVE_MS = 640;
const BURN_MS = 560;
const END_MS = 1300;
type Phase = 'hidden' | 'shown' | 'leaving';
type ExitMode = 'bench' | 'burn';

/**
 * The two ways a played card leaves the table. `bench`: it sinks and shrinks
 * back into the hand, flipping face down. `burn`: resolved, it swells, blurs
 * and burns out upward (no particles, a brightness flare does the ember).
 */
const EXIT: Record<ExitMode, TargetAndTransition> = {
  bench: { y: 280, scale: 0.3, rotateY: 180, opacity: 0, transition: { duration: 0.32 } },
  burn: {
    y: -150,
    scale: 1.08,
    opacity: 0,
    filter: 'blur(14px) brightness(1.7)',
    transition: { duration: BURN_MS / 1000, ease: [0.4, 0, 0.9, 0.6] },
  },
};

/** Owns presence: stays mounted long enough for the cards to fly home. */
export function HandStage(props: DecisionStageProps) {
  const { open, onClose } = props;
  const [phase, setPhase] = useState<Phase>(open ? 'shown' : 'hidden');
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setPhase(open ? 'shown' : phase === 'shown' ? 'leaving' : phase);
  }

  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = setTimeout(() => {
      setPhase('hidden');
      // Closed from inside (Esc, the turn ended): tell the frame now that the
      // cards are home. Closed from outside (Alt+W): the frame already knows.
      if (openRef.current) closeRef.current();
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const requestClose = useCallback(() => setPhase('leaving'), []);
  if (phase === 'hidden') return null;
  return <Table {...props} leaving={phase === 'leaving'} requestClose={requestClose} />;
}

function Table({
  items,
  focusId,
  onFocus,
  onSend,
  leaving,
  requestClose,
}: DecisionStageProps & { leaving: boolean; requestClose: () => void }) {
  const { shouldAnimate } = useMotion();
  const [dealing, setDealing] = useState(true);
  // The card on the table. Owned here rather than read from `focusId`: the
  // frame's focus falls back to the first waiting item, so after a resolution
  // it would jump to the next card before the burned one is gone.
  const [tableId, setTableId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [burning, setBurning] = useState<WorkItem | null>(null);
  const [resolved, setResolved] = useState(0);
  const [ended, setEnded] = useState(false);
  // Opened with nothing waiting: the end banner says so instead.
  const [emptyAtOpen] = useState(items.length === 0);

  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // The deal: all cards into the hand first, then the focused one is played.
  useEffect(() => {
    const t = setTimeout(
      () => {
        setDealing(false);
        const all = itemsRef.current;
        const first = all.find((i) => i.id === focusRef.current) ?? all[0];
        if (first) setTableId(first.id);
      },
      shouldAnimate ? 380 + items.length * 80 : 0,
    );
    return () => clearTimeout(t);
    // Deal once per open (this component mounts per open).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback(
    (id: string) => {
      setTableId(id);
      setSelectedId(null);
      onFocus(id);
    },
    [onFocus],
  );

  // A pick from outside (a mini deck on the board) plays that card, unless
  // the focus merely fell back because the card on the table was resolved.
  const [prevFocus, setPrevFocus] = useState(focusId);
  if (focusId !== prevFocus) {
    setPrevFocus(focusId);
    const tableStillWaiting = !tableId || items.some((i) => i.id === tableId);
    if (!dealing && !burning && focusId && focusId !== tableId && tableStillWaiting && items.some((i) => i.id === focusId)) {
      setTableId(focusId);
      setSelectedId(null);
    }
  }

  const played = tableId && !burning ? (items.find((i) => i.id === tableId) ?? null) : null;
  const handCards = useMemo(() => items.filter((i) => i.id !== played?.id), [items, played?.id]);

  // Resolution: the played card's item left `items` (the operator acted) →
  // it burns out (its exit), then the next card is drawn: the next round. An
  // empty hand with nothing on the table ends the turn.
  const lastPlayed = useRef<WorkItem | null>(null);
  useEffect(() => {
    if (played) lastPlayed.current = played;
  }, [played]);
  useEffect(() => {
    const last = lastPlayed.current;
    if (last && !items.some((i) => i.id === last.id)) {
      lastPlayed.current = null;
      setBurning(last);
      setTableId(null);
      setResolved((n) => n + 1);
      return;
    }
    if (!dealing && items.length === 0 && !burning) setEnded(true);
  }, [items, dealing, burning]);
  useEffect(() => {
    if (!burning) return;
    const t = setTimeout(() => {
      setBurning(null);
      const next = itemsRef.current[0];
      if (next) play(next.id);
    }, shouldAnimate ? BURN_MS : 60);
    return () => clearTimeout(t);
  }, [burning, play, shouldAnimate]);
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(requestClose, END_MS);
    return () => clearTimeout(t);
  }, [ended, requestClose]);

  // How the card on the table leaves when it unmounts: still waiting → back
  // to the hand (benched, or another card was played); gone → it burns.
  // Read during render on purpose: the ref still holds the card that is
  // leaving in the render where it disappears.
  const prev = lastPlayed.current;
  const exitMode: ExitMode = burning || (prev && !items.some((i) => i.id === prev.id)) ? 'burn' : 'bench';

  useAppKeyboard(
    (e) => {
      if (leaving) return false;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') {
        if (typing && (el as HTMLInputElement).value) return false;
        e.preventDefault();
        requestClose();
        return true;
      }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (/^[1-9]$/.test(e.key)) {
        const card = handCards[Number(e.key) - 1];
        if (!card) return false;
        e.preventDefault();
        setSelectedId(card.id);
        return true;
      }
      if (e.key === 'Enter') {
        // A focused control inside the card owns its own Enter.
        const onControl = el && el !== document.body && !el.closest('[data-hand-card]');
        if (onControl) return false;
        const id = selectedId ?? (played ? null : handCards[0]?.id);
        if (!id) return false;
        e.preventDefault();
        play(id);
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  const round = resolved + 1;
  const total = resolved + items.length;
  const glow = played ? KIND_VAR[played.kind] : burning ? KIND_VAR[burning.kind] : GOLD;

  const { ref: cellRef, lift, cellTop } = useTableLift();

  return (
    <div ref={cellRef} className="absolute inset-0">
      {/* The board under the pieces: dims the app, never the chat. */}
      <motion.div
        className="fixed inset-0 -z-10 pointer-events-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: 0.25 }}
        onClick={requestClose}
        style={{
          background: `radial-gradient(ellipse 60% 55% at 50% 55%, color-mix(in srgb, ${glow} 16%, transparent), transparent 70%), color-mix(in srgb, var(--background) 72%, transparent)`,
          backdropFilter: 'blur(3px)',
        }}
        aria-hidden
      />

      {/* When the card needs more room than the middle cell has, it rises
          over her latest words; those are deliberately dimmed (still usable
          around the card). */}
      {lift > 0 && (
        <motion.div
          className="absolute inset-x-0 rounded-modal pointer-events-none"
          style={{
            top: -(cellTop - FRAME_TOP),
            height: cellTop - FRAME_TOP,
            background: 'color-mix(in srgb, var(--background) 55%, transparent)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={{ duration: 0.25 }}
          aria-hidden
        />
      )}

      {/* The table: where the played card lands. */}
      <div
        className="absolute inset-x-0 flex justify-center px-2 [perspective:1400px]"
        style={{ top: -lift, bottom: HAND_VISIBLE + 22 }}
      >
        <AnimatePresence mode="popLayout" custom={exitMode}>
          {played && (
            <PlayedCard
              key={played.id}
              item={played}
              round={round}
              total={total}
              leaving={leaving}
              shouldAnimate={shouldAnimate}
              onBackToHand={() => setTableId(null)}
              onSend={onSend}
            />
          )}
        </AnimatePresence>

        {!played && !burning && !ended && !dealing && handCards.length > 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: leaving ? 0 : 1 }}
            className="self-center rounded-card border px-4 py-2 typo-body text-foreground bg-background/85 shadow-elevation-2"
            style={{ borderColor: GOLD_SOFT }}
          >
            {C.pickHint}
          </motion.p>
        )}

        <AnimatePresence>
          {ended && !leaving && <TurnEnded empty={emptyAtOpen} shouldAnimate={shouldAnimate} />}
        </AnimatePresence>
      </div>

      <HandFan cards={handCards} selectedId={selectedId} dealing={dealing} leaving={leaving} onPlay={play} />
    </div>
  );
}

/** The card wants at least this much height; below it, it rises over the top piece. */
const CARD_MIN_H = 470;
/** The layer's top edge (VariantFrame: `top-[112px]`). */
const FRAME_TOP = 112;
/** How close to that edge the rising card may come. */
const LAYER_TOP = FRAME_TOP + 6;

/**
 * Measures the middle cell and says how far the table must reach above it
 * for the played card to get `CARD_MIN_H`, never past the layer's top.
 */
function useTableLift() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b.top === r.top && b.height === r.height ? b : { top: r.top, height: r.height }));
    };
    measure();
    // The cell resizes whenever the window or the top piece does.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const room = box.height - HAND_VISIBLE - 22;
  const lift = Math.max(0, Math.min(CARD_MIN_H - room, box.top - LAYER_TOP));
  return { ref, lift, cellTop: box.top };
}

/** The played card: rises out of the hand, flips face up, grows to size. */
function PlayedCard({
  item,
  round,
  total,
  leaving,
  shouldAnimate,
  onBackToHand,
  onSend,
}: {
  item: WorkItem;
  round: number;
  total: number;
  leaving: boolean;
  shouldAnimate: boolean;
  onBackToHand: () => void;
  onSend: (text: string) => void;
}) {
  const kind = KIND_VAR[item.kind];
  const offRight = typeof window === 'undefined' ? 900 : window.innerWidth * 0.62;
  return (
    <motion.div
      className="relative w-full max-w-[600px] h-full pointer-events-auto [transform-style:preserve-3d]"
      initial={shouldAnimate ? { y: 260, scale: 0.28, rotateY: 180, rotate: -6, opacity: 0.4 } : { opacity: 0 }}
      animate={
        leaving
          ? shouldAnimate
            ? { x: offRight, y: -120, rotate: 24, scale: 0.4, opacity: [1, 1, 0], rotateY: 180 }
            : { opacity: 0 }
          : { x: 0, y: 0, scale: 1, rotateY: 0, rotate: 0, opacity: 1 }
      }
      variants={{ gone: (mode: ExitMode) => (shouldAnimate ? EXIT[mode] : { opacity: 0 }) }}
      exit="gone"
      transition={
        !shouldAnimate
          ? { duration: 0.15 }
          : leaving
            ? { type: 'tween', duration: 0.45, ease: [0.5, 0, 0.75, 0] }
            : { type: 'spring', stiffness: 170, damping: 22, mass: 0.9 }
      }
    >
      {/* Face. */}
      <div className="absolute inset-0 [backface-visibility:hidden]">
        <CardFrame item={item} round={round} total={total} onBackToHand={onBackToHand} onSend={onSend} />
      </div>
      {/* Reverse, seen during the first half of the flip. */}
      <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
        <CardBackFace kindColor={kind} size="fill" />
      </div>
    </motion.div>
  );
}

function TurnEnded({ empty, shouldAnimate }: { empty: boolean; shouldAnimate: boolean }) {
  return (
    <motion.div
      role="status"
      className="absolute inset-x-0 top-1/3 flex justify-center pointer-events-none"
      initial={shouldAnimate ? { opacity: 0, scale: 0.8, y: 10 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={shouldAnimate ? { type: 'spring', stiffness: 260, damping: 18 } : { duration: 0.15 }}
    >
      <div
        className="px-10 py-4 text-center shadow-elevation-4"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 95% 50%, 100% 100%, 0 100%, 5% 50%)',
          background: `linear-gradient(180deg, color-mix(in srgb, ${GOLD} 30%, var(--secondary)), var(--background))`,
          boxShadow: `inset 0 0 0 1.5px ${GOLD}`,
        }}
      >
        <p className="typo-heading-lg text-foreground">{empty ? N.nothingWaiting : C.turnEnded}</p>
        <p className="typo-body text-foreground">{empty ? N.nothingWaitingSub : C.turnEndedSub}</p>
      </div>
    </motion.div>
  );
}
