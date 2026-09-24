/**
 * Halo · Spread — the decision stage as a card spread.
 *
 * On open the waiting cards fly in from the binder (each from its own
 * project's tile) and form a deck at the lower right. The top card lifts,
 * flips face up and travels to the centre, where it presents large in an
 * ornate collectible frame around the card-native Oracle body (see
 * `bodies/CardBody.tsx`). No hover tilt, no hover movement
 * (owner, 2026-09-24): only the deal, the draw, the flip and the discard move.
 * When the operator
 * acts (the item leaves `items`) or sets it aside, the card flips face down
 * and flies to the discard pile at the lower left, and the next card is drawn.
 * With the deck empty the pile sweeps away and the stage closes.
 *
 * Keys: Left / Right walk the queue as a ring (the current card goes back
 * into the deck), Space sets the current card aside (the one skip), Esc (or
 * Alt+W) returns the spread to the binder. On a card with a native body,
 * 1-9 / 0 / Enter / Up / Down belong to the card (pick, ask Athena, confirm,
 * move between options); elsewhere Enter draws the next card and 1-9 draw
 * that card from the deck. Hover: a linear brightness glow (`HOVER_GLOW`).
 * Reduced motion: every flight becomes a fade.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { KIND_VAR } from '../../../tones';
import type { WorkItem, WorkItemKind } from '../../../useWorkforce';
import { ATHENA_COLUMN } from '../../../useProcessColumns';
import type { DecisionStageProps } from '../../slots';
import { BINDER_ATTR, TILE_ATTR } from './BinderPanel';
import { CardBack, CardFace } from './CardFrame';
import { HOVER_GLOW, mix } from './cardArt';
import { centreShift } from '../../screenCentre';
import { SPREAD_COPY as S } from './copy';

const DECK_W = 76;
const DECK_H = 106;
const PAD = 10;
const CARD_W = 600;
const CARD_MIN_W = 420;
const DECK_SHOWN = 7;
const EASE = [0.22, 1, 0.36, 1] as const;

type Phase = 'deal' | 'play' | 'empty' | 'end' | 'return';
type ExitTo = 'discard' | 'deck';
interface Played {
  id: string;
  kind: WorkItemKind;
}
interface Pt {
  x: number;
  y: number;
}

export type SpreadStageProps = DecisionStageProps;

/** The stage: nothing when closed, the spread when open. */
export function SpreadStage(props: SpreadStageProps) {
  return props.open ? <Spread {...props} /> : null;
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function useStageGeometry() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, lift: 0, mid: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // How far the stage may grow upward over her latest words (the top piece).
      const layer = el.closest('[data-testid="companion-panel"]');
      const r = el.getBoundingClientRect();
      const lr = layer?.getBoundingClientRect();
      const lift = lr ? Math.max(0, r.top - lr.top) : 0;
      // The screen's middle in stage coordinates, so the card centres on it.
      const mid = lr ? lr.left + lr.width / 2 - r.left : el.clientWidth / 2;
      setSize({ w: el.clientWidth, h: el.clientHeight, lift, mid });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** A point in stage coordinates for a card's home tile (or the binder). */
  const originOf = useCallback((project: string | null): Pt => {
    const root = ref.current?.getBoundingClientRect();
    if (!root) return { x: 0, y: 0 };
    const key = project ?? ATHENA_COLUMN;
    const tile =
      document.querySelector(`[${TILE_ATTR}="${CSS.escape(key)}"]`) ?? document.querySelector(`[${BINDER_ATTR}]`);
    const b = tile?.getBoundingClientRect();
    if (!b) return { x: root.width + 120, y: 40 };
    return { x: b.left + b.width / 2 - root.left, y: b.top + 20 - root.top };
  }, []);
  return { ref, size, originOf };
}

