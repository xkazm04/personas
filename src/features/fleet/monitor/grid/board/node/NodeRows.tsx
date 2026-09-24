// NodeRows — the inside of a node's body, and the elapsed bar under it.
//
//   • the TITLE ROW is the title and nothing else (see `FleetNode`'s header),
//     pinned to the TOP of the body;
//   • a subtle 1 px hairline DIVIDER between the two rows, decorative only;
//   • the SYMBOL ROW is the symbols `nodeSymbols` orders, and nothing else,
//     pinned to the BOTTOM (the body is `flex-col justify-between`);
//   • the speech bubble slides up over the title row and fades on its own.
//
// `ElapsedBar` is the elapsed fill along the node's bottom edge — a sibling of
// the body in the shell, not a row inside it.

import { Fragment, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { NodeHue, NodeSymbolId } from './nodeSymbols';
import type { NodeView } from './nodeTypes';

export function NodeRows({
  view, rowIds, tooltip, reducedMotion,
}: {
  view: NodeView;
  /** The symbol row's ids — the view's ids minus the ones painted elsewhere (the elapsed bar). */
  rowIds: NodeSymbolId[];
  tooltip: ReactNode;
  reducedMotion: boolean;
}) {
  const { title, titleTone, renderers, bubble, bubbleBorder } = view;
  return (
    <>
      {/* The title row: the title, and nothing else. The shared Tooltip, not
          `title=`, sits on this inert row rather than on the body button, so
          hovering a symbol below shows that symbol's tip alone. */}
      <span className="block h-5 min-w-0" data-testid="fleet-node-title-row">
        <Tooltip content={tooltip}>
          <span className={`block truncate typo-body text-foreground ${titleTone}`} data-testid="fleet-node-title">{title}</span>
        </Tooltip>
      </span>
      <span aria-hidden className="block h-px flex-shrink-0 bg-foreground/10" data-testid="fleet-node-divider" />
      <span className="flex h-[18px] min-w-0 items-center gap-1" data-testid="fleet-node-symbols">
        {rowIds.map((id) => <Fragment key={id}>{renderers[id]?.()}</Fragment>)}
      </span>
      {/* The speech bubble: slides up over the title row, fades out on its
          own. Keyed on the message id so a newer line from the same persona
          plays its own entrance instead of mutating the old bubble in place. */}
      <AnimatePresence>
        {bubble && (
          <motion.span
            key={bubble.id}
            aria-hidden
            data-testid="fleet-grid-chat-bubble"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: 'easeOut', opacity: { duration: 0.45 } }}
            className="absolute inset-x-1 top-0.5 flex h-5 items-center gap-1 rounded-full border border-primary/30 bg-background/95 px-2 shadow-elevation-1"
            style={{ borderColor: bubbleBorder }}
          >
            <MessageCircle className="h-[11px] w-[11px] flex-shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate typo-caption text-foreground">{bubble.text}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * The elapsed fill, along the bottom edge. The 2 px bar is too thin to hover,
 * so a 6 px strip over it carries the label (elapsed for a live row, the ETA
 * for a queued one) for the pointer and the screen reader.
 */
export function ElapsedBar({ fill, label, hue }: { fill: number; label: string; hue: NodeHue }) {
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}
        data-symbol="elapsed"
        data-testid="fleet-node-elapsed"
        data-fill={fill.toFixed(2)}
        className="absolute inset-x-0 bottom-0 h-1.5"
      >
        <span
          aria-hidden
          data-testid="fleet-node-elapsed-bar"
          className={`absolute bottom-0 left-0 h-0.5 ${hue.dot}`}
          style={{ width: `${Math.round(fill * 100)}%` }}
        />
      </span>
    </Tooltip>
  );
}
