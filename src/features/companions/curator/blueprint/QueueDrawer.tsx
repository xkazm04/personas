/**
 * THE OPERATOR'S QUEUE - the docket's sibling drawer.
 *
 * Same box, same head, same open/close grammar, same inks: it wears the
 * docket's own `cb-drawer` / `cb-dk-head` classes rather than a second copy of
 * them, so the two cannot drift apart into two dialects of the same surface.
 * `useBlueprintState` keeps ONE drawer slot, so opening this one shuts the
 * docket - they can never hold the right-hand surface together.
 *
 * It renders NOTHING of its own about the queue. The lane comes in as a node
 * (`console/RequestLane`), exactly as the console's does, because this
 * component sits inside `<Blueprint>`, which reaches no IPC. Moving the
 * existing lane here rather than drawing a second one is also what keeps one
 * row per request in the ledger's own row rhythm: `RequestRow` already draws
 * it, and it is the same component it always was.
 */
import { type ReactNode } from 'react';

import Button from '@/features/shared/components/buttons/Button';

import { useWords } from './words';

export interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The lane, handed in by the page. Absent in a harness with no loop. */
  children?: ReactNode;
}

export function QueueDrawer({ open, onClose, children }: QueueDrawerProps) {
  const { w } = useWords();
  return (
    <section
      className={`cb-drawer cb-queue${open ? ' cb-open' : ''}`}
      data-role="cb-queue"
      aria-label={w.console.lane_title}
      aria-hidden={!open}
    >
      <div className="cb-dk-head" data-role="cb-queue-head">
        <h2 className="typo-section-title">{w.console.lane_title}</h2>
        <span className="cb-sp" />
        <Button
          variant="ghost"
          size="sm"
          className="cb-keep cb-tbtn typo-caption"
          data-role="cb-queue-close"
          onClick={onClose}
        >
          <kbd>Esc</kbd>
          {w.docket_close}
        </Button>
      </div>
      <div className="cb-q-body">{children}</div>
    </section>
  );
}
