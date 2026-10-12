/**
 * One peek row (R2-C): a glowing tier stripe (red = blocking, primary =
 * decide, grey = read), the title (two lines, never cut mid-word), then the
 * ledger in icons: source monogram, clock + age, gauge + what clearing it
 * costs. The focused row shows its keys once, inset; an armed reject says
 * which key confirms it; the lead row is flagged NEXT with a breathing lamp.
 */
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Clock, Gauge } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import type { DecisionItem } from '../../model/decisionModel';
import { decisionTier } from '../../model/decisionOrder';
import { Keycap, Lamp, Monogram } from '../../deck/parts';
import { canFinishFromRow } from '../peekKeys';
import { useRowCopy } from './rowCopy';
import { ROW_LEAVE, rowEnter } from './peekMotion';

export interface PeekRowProps {
  item: DecisionItem;
  index: number;
  focused: boolean;
  /** R was pressed on this row; Enter will reject it. */
  armed: boolean;
  isNext: boolean;
  leaveDir: number;
  onFocus: () => void;
  onOpen: (from: HTMLElement) => void;
}

export const PeekRow = forwardRef<HTMLDivElement, PeekRowProps>(function PeekRow(
  { item, index, focused, armed, isNext, leaveDir, onFocus, onOpen },
  ref,
) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const copy = useRowCopy();
  const tier = decisionTier(item);
  const tierLabel = copy.tier(tier);
  const finishes = canFinishFromRow(item);

  return (
    <motion.div
      ref={ref}
      layout={still ? false : 'position'}
      custom={still ? 0 : leaveDir}
      initial={{ opacity: 0, y: still ? 0 : -6 }}
      animate={rowEnter(index, still)}
      variants={ROW_LEAVE}
      exit="leave"
      className={`au-row au-tier-${armed ? 1 : tier} group relative flex items-stretch gap-3 rounded-card py-1 pl-1.5 pr-2`}
      data-focused={focused ? '' : undefined}
      data-armed={armed ? '' : undefined}
      onMouseEnter={onFocus}
      data-testid={`decision-peek-row-${item.id}`}
    >
      <Tooltip content={tierLabel}>
        <span className="au-stripe flex-shrink-0" aria-label={tierLabel} />
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => onOpen(e.currentTarget)}
        aria-label={tx(m.dc_hub_row_open_aria, { title: item.title })}
        className="min-w-0 flex-1 rounded-card px-0 py-1.5 text-left hover:bg-transparent [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:flex-col [&>span]:gap-1"
      >
        <span className="line-clamp-2 typo-body text-foreground [text-wrap:pretty]">{item.title}</span>
        <span className="flex min-w-0 items-center gap-3 typo-caption">
          <span className="flex min-w-0 items-center gap-1.5">
            <Monogram item={item} size="sm" />
            <span className="truncate">{item.source.label}</span>
          </span>
          {item.createdAt && (
            <span className="flex flex-shrink-0 items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              <RelativeTime timestamp={item.createdAt} className="typo-caption" />
            </span>
          )}
          <span className="flex flex-shrink-0 items-center gap-1 text-foreground">
            <Gauge className="h-3.5 w-3.5" aria-hidden />
            {copy.cost(item)}
          </span>
        </span>
      </Button>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {armed ? (
          <span className="flex items-center gap-1.5 typo-caption text-status-error" data-testid="decision-peek-armed">
            <Keycap>↵</Keycap>
            {tx(m.dc_hub_reject_armed, { verdict: item.verdictLabels.reject })}
          </span>
        ) : focused ? (
          <span className="flex items-center gap-1 text-foreground" aria-label={finishes ? m.dc_hub_row_keys_read : m.dc_hub_row_keys_decide}>
            {finishes ? <Keycap>D</Keycap> : <><Keycap className="text-status-success">A</Keycap><Keycap className="text-status-error">R</Keycap></>}
            <Keycap>↵</Keycap>
          </span>
        ) : isNext ? (
          <span className="flex items-center gap-1.5 typo-eyebrow text-primary">
            <Lamp tone="accent" breathe /> {m.dc_hub_row_next}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
});
