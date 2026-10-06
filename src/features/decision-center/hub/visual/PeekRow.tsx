/**
 * One peek row: a glowing tier stripe (red = blocking, primary = decide, grey =
 * read), the title (two lines, never cut mid-word), then the ledger in icons:
 * source monogram, clock + age, gauge + cost. The focused row shows its keys
 * once, inset; the roster's first row is flagged NEXT with a breathing lamp.
 * Ready rows carry their own Dispatch button.
 */
import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Clock, Gauge, Rocket } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { modalTypeOf, type DecisionItem } from '../../model/decisionModel';
import { TIER_META, costOf, tierOf } from '../../deck/deckMeta';
import { Keycap, Lamp, Monogram } from '../../deck/parts';

/** Exit reads the presence `custom` (the verdict's direction), not stale props. */
const ROW_LEAVE = { leave: (dir: number) => ({ opacity: 0, x: dir * 160, filter: 'blur(2px)', transition: { duration: 0.22 } }) };

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
      className={`au-row ${isReady ? 'au-tier-ok' : `au-tier-${tier}`} ${isReady ? 'au-l-success' : ''} group relative flex items-stretch gap-3 rounded-card py-1 pl-1.5 pr-2`}
      data-focused={focused ? '' : undefined}
      onMouseEnter={onFocus}
      data-testid={`p2-peek-row-${item.id}`}
    >
      <Tooltip content={isReady ? 'Accepted — ready to dispatch' : TIER_META[tier].label}>
        <span className={`au-stripe flex-shrink-0 ${isReady ? 'au-tier-ok' : ''}`} aria-label={isReady ? 'accepted' : TIER_META[tier].label} />
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpen}
        aria-label={`Open: ${item.title}`}
        className="min-w-0 flex-1 rounded-card px-0 py-1.5 text-left hover:bg-transparent [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:flex-col [&>span]:gap-1"
      >
        <span className="line-clamp-2 typo-body text-foreground [text-wrap:pretty]">{item.title}</span>
        <span className="flex min-w-0 items-center gap-3 typo-caption">
          <span className="flex min-w-0 items-center gap-1.5">
            <Monogram item={item} size="sm" />
            <span className="truncate">{item.source.label}</span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <RelativeTime timestamp={item.createdAt} className="typo-caption" />
          </span>
          <span className="flex flex-shrink-0 items-center gap-1 text-foreground">
            {isReady ? <Rocket className="h-3.5 w-3.5" aria-hidden /> : <Gauge className="h-3.5 w-3.5" aria-hidden />}
            {isReady ? 'accepted' : costOf(item)}
          </span>
        </span>
      </Button>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {isReady ? (
          <Button variant="accent" tone="success" size="xs" onClick={onDispatch} icon={<Rocket className="h-3.5 w-3.5" aria-hidden />} className="au-lift">
            Dispatch
          </Button>
        ) : focused ? (
          <span className="flex items-center gap-1 text-foreground" aria-label={reads ? 'D done, Enter open' : 'A approve, R reject, Enter open'}>
            {reads ? <Keycap>D</Keycap> : <><Keycap className="text-status-success">A</Keycap><Keycap className="text-status-error">R</Keycap></>}
            <Keycap>↵</Keycap>
          </span>
        ) : isNext ? (
          <span className="flex items-center gap-1.5 typo-eyebrow text-primary">
            <Lamp tone="accent" breathe /> next
          </span>
        ) : null}
      </div>
    </motion.div>
  );
});