function Spread({ items, focusId, onFocus, onClose, onSend }: SpreadStageProps) {
  const { shouldAnimate } = useMotion();
  const { ref, size, originOf } = useStageGeometry();

  const [phase, setPhase] = useState<Phase>('deal');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [played, setPlayed] = useState<Played[]>([]);
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  // The queue as a ring, the active card first once one is drawn.
  const [order, setOrder] = useState<string[]>([]);
  const [exitTo, setExitTo] = useState<ExitTo>('discard');
  const [arrivals, setArrivals] = useState(0);

  const live = useMemo(() => items.filter((i) => !aside.has(i.id)), [items, aside]);
  const active = live.find((i) => i.id === activeId) ?? null;
  const lastActive = useRef<WorkItem | null>(null);
  if (active) lastActive.current = active;

  const ring = useMemo(() => {
    const byId = new Map(live.map((i) => [i.id, i] as const));
    const ordered = order.map((id) => byId.get(id)).filter((i): i is WorkItem => !!i);
    const known = new Set(order);
    return [...ordered, ...live.filter((i) => !known.has(i.id))];
  }, [live, order]);
  const deck = useMemo(() => ring.filter((i) => i.id !== activeId), [ring, activeId]);

  // Geometry (stage coordinates).
  const { w, h } = size;
  // A short stage lets the card grow over the (dimmed) top piece so the real
  // card keeps a readable text panel; a tall one stays in its own cell.
  const lift = h < 560 ? size.lift : 0;
  const deckPt: Pt = { x: w - DECK_W / 2 - PAD, y: h - DECK_H / 2 - PAD };
  const discardPt: Pt = { x: DECK_W / 2 + PAD, y: h - DECK_H / 2 - PAD };
  // The card keeps its full width until the stage itself runs out of room;
  // on a narrow stage it covers the inner edge of the deck and the pile
  // rather than shrinking to clear them.
  const cardW = Math.max(CARD_MIN_W, Math.min(CARD_W, w - 2 * PAD));
  const cardH = Math.max(300, h + lift - 4);
  const cardPt: Pt = { x: w / 2 + centreShift(size.mid, { left: 0, width: w }, cardW), y: (h - lift) / 2 };
  const compact = cardH < 600;

  // Refs so key and timer handlers read the current state.
  const state = useRef({ phase, activeId, deck, live, ring });
  state.current = { phase, activeId, deck, live, ring };

  const draw = useCallback(
    (id: string) => {
      const { activeId: cur, ring: r } = state.current;
      if (cur === id) return;
      if (cur) setExitTo('deck');
      // Rotate the ring so the drawn card leads; Right then Left comes back.
      const at = r.findIndex((i) => i.id === id);
      if (at >= 0) setOrder([...r.slice(at), ...r.slice(0, at)].map((i) => i.id));
      setActiveId(id);
      setArrivals((n) => n + 1);
      onFocus(id);
    },
    [onFocus],
  );

  const drawNext = useCallback(() => {
    const next = state.current.deck[0];
    if (next) draw(next.id);
  }, [draw]);

  const drawPrev = useCallback(() => {
    const d = state.current.deck;
    const prev = d[d.length - 1];
    if (prev) draw(prev.id);
  }, [draw]);

  const startReturn = useCallback(() => {
    if (state.current.phase === 'return') return;
    setExitTo('deck');
    setActiveId(null);
    setPhase('return');
  }, []);

  // The deal: the deck flies in, then the first card is drawn.
  const dealMs = shouldAnimate ? Math.min(items.length, DECK_SHOWN) * 70 + 520 : 60;
  useEffect(() => {
    const t = setTimeout(() => {
      const { live: l } = state.current;
      if (!l.length) {
        setPhase('empty');
        return;
      }
      setPhase('play');
      const first = l.find((i) => i.id === focusId) ?? l[0]!;
      draw(first.id);
    }, dealMs);
    return () => clearTimeout(t);
    // Runs once per open; focusId at open time picks the first card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A card is chosen from outside (a tile in the binder): draw it.
  useEffect(() => {
    const s = state.current;
    if (s.phase !== 'play' || !focusId || focusId === s.activeId) return;
    if (s.live.some((i) => i.id === focusId)) draw(focusId);
  }, [focusId, draw]);

  // Resolution: the active card's item is gone (acted on) or was set aside.
  useEffect(() => {
    if (!activeId || active) return;
    const gone = lastActive.current;
    setExitTo('discard');
    if (gone) setPlayed((p) => [...p, { id: gone.id, kind: gone.kind }]);
    setActiveId(null);
  }, [activeId, active]);

  // Next round, or the end of the spread.
  useEffect(() => {
    if (phase === 'empty' && live.length) {
      setPhase('play');
      return;
    }
    if (phase !== 'play' || activeId) return;
    const t = setTimeout(
      () => {
        const next = state.current.deck[0];
        if (next) draw(next.id);
        else setPhase('end');
      },
      shouldAnimate ? 520 : 40,
    );
    return () => clearTimeout(t);
  }, [phase, activeId, live.length, draw, shouldAnimate]);

  // End flourish and return both close the stage once their motion is done.
  useEffect(() => {
    if (phase !== 'end' && phase !== 'return') return;
    const t = setTimeout(onClose, shouldAnimate ? (phase === 'end' ? 1150 : 760) : 60);
    return () => clearTimeout(t);
  }, [phase, onClose, shouldAnimate]);

  useAppKeyboard(
    (e) => {
      const el = document.activeElement;
      if (e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        startReturn();
        return true;
      }
      if (e.key === 'Escape') {
        if (el && isTyping(el) && (el as HTMLInputElement).value) return false;
        e.preventDefault();
        startReturn();
        return true;
      }
      if (isTyping(el) || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === ' ') {
        // The one skip: set the current card aside, whatever holds focus.
        if (!state.current.activeId) return false;
        e.preventDefault();
        setActiveAside();
        return true;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!state.current.deck.length) return false;
        e.preventDefault();
        if (e.key === 'ArrowRight') drawNext();
        else drawPrev();
        return true;
      }
      if (e.key === 'Enter') {
        // Enter on a real control inside the card belongs to that control.
        if (el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'A') && !el.closest('[data-spread-deck]')) return false;
        e.preventDefault();
        drawNext();
        return true;
      }
      if (/^[1-9]$/.test(e.key)) {
        const pick = state.current.deck[Number(e.key) - 1];
        if (!pick) return false;
        e.preventDefault();
        draw(pick.id);
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  function setActiveAside() {
    const id = state.current.activeId;
    if (!id) return;
    setAside((s) => new Set(s).add(id));
  }

  const index = played.length;
  const total = played.length + live.length;
  const ready = w > 0 && h > 0;

  return (
    <>
      <motion.div
        className="fixed inset-0 -z-10 pointer-events-none bg-background/55 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === 'end' || phase === 'return' ? 0 : 1 }}
        transition={{ duration: 0.35 }}
        aria-hidden
      />
      <div ref={ref} className="absolute inset-0 pointer-events-none" role="region" aria-label={S.label}>
        {ready && (
          <>
            {lift > 0 && (
              <motion.div
                className="absolute inset-x-0 bg-background/70 pointer-events-none"
                style={{ top: -lift, height: lift }}
                initial={{ opacity: 0 }}
                animate={{ opacity: active && phase === 'play' ? 1 : 0 }}
                transition={{ duration: 0.3 }}
                aria-hidden
              />
            )}
            <Deck
              deck={deck}
              at={deckPt}
              phase={phase}
              originOf={originOf}
              animate={shouldAnimate}
              onDraw={drawNext}
            />
            <DiscardPile played={played} at={discardPt} phase={phase} width={w} animate={shouldAnimate} />

            <AnimatePresence custom={exitTo}>
              {active && phase !== 'return' && (
                <ActiveCard
                  key={active.id}
                  item={active}
                  waiting={deck.length}
                  index={index}
                  total={total}
                  w={cardW}
                  h={cardH}
                  at={cardPt}
                  deckPt={deckPt}
                  discardPt={discardPt}
                  compact={compact}
                  animate={shouldAnimate}
                  arrival={arrivals}
                  onSend={onSend}
                  onSetAside={setActiveAside}
                />
              )}
            </AnimatePresence>

            {phase === 'empty' && <EmptyPlate at={cardPt} onClose={startReturn} />}
            <AnimatePresence>{phase === 'end' && <EndFlourish at={cardPt} count={played.length} animate={shouldAnimate} />}</AnimatePresence>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Deck({
  deck,
  at,
  phase,
  originOf,
  animate,
  onDraw,
}: {
  deck: WorkItem[];
  at: Pt;
  phase: Phase;
  originOf: (project: string | null) => Pt;
  animate: boolean;
  onDraw: () => void;
}) {
  const shown = deck.slice(0, DECK_SHOWN);
  const leaving = phase === 'return' || phase === 'end';
  return (
    <div
      className="absolute pointer-events-auto transition-[filter] duration-200 ease-linear hover:brightness-125 has-[:focus-visible]:brightness-125"
      style={{ left: at.x - DECK_W / 2, top: at.y - DECK_H / 2, width: DECK_W, height: DECK_H }}
      data-spread-deck=""
    >
      {shown
        .map((it, i) => {
          const o = originOf(it.project);
          const from = { x: o.x - at.x, y: o.y - at.y };
          const rest = { x: -i * 1.5, y: -i * 2.5, rotate: i % 2 ? -2.5 : 2, scale: 1, opacity: 1 };
          const target: TargetAndTransition = leaving
            ? animate
              ? { x: from.x, y: from.y, rotate: 16, scale: 0.5, opacity: 0, transition: { duration: 0.5, delay: i * 0.04, ease: EASE } }
              : { opacity: 0, transition: { duration: 0.15 } }
            : rest;
          return (
            <motion.div
              key={it.id}
              className="absolute inset-0"
              style={{ zIndex: DECK_SHOWN - i }}
              initial={animate ? { x: from.x, y: from.y, rotate: 24, scale: 0.45, opacity: 0 } : { opacity: 0 }}
              animate={target}
              transition={{ duration: 0.55, delay: phase === 'deal' ? i * 0.07 : 0, ease: EASE }}
              aria-hidden
            >
              <CardBack color={KIND_VAR[it.kind]} compact />
            </motion.div>
          );
        })
        .reverse()}
      {deck.length > 0 && !leaving && (
        <button
          type="button"
          onClick={onDraw}
          aria-label={S.drawNext}
          className="absolute inset-0 z-20 rounded-card focus-ring"
        />
      )}
      {deck.length > 0 && !leaving && (
      <div className="absolute left-1/2 -translate-x-1/2 -top-9 flex flex-col items-center gap-0.5 whitespace-nowrap">
        <motion.span
          key={deck.length}
          initial={animate ? { scale: 1.35 } : false}
          animate={{ scale: 1 }}
          className="grid place-items-center min-w-7 h-7 px-1.5 rounded-full border border-primary/50 bg-background typo-data text-foreground shadow-elevation-2"
          aria-label={S.deck(deck.length)}
        >
          {deck.length}
        </motion.span>
      </div>
      )}
    </div>
  );
}

function DiscardPile({ played, at, phase, width, animate }: { played: Played[]; at: Pt; phase: Phase; width: number; animate: boolean }) {
  const shown = played.slice(-5);
  const sweep = phase === 'end' || phase === 'return';
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: at.x - DECK_W / 2, top: at.y - DECK_H / 2, width: DECK_W, height: DECK_H }}
      animate={
        sweep
          ? animate
            ? { x: -(at.x + width * 0.25), rotate: -24, opacity: 0, transition: { duration: 0.6, delay: 0.25, ease: EASE } }
            : { opacity: 0 }
          : { x: 0, rotate: 0, opacity: 1 }
      }
      aria-label={S.discard(played.length)}
    >
      {played.length === 0 && (
        <div className="absolute inset-0 rounded-card border border-dashed" style={{ borderColor: mix('var(--foreground)', 22) }} aria-hidden />
      )}
      {shown.map((p, i) => (
        <motion.div
          key={p.id}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, rotate: ((i * 37) % 13) - 6, x: ((i * 23) % 7) - 3 }}
          transition={{ delay: animate ? 0.42 : 0, duration: 0.12 }}
          aria-hidden
        >
          <CardBack color={KIND_VAR[p.kind]} compact />
        </motion.div>
      ))}
      {played.length > 0 && (
        <span className="absolute left-1/2 -translate-x-1/2 -top-9 grid place-items-center min-w-7 h-7 px-1.5 rounded-full border border-foreground/20 bg-background typo-data text-foreground shadow-elevation-2">
          {played.length}
        </span>
      )}
    </motion.div>
  );
}

function ActiveCard({
  item,
  waiting,
  index,
  total,
  w,
  h,
  at,
  deckPt,
  discardPt,
  compact,
  animate,
  arrival,
  onSend,
  onSetAside,
}: {
  item: WorkItem;
  waiting: number;
  index: number;
  total: number;
  w: number;
  h: number;
  at: Pt;
  deckPt: Pt;
  discardPt: Pt;
  compact: boolean;
  animate: boolean;
  arrival: number;
  onSend: (text: string) => void;
  onSetAside: () => void;
}) {
  const [landed, setLanded] = useState(!animate);
  const small = DECK_W / w;
  const fromDeck = { x: deckPt.x - at.x, y: deckPt.y - at.y, scale: small, rotate: 10, rotateY: 180 };
  const variants = animate
    ? {
        initial: { ...fromDeck, opacity: 1 },
        shown: { x: 0, y: 0, scale: 1, rotate: 0, rotateY: 0, opacity: 1, transition: { duration: 0.75, ease: EASE } },
        exit: (to: ExitTo) => {
          const p = to === 'deck' ? deckPt : discardPt;
          return {
            x: p.x - at.x,
            y: p.y - at.y,
            scale: small,
            rotate: to === 'deck' ? 8 : -8,
            rotateY: 180,
            opacity: [1, 1, 0],
            transition: { duration: 0.55, ease: EASE, opacity: { times: [0, 0.85, 1], duration: 0.55 } },
          };
        },
      }
    : {
        initial: { opacity: 0 },
        shown: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.15 } },
      };

  return (
    <motion.div
      className="absolute pointer-events-auto"
      style={{ left: at.x - w / 2, top: at.y - h / 2, width: w, height: h, transformStyle: 'preserve-3d', transformPerspective: 1600, zIndex: 30 }}
      variants={variants}
      initial="initial"
      animate="shown"
      exit="exit"
      onAnimationComplete={(def) => def === 'shown' && setLanded(true)}
      role="group"
      aria-label={S.cardOf(index + 1, total)}
    >
      <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
        <CardFace
          key={arrival}
          item={item}
          waiting={waiting}
          compact={compact}
          sheen={animate && landed}
          onSend={onSend}
          onSetAside={onSetAside}
        />
      </div>
      <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }} aria-hidden>
        <CardBack color={KIND_VAR[item.kind]} />
      </div>
    </motion.div>
  );
}

