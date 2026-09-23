/**
 * RoundStage — Halo · Rows' decision stage: the waiting items played as a
 * Gwent round.
 *
 * On open the cards are dealt from BOTH sides of the app (1st, 3rd, 5th… from
 * the left, 2nd, 4th… from the right) and settle face up and small in a
 * centred board row, while a "Round N of M" banner drops from the top. Then
 * the first card rises to full size above the row: a tall framed card whose
 * text area is the product's own `WorkItemBody` (its verbs, untouched).
 *
 * A card leaves when its item disappears (the operator acted on it) or when
 * the operator sets it aside: it flies back off to the side it came from, the
 * banner advances, and the next card rises. When no card remains the banner
 * reads "Round won" for a beat and the stage closes itself. Keys: Left/Right
 * walk the row, Enter raises, 1-9 jump, Esc (the layer's own key) sends every
 * card back to its side.
 *
 * Geometry: the stage is mounted in the frame's middle cell. It paints two
 * fixed layers inside the frame's stacking context. A dim backdrop at z-auto
 * sits BELOW the bottom input and the right panel (they come later in the DOM)
 * and deliberately dims the top message and the left rail. The board itself
 * (z-10) spans from the top of the centre column to the bottom of the middle
 * cell, so the raised card has the full height and the input stays usable.
 */

import { AnimatePresence, motion, type Transition, type Variants } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NEXT_COPY as C } from '../../../nextCopy';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import { WorkItemBody } from '../../../WorkItemBody';
import type { DecisionStageProps } from '../../slots';
import { CardFrame, CardPortrait, MiniCard, NamePlate } from './CardFrame';
import { ROWS_COPY as R } from './copy';

type Box = { left: number; top: number; width: number; height: number };
type Leave = 'fly' | 'lower';

const SPRING: Transition = { type: 'spring', stiffness: 240, damping: 26 };
const THROW: Transition = { duration: 0.5, ease: [0.5, 0, 0.75, 0] };
const DEAL_STAGGER = 0.08;

/** Always mounted in the middle cell; paints the round only while open. */
export function RoundStage(props: DecisionStageProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const box = useBoardBox(anchor);
  return (
    <>
      <div ref={anchor} className="absolute inset-0 pointer-events-none" aria-hidden />
      <AnimatePresence>{props.open && box && <Round key="round" {...props} box={box} />}</AnimatePresence>
    </>
  );
}

/** The board's box: centre column top to the middle cell's bottom, cell width. */
function useBoardBox(anchor: RefObject<HTMLDivElement | null>): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const cell = anchor.current?.parentElement;
    const column = cell?.parentElement;
    if (!cell || !column) return;
    const measure = () => {
      const c = cell.getBoundingClientRect();
      const col = column.getBoundingClientRect();
      setBox((prev) => {
        const next = { left: c.left, top: col.top, width: c.width, height: Math.max(0, c.bottom - col.top) };
        return prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
          ? prev
          : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cell);
    ro.observe(column);
    return () => ro.disconnect();
  }, [anchor]);
  return box;
}

