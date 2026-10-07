/**
 * Fusion · the decision stage (Halo · Spread's Oracle keyboard UX, re-designed
 * for the owner's note): the QUESTION is its own calm block at the top of the
 * window, and the ANSWERS are separate cards that fly in over the app from the
 * rail's attention circle and land under it. Nothing wraps them all - no
 * backdrop card, no card inside a card, no ornament - only a soft dim of the
 * app behind, so the cards read over a busy table.
 *
 * Keys (the Oracle / Spread model): ←/→ walk the queue, Space sets the
 * current item aside (only when focus is on the stage itself - a focused
 * button, link or disclosure takes Space as its own), Esc (the layer's own) and Alt+W fold back; on an item
 * with answers 1-9 pick, 0 asks Athena, Enter takes her pick, ↑/↓ move
 * between answers (`useAnswerKeys`).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { WorkItem } from '../../../useWorkforce';
import { FUSION_COPY as F } from './copy';
import { ItemSurface } from './ItemSurface';
import { EASE, isInteractive, isTyping, plainWords } from './text';

export interface QueueNav {
  items: WorkItem[];
  activeId: string;
  onPick: (id: string) => void;
  onAside: () => void;
  onFold: () => void;
}

/** The question block takes focus when an item swaps in, so it never drops to <body>. */
const QUESTION = '[data-fusion-question]';

/**
 * Wraps one item. When it mounts after another item left (an answer resolved,
 * the queue stepped) and focus was lost or still on the stage, focus moves to
 * its question; focus that went somewhere else on purpose is left alone.
 */
function StageItem({ stage, exit, children }: { stage: React.RefObject<HTMLDivElement | null>; exit: TargetAndTransition; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = document.activeElement;
    if (at && at !== document.body && at !== stage.current && !stage.current?.contains(at)) return;
    ref.current?.querySelector<HTMLElement>(QUESTION)?.focus({ preventScroll: true });
  }, [stage]);
  return (
    <motion.div ref={ref} className="fu-stage-item" exit={exit}>
      {children}
    </motion.div>
  );
}

export function DecisionStage({
  items,
  focusId,
  onFocus,
  onFold,
  onSend,
}: {
  items: WorkItem[];
  focusId: string | null;
  onFocus: (id: string) => void;
  onFold: () => void;
  onSend: (text: string) => void;
}) {
  const { shouldAnimate } = useMotion();
  const announce = useAnnounce();
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  const live = useMemo(() => items.filter((i) => !aside.has(i.id)), [items, aside]);
  const active = live.find((i) => i.id === focusId) ?? live[0] ?? null;
  const stageRef = useRef<HTMLDivElement>(null);
  const state = useRef({ live, active });
  state.current = { live, active };

  // The stage takes the keyboard from the composer: 1-9 must choose, not type.
  useEffect(() => {
    if (isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur();
    (stageRef.current?.querySelector<HTMLElement>(QUESTION) ?? stageRef.current)?.focus({ preventScroll: true });
  }, []);

  // Stepping the queue is said politely: "n of m: title".
  const at = active ? live.indexOf(active) : -1;
  const spoken = active ? F.stepped(at + 1, live.length, plainWords(active.title)) : '';
  useEffect(() => {
    if (spoken) announce(spoken);
  }, [spoken, announce]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const { live: l, active: a } = state.current;
      if (l.length < 2) return;
      const at = Math.max(0, l.findIndex((i) => i.id === a?.id));
      onFocus(l[(at + dir + l.length) % l.length]!.id);
    },
    [onFocus],
  );

  const setCurrentAside = useCallback(() => {
    const cur = state.current.active;
    if (cur) setAside((s) => new Set(s).add(cur.id));
  }, []);

  useAppKeyboard(
    (e) => {
      if (isTyping(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === ' ') {
        // A focused button, link or disclosure takes Space as its own: it activates, the item stays.
        if (!state.current.active || isInteractive(document.activeElement)) return false;
        e.preventDefault();
        setCurrentAside();
        return true;
      }
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && state.current.live.length > 1) {
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  const nav: QueueNav | null = active
    ? { items: live, activeId: active.id, onPick: onFocus, onAside: setCurrentAside, onFold }
    : null;

  return (
    <>
      <motion.div
        className="fu-scrim"
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: shouldAnimate ? 0.24 : 0 }}
      />
      {/* Folding (Esc / Alt+W) sends the whole stage back toward the rail it came from. */}
      <motion.div
        ref={stageRef}
        className="fu-stage outline-none"
        tabIndex={-1}
        role="region"
        aria-label={F.queue}
        data-testid="companion-fusion-decision"
        exit={shouldAnimate ? { opacity: 0, x: 90, scale: 0.94, transition: { duration: 0.3, ease: EASE } } : { opacity: 0, transition: { duration: 0 } }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {active && nav ? (
            <StageItem
              key={active.id}
              stage={stageRef}
              exit={{ opacity: 0, y: shouldAnimate ? -6 : 0, transition: { duration: shouldAnimate ? 0.16 : 0, ease: EASE } }}
            >
              <ItemSurface item={active} nav={nav} onSend={onSend} />
            </StageItem>
          ) : (
            <motion.div key="none" className="fu-question fu-glass" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ScenarioEmptyState title={F.nothingWaiting} subtitle={F.nothingWaitingSub} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
