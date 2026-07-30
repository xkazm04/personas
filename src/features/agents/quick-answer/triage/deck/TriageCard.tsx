// TriageCard — the physical object. Everything here is about making one
// decision feel like a hand movement rather than a form submission.
//
// Ported verbatim from the app's existing swipe deck (SwipeCard /
// BacklogFocusDeck) and then pushed further; the numbers are constants below so
// a future variant can't quietly soften them. Three things are deliberate:
//
//  • The verdict fires VERDICT_DELAY_MS *after* the fling starts. The row must
//    still be in the array while the card is in the air, or the decision looks
//    like a teleport instead of a throw.
//  • Depth (`scale`/`y`) is a MOTION PROP on an outer wrapper, never a
//    `transform: translateY()` string. Framer composes its own transform and
//    silently swallows the string — the reference implementation has that bug.
//  • Drag lives on an INNER layer. Separating depth from drag is what lets the
//    two animate independently without fighting over one transform.
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { animate, motion, useMotionTemplate, useMotionValue, useTransform } from 'framer-motion';

import type { TriageItem } from '../triageTypes';
import { MetricBadgeRow } from './MetricBadgeRow';
import { TriageCardBody } from './TriageCardBody';

/** Horizontal travel (px) at which a released drag commits to a verdict. */
export const COMMIT_THRESHOLD = 150;
/** How far a committed card flies. Well past any viewport edge. */
const FLING_DISTANCE = 1000;
/** Skip drops the card out of the bottom instead — a deferral is not a verdict. */
const DROP_DISTANCE = 260;
/** The verdict fires this long after launch, so the flight is actually seen. */
const VERDICT_DELAY_MS = 200;
const FLING_SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const;

export type FlingDirection = 'left' | 'right' | 'down';

export interface TriageCardHandle {
  /** Throw the card, then commit once the flight has been seen. */
  launch: (dir: FlingDirection) => void;
}

interface TriageCardProps {
  item: TriageItem;
  /** 0 = the card being decided; deeper cards shrink, drop back and dim. */
  index: number;
  /**
   * False for items that collect an answer. A card you can accidentally fling
   * away while typing in it is a bug, not a gesture.
   */
  draggable: boolean;
  reduced: boolean;
  /**
   * How many times this item has been thrown and re-dealt (its skip count).
   *
   * Load-bearing, not decoration: `launchedRef` latches on throw, and the reset
   * below is the only thing that unlatches it. When the LAST card in the deck
   * is skipped it is immediately the top card again with the same id and the
   * same rank — nothing in the old dep list changed, the latch stayed shut, and
   * every later verdict was swallowed with the deck's input dead until it was
   * closed and reopened. The cycle number is what changes.
   */
  cycle?: number;
  cardRef?: Ref<TriageCardHandle>;
  onCommit: (dir: FlingDirection) => void;
  /** Replaces the prose body for items with an `input`. */
  answerSlot?: ReactNode;
}

