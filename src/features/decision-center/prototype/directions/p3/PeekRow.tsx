/** One peek row: tier bar, title, source + age, and what deciding it costs. */
import { motion } from 'framer-motion';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { DUR, TIER_TONE, TONE_FILL, costOf, tierOf } from './model';
import { Kbd } from './parts';

interface Props {
  item: DecisionItem;
  index: number;
  focused: boolean;
  armed: boolean;
  ready: boolean;
  reduced: boolean;
  onFocus: (i: number) => void;
  onOpen: (i: number) => void;
  onDispatch: (item: DecisionItem) => void;
}

export function PeekRow({ item, index, focused, armed, ready, reduced, onFocus, onOpen, onDispatch }: Props) {
  const tone = TIER_TONE[tierOf(item)];
  const type = modalTypeOf(item.kind);
  const readish = type === 'report' || type === 'chat';
  return (
    <motion.div
      layoutId={reduced ? undefined : `p3-q-${item.id}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: DUR.fast, delay: reduced ? 0 : index * 0.03 }}
      id={`p3-peek-row-${item.id}`}
      role="option"
      aria-selected={focused}
      className={`p3-row ${focused ? 'is-focus' : ''} ${armed ? 'is-armed' : ''}`}
      onMouseEnter={() => onFocus(index)}
      onClick={() => (ready ? onDispatch(item) : onOpen(index))}
      data-testid="p3-peek-row"
    >
      <span className={`p3-row__tier ${ready ? 'bg-status-success' : TONE_FILL[tone]}`} aria-hidden />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {index === 0 && !ready && <span className="typo-label flex-shrink-0 text-status-error">Do first</span>}
          <span className="typo-body min-w-0 truncate text-foreground">{item.title}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 typo-caption">
          <span className="truncate">{item.source.label}</span>
          <span aria-hidden>·</span>
          <RelativeTime timestamp={item.createdAt} className="flex-shrink-0" />
        </span>
      </span>
      {ready ? (
        <Button variant="accent" tone="success" size="xs" onClick={(e) => { e.stopPropagation(); onDispatch(item); }}>
          Dispatch
        </Button>
      ) : (
        <span className="flex flex-shrink-0 flex-col items-end gap-0.5">
          <span className="typo-data text-foreground">{costOf(item)}</span>
          {armed ? (
            <span className="flex items-center gap-1 typo-caption text-status-error"><Kbd>↵</Kbd> confirm reject</span>
          ) : focused ? (
            <span className="flex items-center gap-1 typo-caption">
              {readish ? <Kbd>D</Kbd> : <><Kbd>A</Kbd><Kbd>R</Kbd></>}
              <Kbd>↵</Kbd>
            </span>
          ) : null}
        </span>
      )}
    </motion.div>
  );
}
