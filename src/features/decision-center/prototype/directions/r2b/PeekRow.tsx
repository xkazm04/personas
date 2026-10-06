/**
 * One peek row, on the instrument's grid: a tier stripe at the edge, the ask
 * (two lines when it needs them, never cut to one), the source as a monogram
 * and its age, and — in the right-hand figure column — what clearing it costs,
 * figure over unit. Only the focused row prints its keys, once, beside their
 * verbs. Ready rows carry their own Dispatch.
 */
import { forwardRef, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Rocket } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';
import { modalTypeOf, type DecisionItem } from '../../../model/decisionModel';
import { CLOCK_ICON, TIER_TONE, costParts, tierOf } from './deckMeta';
import { Mono } from './Mono';

/** Exit reads the presence `custom` (the verdict's direction), not stale props. */
const ROW_LEAVE = { leave: (dir: number) => ({ opacity: 0, x: dir * 140, transition: { duration: 0.2 } }) };

export interface PeekRowProps {
  item: DecisionItem;
  index: number;
  focused: boolean;
  isReady: boolean;
  leaveDir: number;
  onFocus: () => void;
  onOpen: () => void;
  onDispatch: () => void;
}

function KeyHint({ k, verb }: { k: string; verb: string }) {
  return <span className="r2b-key"><Kbd>{k}</Kbd>{verb}</span>;
}

export const PeekRow = forwardRef<HTMLDivElement, PeekRowProps>(function PeekRow(
  { item, index, focused, isReady, leaveDir, onFocus, onOpen, onDispatch },
  ref,
) {
  const type = modalTypeOf(item.kind);
  const reads = type === 'report' || type === 'chat';
  const cost = costParts(item);
  const Clock = CLOCK_ICON;
  return (
    <motion.div
      ref={ref}
      layout="position"
      custom={leaveDir}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.035, duration: 0.18 } }}
      variants={ROW_LEAVE}
      exit="leave"
      className="r2b-row"
      data-focused={focused || undefined}
      style={{ '--r2b-row-tier': isReady ? 'var(--status-success)' : TIER_TONE[tierOf(item)] } as CSSProperties}
      onMouseEnter={onFocus}
      data-testid={`r2b-peek-row-${item.id}`}
    >
      <Button variant="ghost" size="sm" onClick={onOpen} aria-label={`Open: ${item.title}`} className="r2b-row-open">
        <span className="r2b-row-title typo-body">{item.title}</span>
        <span className="r2b-row-meta typo-caption">
          <Mono label={item.source.label} color={item.source.color} />
          <span className="min-w-0 truncate">{item.source.label}</span>
          <Clock className="h-3.5 w-3.5" aria-hidden />
          <RelativeTime timestamp={item.createdAt} format="elapsed" className="typo-caption r2b-num flex-shrink-0" />
        </span>
      </Button>
      <div className="r2b-row-cost">
        {isReady ? (
          <Button variant="accent" tone="success" size="xs" onClick={onDispatch} icon={<Rocket className="h-3.5 w-3.5" aria-hidden />}>
            Dispatch
          </Button>
        ) : (
          <>
            <span className="r2b-figure-md">{cost.value}</span>
            <span className="typo-caption r2b-caps">{cost.unit}</span>
          </>
        )}
      </div>
      {focused && !isReady && (
        <div className="r2b-row-hint typo-caption">
          {reads ? <KeyHint k="D" verb="done" /> : (
            <>
              <KeyHint k="A" verb={item.verdictLabels.accept.toLowerCase()} />
              <KeyHint k="R" verb={item.verdictLabels.reject.toLowerCase()} />
            </>
          )}
          <KeyHint k="↵" verb="open" />
        </div>
      )}
    </motion.div>
  );
});
