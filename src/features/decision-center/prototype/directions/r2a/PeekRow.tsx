/**
 * One peek row: a glowing tier stripe, the kind glyph in its tone, the title
 * (two lines, never cut to one), then source · age · cost as icon + value.
 * The focused row carries its one-key verdicts as inset keys; the roster's
 * first item is marked "Next". Ready rows carry their own Dispatch button.
 */
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, CornerDownLeft, Gauge, Rocket, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { chipOf, modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { KIND_ICON, costOf, tierOf } from './deckMeta';

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

function RowKeys({ reads }: { reads: boolean }) {
  return (
    <span className="typo-code r2a-rowkeys" aria-hidden>
      {reads
        ? <span className="typo-code r2a-rowkey"><Check className="h-3 w-3" />D</span>
        : <>
          <span className="typo-code r2a-rowkey r2a-say" data-r2a-say="success"><Check className="h-3 w-3" />A</span>
          <span className="typo-code r2a-rowkey r2a-say" data-r2a-say="danger"><X className="h-3 w-3" />R</span>
        </>}
      <span className="typo-code r2a-rowkey"><CornerDownLeft className="h-3 w-3" /></span>
    </span>
  );
}

export const PeekRow = forwardRef<HTMLDivElement, PeekRowProps>(function PeekRow(
  { item, index, focused, isNext, isReady, leaveDir, onFocus, onOpen, onDispatch },
  ref,
) {
  const tier = tierOf(item);
  const Icon = isReady ? Rocket : KIND_ICON[item.kind];
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
      className="r2a-row group"
      data-focused={focused}
      data-r2a-tier={isReady ? '3' : String(tier)}
      data-r2a-kind={isReady ? 'ready' : chipOf(item.kind)}
      onMouseEnter={onFocus}
      data-testid={`r2a-peek-row-${item.id}`}
    >
      <span className="r2a-row__stripe" aria-hidden />
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpen}
        aria-label={`Open: ${item.title}`}
        className="r2a-row__open"
      >
        <Icon className="r2a-tone mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="typo-body line-clamp-2 text-foreground">{item.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 typo-caption">
            <span className="whitespace-nowrap">{item.source.label}</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              <RelativeTime timestamp={item.createdAt} className="typo-caption" />
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-foreground">
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              {isReady ? 'accepted' : costOf(item)}
            </span>
          </span>
        </span>
      </Button>
      <div className="flex flex-shrink-0 items-center gap-1.5 self-center">
        {isReady ? (
          <Button variant="accent" tone="success" size="xs" onClick={onDispatch} icon={<Rocket className="h-3.5 w-3.5" aria-hidden />} className="r2a-btn">
            Dispatch
          </Button>
        ) : focused ? (
          <RowKeys reads={reads} />
        ) : isNext ? (
          <span className="r2a-tag r2a-say typo-eyebrow" data-r2a-say={tier === 1 ? 'danger' : 'accent'}>Next</span>
        ) : null}
      </div>
    </motion.div>
  );
});
