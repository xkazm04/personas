/**
 * The tray — the part of the deck that does NOT move while walking. No bar of
 * its own: a chrome-less header floating on the aurora (scope, the position as
 * a hero numeral, a tier-lit track, the Keys affordance, walk and close as icon
 * buttons), then the stack — the card in hand over up to two ghost cards tilted
 * back in 3D, and the count of what is left riding the stack's edge.
 */
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Keyboard, Layers, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DecisionItem, DecisionModalType } from '../model/decisionModel';
import { tierOf } from './deckMeta';
import { KeyMap } from './KeyLegend';
import { Keycap } from './parts';

function Track({ queue, index }: { queue: DecisionItem[]; index: number }) {
  return (
    <div className="flex min-w-0 max-w-[280px] flex-1 items-center gap-1 overflow-hidden" aria-hidden>
      {queue.map((q, i) => (
        <span
          key={q.id}
          className={`au-tier-${tierOf(q)} h-1.5 flex-shrink-0 rounded-pill transition-all duration-300 ${i === index ? 'au-pip-on w-7' : i < index ? 'w-1.5 bg-primary/15' : 'w-2.5 bg-primary/30'}`}
        />
      ))}
    </div>
  );
}

export function DeckTray({ scopeLabel, queue, index, type, isCouncil, tall, keysOpen, onKeys, onWalk, onClose, children }: {
  scopeLabel: string;
  queue: DecisionItem[];
  index: number;
  type: DecisionModalType;
  isCouncil: boolean;
  tall: boolean;
  keysOpen: boolean;
  onKeys: (open: boolean) => void;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const left = Math.max(0, queue.length - index - 1);
  const below = Math.min(2, left);
  return (
    <div className="relative z-10 flex flex-col gap-3">
      <div className="relative flex items-center gap-3 px-2">
        <span tabIndex={0} className="rounded-input px-1 typo-heading text-foreground outline-none" aria-label={`${scopeLabel} deck`}>
          {scopeLabel}
        </span>
        <span className="flex items-baseline gap-1 typo-caption" aria-live="polite">
          {queue.length === 0 ? 'empty' : (
            <>
              <span className="typo-heading tabular-nums text-foreground">{index + 1}</span>
              <span className="tabular-nums">of {queue.length}</span>
            </>
          )}
        </span>
        <Track queue={queue} index={index} />
        <span className="ml-auto flex items-center gap-1">
          <Tooltip content="Every key this card answers to (?)">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onKeys(!keysOpen)}
              aria-expanded={keysOpen}
              icon={<Keyboard className="h-3.5 w-3.5" aria-hidden />}
              className="au-lift typo-caption [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5"
            >
              Keys <Keycap>?</Keycap>
            </Button>
          </Tooltip>
          <Tooltip content="Previous (←)">
            <Button variant="ghost" size="icon-sm" onClick={() => onWalk(-1)} disabled={index === 0} aria-label="Previous card" className="au-lift">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Next (→)">
            <Button variant="ghost" size="icon-sm" onClick={() => onWalk(1)} disabled={index >= queue.length - 1} aria-label="Next card" className="au-lift">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Back (Esc)">
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close deck" className="au-lift">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
        </span>
        <AnimatePresence>
          {keysOpen && <KeyMap key="keys" type={type} isCouncil={isCouncil} labels={queue[index]?.verdictLabels} />}
        </AnimatePresence>
      </div>

      <div className={`au-stack relative ${tall ? 'h-[min(calc(100vh-196px),860px)]' : 'h-[min(calc(100vh-200px),640px)]'}`}>
        {below >= 2 && <div className="au-ghost absolute inset-0 rounded-modal" data-depth="2" aria-hidden />}
        {below >= 1 && <div className="au-ghost absolute inset-0 rounded-modal" data-depth="1" aria-hidden />}
        {children}
        {left > 0 && (
          <Tooltip content={`${left} more in this deck`}>
            <motion.span
              key={left}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="au-stack-badge absolute -bottom-[3.75rem] left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-pill px-2.5 py-0.5 typo-caption"
              data-testid="p2-stack-left"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden />
              <span className="typo-heading tabular-nums text-foreground">{left}</span> more
            </motion.span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
