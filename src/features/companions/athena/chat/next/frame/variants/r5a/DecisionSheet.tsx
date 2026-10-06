/**
 * DecisionSheet - the island grown into a decision. Its head is the queue:
 * one pip per item waiting on you, the open one lit with its kind named; the
 * body is that item's native sheet (`DecisionBody`); the foot names the real
 * keys. ←/→ walk the queue, Esc (the layer's own) folds back to wherever the
 * island was.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { NEXT_COPY as C } from '../../../nextCopy';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import { DecisionBody } from './DecisionBody';
import { IslandMark } from './IslandMark';
import { KindIcon } from './kindIcon';
import { isTyping } from './useDecisionKeys';
import { ISLAND_COPY as I } from './copy';

/** Between the layer's Esc (FULLSCREEN_LAYER_PRIORITY) and the tile keys. */
const WALK_KEY_PRIORITY = FULLSCREEN_LAYER_PRIORITY + 1;

export function DecisionSheet({
  items,
  focusId,
  onFocus,
  onFold,
  onSend,
  working,
  onMeasure,
}: {
  items: WorkItem[];
  focusId: string | null;
  onFocus: (id: string) => void;
  onFold: () => void;
  onSend: (text: string) => void;
  working: boolean;
  /** Reports the open item's content height, so the island can fit it. */
  onMeasure: (h: number) => void;
}) {
  const { shouldAnimate } = useMotion();
  const active = items.find((i) => i.id === focusId) ?? items[0] ?? null;
  const at = active ? items.indexOf(active) : -1;
  const bodyRef = useRef<HTMLDivElement>(null);
  // A callback ref: the item's content remounts after the previous one's exit,
  // so the observer follows whichever element is actually on screen.
  const observer = useRef<ResizeObserver | null>(null);
  const contentRef = useCallback(
    (el: HTMLDivElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el) return;
      observer.current = new ResizeObserver(() => onMeasure(el.offsetHeight));
      observer.current.observe(el);
      onMeasure(el.offsetHeight);
    },
    [onMeasure],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  // The sheet takes the keyboard from the composer: 1-9 must choose, not type.
  useEffect(() => {
    if (isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur();
    bodyRef.current?.focus({ preventScroll: true });
  }, []);

  useAppKeyboard(
    (e) => {
      if (isTyping(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return false;
      if ((e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || items.length < 2) return false;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      onFocus(items[(Math.max(0, at) + step + items.length) % items.length]!.id);
      return true;
    },
    { priority: WALK_KEY_PRIORITY },
  );

  const color = active ? KIND_VAR[active.kind] : 'var(--primary)';
  return (
    <>
      <div className="r5a-head">
        <IslandMark large working={working} gated={items.length > 0} />
        <nav className="r5a-pips" aria-label={C.waitingOnYou} data-testid="companion-r5a-queue">
          {items.map((it) => {
            const on = it.id === active?.id;
            return (
              <Tooltip key={it.id} content={`${C.kind[it.kind]} · ${it.project ?? I.athenaLane}`}>
                <Button
                  variant="ghost"
                  className="r5a-pip"
                  style={{ ['--c' as string]: KIND_VAR[it.kind] }}
                  aria-current={on}
                  aria-label={C.kind[it.kind]}
                  onClick={() => onFocus(it.id)}
                >
                  <KindIcon kind={it.kind} />
                  {on && <span className="typo-label">{C.kind[it.kind]}</span>}
                </Button>
              </Tooltip>
            );
          })}
        </nav>
        <span className="flex-1" />
        {at >= 0 && <span className="typo-caption whitespace-nowrap tabular-nums">{I.itemOf(at + 1, items.length)}</span>}
        <Tooltip content={`${I.foldChat} · ${I.keyEsc}`}>
          <Button
            variant="ghost"
            size="icon-md"
            className="!rounded-full"
            onClick={onFold}
            aria-label={I.foldChat}
            aria-keyshortcuts="Escape"
            data-testid="companion-r5a-fold"
            icon={<ChevronDown className="w-5 h-5" aria-hidden />}
          />
        </Tooltip>
      </div>
      <div ref={bodyRef} className="r5a-body r5a-sheet outline-none" tabIndex={-1} data-testid="companion-r5a-sheet">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active?.id ?? 'none'}
            ref={contentRef}
            className="w-full self-start"
            initial={{ opacity: 0, y: shouldAnimate ? 8 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.22 : 0, ease: [0.22, 1, 0.36, 1] }}
          >
            {active ? (
              <DecisionBody item={active} color={color} onSend={onSend} />
            ) : (
              <ScenarioEmptyState title={I.nothingWaiting} subtitle={I.nothingWaitingSub} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="r5a-legend typo-caption" aria-hidden>
        <span><span className="r5a-kbd typo-caption">{I.keyRange}</span>{I.keysChoose}</span>
        <span><span className="r5a-kbd typo-caption">0</span>{I.keysAsk}</span>
        <span><span className="r5a-kbd typo-caption">{I.keyEnter}</span>{I.keysConfirm}</span>
        <span><span className="r5a-kbd typo-caption">←</span><span className="r5a-kbd typo-caption">→</span>{I.keysWalk}</span>
        <span><span className="r5a-kbd typo-caption">{I.keyEsc}</span>{I.keysFold}</span>
      </div>
    </>
  );
}