/** The round's bookkeeping: who was dealt, who is still on the board, who is raised. */
function useRoundState({ items, focusId, onFocus, onClose }: DecisionStageProps, instant: boolean) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.id));
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  const [dealMs] = useState(() => (instant ? 0 : 450 + items.length * DEAL_STAGGER * 1000 + 250));
  const [dealt, setDealt] = useState(instant);
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const [leave, setLeave] = useState<Leave>('fly');
  const [cursor, setCursor] = useState(0);

  // New waiting items join the round as the next cards dealt.
  useEffect(() => {
    setOrder((prev) => {
      const add = items.filter((i) => !prev.includes(i.id)).map((i) => i.id);
      return add.length ? [...prev, ...add] : prev;
    });
  }, [items]);

  useEffect(() => {
    if (dealt) return;
    const t = setTimeout(() => setDealt(true), dealMs);
    return () => clearTimeout(t);
  }, [dealt, dealMs]);

  const live = useMemo(
    () =>
      order.flatMap((id) => {
        const it = byId.get(id);
        return it && !aside.has(id) ? [it] : [];
      }),
    [order, byId, aside],
  );
  const raised = live.find((c) => c.id === raisedId) ?? null;

  // The raised card left (acted on or set aside), or none rose yet: raise the next.
  useEffect(() => {
    if (!dealt || raised) return;
    const next = (focusId && live.find((c) => c.id === focusId)) || live[0];
    if (!next) {
      setRaisedId(null);
      return;
    }
    setLeave('fly');
    setRaisedId(next.id);
    setCursor(live.indexOf(next));
    if (next.id !== focusId) onFocus(next.id);
  }, [dealt, raised, live, focusId, onFocus]);

  // Focus moved from outside (a leader slot in the rows panel): raise that card.
  const prevFocus = useRef(focusId);
  useEffect(() => {
    if (focusId === prevFocus.current) return;
    prevFocus.current = focusId;
    const i = live.findIndex((c) => c.id === focusId);
    if (dealt && focusId && focusId !== raisedId && i >= 0) {
      setLeave('lower');
      setRaisedId(focusId);
      setCursor(i);
    }
  }, [focusId, dealt, raisedId, live]);

  // A lowered card is a one-off: anything leaving after it flies to its side.
  useEffect(() => {
    if (leave !== 'lower') return;
    const t = setTimeout(() => setLeave('fly'), 450);
    return () => clearTimeout(t);
  }, [leave]);

  const won = dealt && order.length > 0 && live.length === 0;
  useEffect(() => {
    if (!won) return;
    const t = setTimeout(onClose, instant ? 700 : 1500);
    return () => clearTimeout(t);
  }, [won, instant, onClose]);

  const raise = (id: string) => {
    const i = live.findIndex((c) => c.id === id);
    if (i < 0) return;
    setCursor(i);
    if (id === raisedId) return;
    setLeave('lower');
    setRaisedId(id);
    onFocus(id);
  };
  const setCardAside = (id: string) => {
    setLeave('fly');
    setAside((prev) => new Set(prev).add(id));
  };

  const total = order.length;
  const played = total - live.length;
  return {
    order,
    live,
    raised,
    dealt,
    leave,
    won,
    empty: total === 0,
    round: Math.min(total, played + 1),
    total,
    cursor: Math.min(cursor, Math.max(0, live.length - 1)),
    setCursor,
    raise,
    setCardAside,
    /** 1st, 3rd, 5th… dealt from the left (-1); 2nd, 4th… from the right (1). */
    sideOf: (id: string) => (order.indexOf(id) % 2 === 0 ? -1 : 1),
    numberOf: (id: string) => order.indexOf(id) + 1,
  };
}

function Round(props: DecisionStageProps & { box: Box }) {
  const { box, onClose, onSend } = props;
  const { shouldAnimate } = useMotion();
  const r = useRoundState(props, !shouldAnimate);

  useAppKeyboard(
    (e) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!r.live.length) return false;
        const step = e.key === 'ArrowRight' ? 1 : -1;
        r.setCursor((c) => Math.max(0, Math.min(r.live.length - 1, c + step)));
      } else if (e.key === 'Enter') {
        // Enter on a control inside the raised card belongs to that control.
        if (el && el !== document.body && el.closest('button, a, [role="button"]') && !el.closest('[data-board-row]')) return false;
        const card = r.live[r.cursor];
        if (!card) return false;
        r.raise(card.id);
      } else if (/^[1-9]$/.test(e.key)) {
        const card = r.live[Number(e.key) - 1];
        if (!card) return false;
        r.raise(card.id);
      } else return false;
      e.preventDefault();
      return true;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  return (
    <div className="contents">
      <motion.div
        {...fade}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 pointer-events-auto"
        style={{
          background:
            'radial-gradient(ellipse at 50% 58%, color-mix(in srgb, var(--background) 52%, transparent), color-mix(in srgb, var(--background) 88%, transparent) 75%)',
          backdropFilter: 'blur(3px)',
        }}
        aria-hidden
      />
      <section
        aria-label={R.boardLabel}
        className="fixed z-10 pointer-events-none flex flex-col items-center gap-3 pt-1 pb-1"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      >
        <RoundBanner round={r.round} total={r.total} won={r.won} empty={r.empty} animate={shouldAnimate} />
        <div className="relative flex-1 min-h-0 w-full flex items-center justify-center">
          {/* propagate only while something is in it: an empty propagating
              presence never calls back, and the board would never unmount. */}
          <AnimatePresence mode="wait" custom={r.leave} propagate={!!r.raised}>
            {r.raised && (
              <RaisedCard
                key={r.raised.id}
                item={r.raised}
                n={r.numberOf(r.raised.id)}
                side={r.sideOf(r.raised.id)}
                animate={shouldAnimate}
                onSend={onSend}
                onSetAside={() => r.setCardAside(r.raised!.id)}
              />
            )}
          </AnimatePresence>
          {r.won && <WonBurst animate={shouldAnimate} />}
          {r.empty && <EmptyPlaque onClose={onClose} />}
        </div>
        <BoardRow
          cards={r.live}
          raisedId={r.raised?.id ?? null}
          cursor={r.cursor}
          dealt={r.dealt}
          animate={shouldAnimate}
          sideOf={r.sideOf}
          numberOf={r.numberOf}
          onRaise={r.raise}
        />
      </section>
    </div>
  );
}

