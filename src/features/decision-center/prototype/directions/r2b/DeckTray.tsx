/**
 * The tray the cards sit in — the part of the deck that does NOT move while
 * walking: where you are (scope, position as a figure, a ruler with one tick
 * per card coloured by tier), the walk and close icon buttons, and the stack
 * of ghost cards beneath the top one, with the count still to go riding the
 * stack's edge. No legend: keys live on their actions, the map behind "Keys".
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DecisionItem } from '../../../model/decisionModel';
import { GHOSTS } from './deckMotion';
import { TIER_TONE, tierOf } from './deckMeta';

/** Where a ghost rises from when the stack shifts one step (a walk or a verdict). */
const DEEPEST = { scale: 0.9, y: 36, opacity: 0 };

const pad = (n: number) => String(n).padStart(2, '0');

export function DeckTray({ scopeLabel, queue, index, tall, onWalk, onClose, children }: {
  scopeLabel: string;
  queue: DecisionItem[];
  index: number;
  tall: boolean;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const still = useReducedMotion();
  const after = Math.max(0, queue.length - index - 1);
  const below = Math.min(GHOSTS.length, after);
  return (
    <div className="flex flex-col gap-3">
      <div className="r2b-tray-head">
        <span tabIndex={0} className="rounded-input typo-eyebrow text-foreground outline-none" aria-label={`${scopeLabel} deck`}>
          {scopeLabel}
        </span>
        <span className="r2b-pos" aria-live="polite" aria-label={queue.length === 0 ? 'empty' : `${index + 1} of ${queue.length}`}>
          <span className="r2b-figure-md" aria-hidden>{queue.length === 0 ? '00' : pad(index + 1)}</span>
          <span className="typo-data r2b-unit" aria-hidden>/ {pad(queue.length)}</span>
        </span>
        <div className="r2b-ruler" aria-hidden>
          {queue.map((q, i) => (
            <span
              key={q.id}
              className="r2b-tick"
              data-past={i < index || undefined}
              data-now={i === index || undefined}
              style={{ '--r2b-tick': TIER_TONE[tierOf(q)] } as CSSProperties}
            />
          ))}
        </div>
        <Tooltip content="Previous (← or K)">
          <Button variant="ghost" size="icon-sm" onClick={() => onWalk(-1)} disabled={index === 0} aria-label="Previous card">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content="Next (→ or J)">
          <Button variant="ghost" size="icon-sm" onClick={() => onWalk(1)} disabled={index >= queue.length - 1} aria-label="Next card">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content="Back (Esc)">
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close deck">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </Tooltip>
      </div>

      <div className={`r2b-stage ${tall ? 'h-[min(calc(100vh-150px),900px)]' : 'h-[min(calc(100vh-160px),700px)]'}`}>
        {GHOSTS.slice(0, below).map((g, d) => (
          <motion.div
            key={`${d}:${queue[index]?.id ?? ""}`}
            className="r2b-ghost"
            style={{ zIndex: 0 }}
            initial={still ? false : (GHOSTS[d + 1] ?? DEEPEST)}
            animate={{ scale: g.scale, y: g.y, opacity: g.opacity }}
            transition={still ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
            aria-hidden
          />
        )).reverse()}
        {children}
        {after > 0 && (
          <span className="r2b-stack-count" aria-hidden>
            <span className="typo-data text-foreground r2b-num">{after}</span>
            <span className="typo-caption r2b-caps">more in this deck</span>
          </span>
        )}
      </div>
    </div>
  );
}