function EmptyPlate({ at, onClose }: { at: Pt; onClose: () => void }) {
  return (
    <motion.div
      className="absolute pointer-events-auto w-[360px] rounded-modal border border-primary/25 bg-background p-6 text-center shadow-elevation-3"
      style={{ left: at.x - 180, top: at.y - 90 }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <p className="typo-section-title text-foreground">{S.emptyTitle}</p>
      <p className="typo-body text-foreground mt-1">{S.emptySub}</p>
      <button
        type="button"
        onClick={onClose}
        className={`mt-4 rounded-interactive border border-foreground/15 px-3 py-1.5 typo-body text-foreground focus-ring ${HOVER_GLOW}`}
      >
        {S.close}
      </button>
    </motion.div>
  );
}

function EndFlourish({ at, count, animate }: { at: Pt; count: number; animate: boolean }) {
  return (
    <motion.div
      className="absolute pointer-events-none flex flex-col items-center gap-2"
      style={{ left: at.x, top: at.y, x: '-50%', y: '-50%' }}
      initial={animate ? { opacity: 0, scale: 0.8 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.35, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <span
        className="px-6 py-2 rounded-modal border typo-heading-lg text-foreground bg-background shadow-elevation-4"
        style={{ borderColor: mix('var(--primary)', 60), boxShadow: `0 0 40px -10px var(--primary)` }}
      >
        {S.roundCleared}
      </span>
      <span className="typo-body text-foreground">{S.discard(count)}</span>
    </motion.div>
  );
}