export function RoundBanner({
  round,
  total,
  won,
  empty,
  animate,
}: {
  round: number;
  total: number;
  won: boolean;
  empty: boolean;
  animate: boolean;
}) {
  if (empty) return null;
  const label = won ? R.roundWon : R.round(round, total);
  return (
    <motion.div
      initial={animate ? { y: -90, opacity: 0 } : { opacity: 0 }}
      animate={{ y: 0, opacity: 1, scale: won && animate ? 1.08 : 1 }}
      exit={animate ? { y: -90, opacity: 0 } : { opacity: 0 }}
      transition={SPRING}
      className="shrink-0 relative px-10 py-1.5 shadow-elevation-3"
      style={{
        clipPath: 'polygon(0 0, 100% 0, 94% 50%, 100% 100%, 0 100%, 6% 50%)',
        background: won
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--status-success) 55%, var(--secondary)), color-mix(in srgb, var(--status-success) 20%, var(--background)))'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--primary) 40%, var(--secondary)), color-mix(in srgb, var(--primary) 14%, var(--background)))',
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={label}
          initial={animate ? { y: 14, opacity: 0 } : { opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={animate ? { y: -14, opacity: 0 } : { opacity: 0 }}
          transition={{ duration: 0.22 }}
          role="status"
          className="typo-section-title uppercase tracking-wider text-foreground text-center whitespace-nowrap"
        >
          {label}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
}

/** The raised card: rises out of the row, flies back to its side when played. */
export function RaisedCard({
  item,
  n,
  side,
  animate,
  onSend,
  onSetAside,
}: {
  item: WorkItem;
  n: number;
  side: number;
  animate: boolean;
  onSend: (text: string) => void;
  onSetAside: () => void;
}) {
  const color = KIND_VAR[item.kind];
  const variants: Variants = animate
    ? {
        hidden: { opacity: 0, y: 220, scale: 0.3 },
        shown: { opacity: 1, y: 0, x: 0, scale: 1, rotate: 0, transition: SPRING },
        exit: (leave: Leave) =>
          leave === 'lower'
            ? { opacity: 0, y: 220, scale: 0.3, transition: { duration: 0.25 } }
            : { opacity: 0, x: side * 1100, y: -40, rotate: side * 22, transition: THROW },
      }
    : { hidden: { opacity: 0 }, shown: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.15 } } };
  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="shown"
      exit="exit"
      className="pointer-events-auto h-full max-h-[640px] w-full max-w-[460px] px-2"
    >
      <CardFrame color={color} className="h-full">
        <div className="h-full flex flex-col">
          <CardPortrait item={item} n={n} />
          <NamePlate item={item} />
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 pt-3 pb-2">
            <WorkItemBody item={item} onSend={onSend} />
          </div>
          <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-foreground/10">
            <Tooltip content={R.setAsideHint} placement="top">
              <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={onSetAside}>
                {R.setAside}
              </Button>
            </Tooltip>
            <Tooltip content={R.keys} placement="top">
              <span className="ml-auto typo-caption text-foreground/85 whitespace-nowrap">{R.keysShort}</span>
            </Tooltip>
          </div>
        </div>
        {animate && <RiseSheen color={color} />}
      </CardFrame>
    </motion.div>
  );
}

