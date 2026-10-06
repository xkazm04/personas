/**
 * One peek row: urgency bar, title, source · age · cost, and — on the focused
 * row only — the one-key verdicts it accepts. Ready rows carry Dispatch.
 */
import { motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { COPY } from './copy';
import { Kbd } from './Kbd';
import { costOf, TONE_FILL, urgencyTone } from './meta';

export type PeekVerdictKeys = { accept?: string; reject?: string; done?: string };

/** The one-key verdicts a row accepts from the peek. */
export function peekKeysFor(item: DecisionItem, ready: boolean): PeekVerdictKeys {
  if (ready) return { accept: item.verdictLabels.accept };
  const type = modalTypeOf(item.kind);
  if (type === 'report' && item.kind === 'report') return { done: item.verdictLabels.accept };
  if (type === 'chat') return { done: item.verdictLabels.reject };
  return { accept: item.verdictLabels.accept, reject: item.verdictLabels.reject };
}

interface PeekRowProps {
  item: DecisionItem;
  index: number;
  focused: boolean;
  armed: boolean;
  first: boolean;
  ready: boolean;
  reduce: boolean;
  onFocus: () => void;
  onOpen: (el: HTMLElement) => void;
  onDispatch: () => void;
}

export function PeekRow({ item, index, focused, armed, first, ready, reduce, onFocus, onOpen, onDispatch }: PeekRowProps) {
  const tone = urgencyTone(item);
  const keys = peekKeysFor(item, ready);
  return (
    <motion.div
      role="option"
      aria-selected={focused}
      id={`p1-peek-${item.id}`}
      data-p1-origin={item.id}
      className={`p1-peek-row ${armed ? 'is-armed' : ''}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ duration: 0.18, delay: reduce ? 0 : 0.03 + index * 0.025 }}
      layout={!reduce}
      onMouseEnter={onFocus}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <span className={`p1-peek-bar ${TONE_FILL[tone]}`} aria-hidden />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          {first && <span className="typo-label text-primary shrink-0">{COPY.strip.next}</span>}
          <span className="typo-body truncate text-foreground">{item.title}</span>
        </span>
        <span className="flex items-center gap-1.5 typo-caption">
          <span className="truncate">{item.source.label}</span>
          <span aria-hidden>·</span>
          <RelativeTime timestamp={item.createdAt} format="elapsed" />
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">{costOf(item)}</span>
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {ready ? (
          <Button variant="accent" tone="success" size="xs" onClick={(e) => { e.stopPropagation(); onDispatch(); }}>
            {COPY.peek.dispatch}
          </Button>
        ) : armed ? (
          <span className="inline-flex items-center gap-1 typo-label text-status-error">
            <Kbd>⏎</Kbd>{COPY.peek.confirmReject}
          </span>
        ) : focused ? (
          <>
            {keys.accept && <span className="inline-flex items-center gap-1 typo-caption"><Kbd>A</Kbd>{keys.accept}</span>}
            {keys.reject && <span className="inline-flex items-center gap-1 typo-caption"><Kbd>R</Kbd>{keys.reject}</span>}
            {keys.done && <span className="inline-flex items-center gap-1 typo-caption"><Kbd>D</Kbd>{keys.done}</span>}
          </>
        ) : null}
      </span>
    </motion.div>
  );
}
