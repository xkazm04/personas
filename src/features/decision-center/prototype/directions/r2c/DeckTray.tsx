/**
 * The tray the cards sit in — the part of the deck that does NOT move while
 * walking: where you are (scope, "2 of 5", one pip per card coloured by tier),
 * the walk and close controls, the stack of cards peeking out beneath the top
 * one, and the key legend. The legend lives here, never on the strip.
 */
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DecisionItem, DecisionModalType } from '../../../model/decisionModel';
import { TIER_FILL, tierOf } from './deckMeta';
import { KeyLegend } from './KeyLegend';

export function DeckTray({ scopeLabel, queue, index, type, isCouncil, tall, onWalk, onClose, children }: {
  scopeLabel: string;
  queue: DecisionItem[];
  index: number;
  type: DecisionModalType;
  isCouncil: boolean;
  tall: boolean;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const below = Math.min(2, Math.max(0, queue.length - index - 1));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-card border border-primary/15 bg-background px-3 py-2 shadow-elevation-2">
        <span tabIndex={0} className="rounded-input px-1 typo-heading text-foreground outline-none" aria-label={`${scopeLabel} deck`}>
          {scopeLabel}
        </span>
        <span className="typo-data tabular-nums text-foreground" aria-live="polite">
          {queue.length === 0 ? 'empty' : `${index + 1} of ${queue.length}`}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-hidden>
          {queue.map((q, i) => (
            <span
              key={q.id}
              className={`h-1.5 flex-shrink-0 rounded-pill transition-all duration-200 ${TIER_FILL[tierOf(q)]} ${
                i === index ? 'w-6' : i < index ? 'w-1.5 opacity-30' : 'w-1.5 opacity-60'}`}
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

      <div className={`relative ${tall ? 'h-[min(calc(100vh-140px),900px)]' : 'h-[min(calc(100vh-150px),720px)]'}`}>
        {below >= 2 && <div className="absolute inset-x-10 -bottom-4 top-6 rounded-modal border border-primary/10 bg-secondary/40" aria-hidden />}
        {below >= 1 && <div className="absolute inset-x-5 -bottom-2 top-3 rounded-modal border border-primary/15 bg-secondary/60" aria-hidden />}
        {children}
      </div>

      <KeyLegend type={type} isCouncil={isCouncil} labels={queue[index]?.verdictLabels} />
    </div>
  );
}
