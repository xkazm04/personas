/**
 * One peek row: tier stripe, kind icon, title, then source · age · cost. The
 * focused row shows its one-key verdicts; the first row of the roster is
 * flagged NEXT. Ready rows carry their own Dispatch button.
 */
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Rocket } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import { chipOf, modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { CHIP_META, TIER_FILL, TIER_META, costOf, tierOf } from './deckMeta';

/** Exit reads the presence `custom` (the verdict's direction), not stale props. */
const ROW_LEAVE = { leave: (dir: number) => ({ opacity: 0, x: dir * 140, transition: { duration: 0.2 } }) };

export interface PeekRowProps {
  item: DecisionItem;
  index: number;
  focused: boolean;
  isNext: boolean;
  isReady: boolean;
  leaveDir: number;
  onFocus: () => void;
  onOpen: () => void;
  onDispatch: () => void;
}

export const PeekRow = forwardRef<HTMLDivElement, PeekRowProps>(function PeekRow(
  { item, index, focused, isNext, isReady, leaveDir, onFocus, onOpen, onDispatch },
  ref,
) {
  const tier = tierOf(item);
  const Icon = CHIP_META[isReady ? 'ready' : chipOf(item.kind)].icon;
  const type = modalTypeOf(item.kind);
  const reads = type === 'report' || type === 'chat';
  return (
    <motion.div
      ref={ref}
      layout="position"
      custom={leaveDir}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.035, duration: 0.18 } }}
      variants={ROW_LEAVE}
      exit="leave"
      className={`group relative flex items-stretch gap-3 rounded-card border pl-0 pr-2 transition-colors ${
        focused ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-secondary/40'}`}
      onMouseEnter={onFocus}
      data-testid={`p2-peek-row-${item.id}`}
    >
      <span className={`w-1 flex-shrink-0 rounded-pill ${isReady ? 'bg-status-success' : TIER_FILL[tier]}`} aria-hidden />
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpen}
        aria-label={`Open: ${item.title}`}
        className="min-w-0 flex-1 rounded-card px-0 py-2 text-left hover:bg-transparent [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:items-start [&>span]:gap-2.5"
      >
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="typo-body truncate text-foreground">{item.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 typo-caption">
            {tier === 1 && !isReady && <span className="flex-shrink-0 text-status-error">{TIER_META[1].label} ·</span>}
            <span className="min-w-[3rem] truncate">{item.source.label}</span>
            <span aria-hidden>·</span>
            <RelativeTime timestamp={item.createdAt} className="typo-caption flex-shrink-0" />
            <span aria-hidden>·</span>
            <span className="flex-shrink-0 text-foreground">{isReady ? 'accepted' : costOf(item)}</span>
          </span>
        </span>
      </Button>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {isReady ? (
          <Button variant="accent" tone="success" size="xs" onClick={onDispatch} icon={<Rocket className="h-3.5 w-3.5" aria-hidden />}>
            Dispatch
          </Button>
        ) : focused ? (
          <span className="flex items-center gap-1 typo-caption">
            {reads ? <Kbd>D</Kbd> : <><Kbd>A</Kbd><Kbd>R</Kbd></>}
            <Kbd>↵</Kbd>
          </span>
        ) : isNext ? (
          <span className="rounded-pill bg-primary/15 px-2 py-0.5 typo-caption text-primary">next</span>
        ) : null}
      </div>
    </motion.div>
  );
});