/** One sweep of light across the card as it lands. Plays once, never loops. */
function RiseSheen({ color }: { color: string }) {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2"
      initial={{ x: '0%', opacity: 0 }}
      animate={{ x: '320%', opacity: [0, 0.55, 0] }}
      transition={{ duration: 1.1, delay: 0.35, ease: 'easeInOut' }}
      style={{
        background: `linear-gradient(100deg, transparent, color-mix(in srgb, ${color} 30%, var(--foreground) 12%), transparent)`,
      }}
    />
  );
}

/** The centred board row: every card still in play, face up and small. */
export function BoardRow({
  cards,
  raisedId,
  cursor,
  dealt,
  animate,
  sideOf,
  numberOf,
  onRaise,
}: {
  cards: WorkItem[];
  raisedId: string | null;
  cursor: number;
  dealt: boolean;
  animate: boolean;
  sideOf: (id: string) => number;
  numberOf: (id: string) => number;
  onRaise: (id: string) => void;
}) {
  const vw = typeof window === 'undefined' ? 1400 : window.innerWidth;
  return (
    <div
      data-board-row
      className={`shrink-0 pointer-events-auto min-h-[92px] min-w-[120px] flex items-end justify-center gap-2 rounded-card border px-4 pt-3 pb-2 transition-colors duration-500 ${
        cards.length ? 'border-foreground/10 bg-background/70 shadow-elevation-3' : 'border-transparent'
      }`}
    >
      <AnimatePresence propagate={cards.length > 0}>
        {cards.map((card, i) => {
          const side = sideOf(card.id);
          const selected = i === cursor;
          const isRaised = card.id === raisedId;
          return (
            <motion.button
              key={card.id}
              type="button"
              onClick={() => onRaise(card.id)}
              aria-label={R.raise(card.title)}
              aria-current={isRaised || undefined}
              layout={animate ? 'position' : false}
              initial={animate ? { x: side * vw * 0.7, y: -140, rotate: side * -30, opacity: 0 } : { opacity: 0 }}
              animate={{
                x: 0,
                y: selected && !isRaised ? -8 : 0,
                rotate: 0,
                opacity: 1,
                transition: { ...SPRING, delay: dealt ? 0 : numberOf(card.id) * DEAL_STAGGER },
              }}
              exit={animate ? { x: side * vw * 0.7, y: -60, rotate: side * 25, opacity: 0, transition: THROW } : { opacity: 0 }}
              className={`relative rounded-interactive focus-ring ${selected ? 'ring-2 ring-primary/70 ring-offset-2 ring-offset-background' : ''}`}
            >
              <Tooltip content={`${C.kind[card.kind]}: ${card.title}`} placement="top">
                <span className="block">
                  <MiniCard item={card} n={numberOf(card.id)} dim={isRaised} />
                </span>
              </Tooltip>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** "Round won": a single ring of light behind the banner's last word. */
function WonBurst({ animate }: { animate: boolean }) {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute w-[420px] h-[420px] rounded-full"
      initial={{ scale: animate ? 0.3 : 1, opacity: 0.9 }}
      animate={{ scale: animate ? 1.6 : 1, opacity: 0 }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
      style={{
        background:
          'radial-gradient(circle, color-mix(in srgb, var(--status-success) 45%, transparent), transparent 65%)',
      }}
    />
  );
}

function EmptyPlaque({ onClose }: { onClose: () => void }) {
  return (
    <div className="pointer-events-auto rounded-card border border-foreground/10 bg-background/90 shadow-elevation-3 px-8 py-6 text-center">
      <p className="typo-section-title text-foreground">{R.emptyBoard}</p>
      <p className="typo-body text-foreground mt-1">{R.emptyBoardSub}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onClose}>
        {R.retreat}
      </Button>
    </div>
  );
}