function TriageCardImpl({
  item,
  index,
  draggable,
  reduced,
  cycle = 0,
  cardRef,
  onCommit,
  answerSlot,
}: TriageCardProps) {
  const isTop = index === 0;

  const x = useMotionValue(0);
  const dropY = useMotionValue(0);
  const cardOpacity = useMotionValue(1);

  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);
  const acceptStamp = useTransform(x, [0, COMMIT_THRESHOLD], [0, 1]);
  const rejectStamp = useTransform(x, [-COMMIT_THRESHOLD, 0], [1, 0]);

  // Continuous border tint. Motion values interpolate numbers, not CSS vars, so
  // the channels are the app's own status raws (--status-error-raw #f87171,
  // --muted-dark #6e7e92 at rest, --status-success-raw #34d399) rather than an
  // invented red/green. Note the alpha DIP at ±50: the border fades as the card
  // leaves rest, then swells as it approaches the commit threshold, so the
  // brightness itself reads as "you are about to decide".
  const borderR = useTransform(x, [-200, 0, 200], [248, 110, 52]);
  const borderG = useTransform(x, [-200, 0, 200], [113, 126, 211]);
  const borderB = useTransform(x, [-200, 0, 200], [113, 146, 153]);
  const borderA = useTransform(x, [-200, -50, 0, 50, 200], [0.4, 0.2, 0.25, 0.2, 0.4]);
  const borderColor = useMotionTemplate`rgba(${borderR}, ${borderG}, ${borderB}, ${borderA})`;

  // Directional wash — the verdict arrives from the edge it is being thrown at.
  const acceptWash = useTransform(x, [0, 50, 200], [0, 0, 0.05]);
  const rejectWash = useTransform(x, [-200, -50, 0], [0.05, 0, 0]);

  const launchedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const launch = useCallback(
    (dir: FlingDirection) => {
      if (launchedRef.current) return;
      launchedRef.current = true;
      if (reduced) {
        onCommit(dir);
        return;
      }
      if (dir === 'down') animate(dropY, DROP_DISTANCE, FLING_SPRING);
      else animate(x, dir === 'right' ? FLING_DISTANCE : -FLING_DISTANCE, FLING_SPRING);
      animate(cardOpacity, 0, { duration: 0.2 });
      timerRef.current = window.setTimeout(() => onCommit(dir), VERDICT_DELAY_MS);
    },
    [reduced, onCommit, x, dropY, cardOpacity],
  );

  useImperativeHandle(cardRef, () => ({ launch }), [launch]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // A skipped item sorts to the BACK of the queue rather than leaving it, so
  // this component instance can be reused at a deeper stack position. Reset the
  // thrown state whenever the card's identity, rank OR cycle changes, or the
  // skipped card reappears still invisible, 260px low, and unable to be thrown
  // again (see `cycle` above — the last-card case changes only the cycle).
  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    launchedRef.current = false;
    x.set(0);
    dropY.set(0);
    cardOpacity.set(1);
  }, [item.id, isTop, cycle, x, dropY, cardOpacity]);

  const depthScale = 1 - index * 0.05;
  const depthY = index * 10;

  return (
    <motion.div
      className="absolute inset-0"
      style={{ zIndex: 10 - index }}
      initial={reduced ? false : { scale: depthScale, y: depthY + 22, opacity: 0 }}
      animate={{ scale: depthScale, y: depthY, opacity: 1 - index * 0.2 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <motion.div
        style={{ x, y: dropY, rotate, opacity: cardOpacity }}
        drag={draggable && isTop ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={(_, info) => {
          if (info.offset.x > COMMIT_THRESHOLD) launch('right');
          else if (info.offset.x < -COMMIT_THRESHOLD) launch('left');
        }}
        className={`relative h-full w-full ${
          !isTop ? 'pointer-events-none' : draggable ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <motion.div
          style={{ borderColor }}
          className="absolute inset-0 overflow-hidden rounded-card border-2 bg-background shadow-elevation-4"
        >
          <motion.div
            style={{ opacity: acceptWash }}
            className="pointer-events-none absolute inset-0 bg-gradient-to-l from-status-success to-transparent"
            aria-hidden
          />
          <motion.div
            style={{ opacity: rejectWash }}
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-status-error to-transparent"
            aria-hidden
          />

          <div className="relative flex h-full min-h-0 flex-col px-6 pb-5 pt-9">
            <TriageCardBody item={item} answerSlot={answerSlot} />
          </div>

          {isTop && draggable ? (
            <>
              <motion.div
                style={{ opacity: rejectStamp, rotate: -12 }}
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute left-6 top-6 z-30 rounded-modal border-2 border-status-error px-4 py-2 typo-heading-lg font-bold uppercase text-status-error"
              >
                {item.verdictLabels.reject}
              </motion.div>
              <motion.div
                style={{ opacity: acceptStamp, rotate: 12 }}
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute right-6 top-6 z-30 rounded-modal border-2 border-status-success px-4 py-2 typo-heading-lg font-bold uppercase text-status-success"
              >
                {item.verdictLabels.accept}
              </motion.div>
            </>
          ) : null}
        </motion.div>

        <MetricBadgeRow facts={item.facts} />
      </motion.div>
    </motion.div>
  );
}

/**
 * Memoised, and the reason is the answer box.
 *
 * The deck keeps THREE of these mounted for depth, and the draft answer lives in
 * `useDeckControls` one level up — so every keystroke re-rendered all three
 * cards, and each one re-ran up to two `MarkdownRenderer`s (react-markdown +
 * remark-gfm + rehype-highlight) over unchanged prose. The two cards behind the
 * top one cannot possibly have changed: their `answerSlot` is `undefined` and
 * their item, index and cycle are the same objects.
 *
 * This only pays off while the props above it are stable, which is why
 * `useMonitorData`, `usePendingInteractions`, `useWorkspaceCenter` and
 * `useUnifiedTriage` all memoise their returns and `QuickAnswerPopover` wraps
 * its deep-link handlers — `onCommit` closes over the queue object, so one fresh
 * object anywhere up that chain silently undoes this.
 */
export const TriageCard = memo(TriageCardImpl);
