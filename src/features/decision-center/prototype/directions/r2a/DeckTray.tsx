/**
 * The tray the cards sit in — the part of the deck that does NOT move while
 * walking: a slim glass head (scope, "2 of 5", one pip per card coloured by
 * tier, the Keys affordance, walk and close as icon buttons), the ambient tone
 * light thrown by the current card's kind, and the ghost stack beneath the top
 * card with the remaining count riding its edge.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { chipOf, modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { tierOf } from './deckMeta';
import { KeyMap } from './KeyMap';

function IconButton({ tip, label, disabled, onClick, children }: { tip: string; label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={tip}>
      <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={label} className="r2a-btn">
        {children}
      </Button>
    </Tooltip>
  );
}

const GHOSTS = [
  { scale: 0.965, y: 14, blur: 0.6, opacity: 0.75 },
  { scale: 0.93, y: 28, blur: 1, opacity: 0.45 },
];

export function DeckTray({ scopeLabel, queue, index, item, tall, keysOpen, onKeys, onWalk, onClose, children }: {
  scopeLabel: string;
  queue: DecisionItem[];
  index: number;
  item: DecisionItem | undefined;
  tall: boolean;
  keysOpen: boolean;
  onKeys: () => void;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const still = useReducedMotion();
  const remaining = Math.max(0, queue.length - index - 1);
  const below = Math.min(2, remaining);
  const kind = item ? chipOf(item.kind) : 'gates';
  return (
    <div className="flex flex-col gap-3" data-r2a-kind={kind}>
      <div className="r2a-tray-head r2a-glass">
        <span tabIndex={0} className="rounded-input px-1 typo-heading text-foreground outline-none" aria-label={`${scopeLabel} deck`}>
          {scopeLabel}
        </span>
        <span className="typo-caption" aria-live="polite">
          {queue.length === 0 ? 'empty' : <><span className="typo-heading tabular-nums text-foreground">{index + 1}</span> of {queue.length}</>}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-hidden>
          {queue.map((q, i) => (
            <span key={q.id} className="r2a-pip" data-r2a-tier={tierOf(q)} data-at={i === index ? 'here' : i < index ? 'past' : 'ahead'} />
          ))}
        </div>
        {item && <KeyMap type={modalTypeOf(item.kind)} isCouncil={item.kind === 'council'} labels={item.verdictLabels} open={keysOpen} onToggle={onKeys} />}
        <IconButton tip="Previous (←)" label="Previous card" onClick={() => onWalk(-1)} disabled={index === 0}><ChevronLeft className="h-4 w-4" aria-hidden /></IconButton>
        <IconButton tip="Next (→)" label="Next card" onClick={() => onWalk(1)} disabled={index >= queue.length - 1}><ChevronRight className="h-4 w-4" aria-hidden /></IconButton>
        <IconButton tip="Back (Esc)" label="Close deck" onClick={onClose}><X className="h-4 w-4" aria-hidden /></IconButton>
      </div>

      <div className={`relative ${tall ? 'h-[min(calc(100vh-150px),900px)]' : 'h-[min(calc(100vh-150px),620px)]'}`}>
        <motion.div
          key={kind}
          className="r2a-aura"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: still ? 0.1 : 0.5 }}
          aria-hidden
        />
        {GHOSTS.slice(0, below).reverse().map((g) => (
          <motion.div
            key={`${g.y}:${index}`}
            className="r2a-ghost"
            initial={still ? false : { scale: g.scale - 0.03, y: g.y + 14, opacity: g.opacity * 0.5 }}
            animate={{ scale: g.scale, y: g.y, opacity: g.opacity, filter: `blur(${g.blur}px)` }}
            transition={still ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
            aria-hidden
          />
        ))}
        {children}
        {remaining > 0 && (
          <span className="r2a-stackcount typo-caption" data-testid="r2a-stack-count">
            <span className="typo-heading tabular-nums text-foreground">{remaining}</span> more under this one
          </span>
        )}
      </div>
    </div>
  );
}
