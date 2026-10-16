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
 *
 * It opens on what is PENDING. The settled history is one click away in the
 * head and is handed in as its own node, mounted only while it is showing, so
 * the drawer never reads a history nobody asked for. Closing the drawer
 * returns it to pending: the next open answers "what is waiting" first.
 */
import { useEffect, useState, type ReactNode } from 'react';

import Button from '@/features/shared/components/buttons/Button';

import { useWords } from './words';

export interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The pending lane, handed in by the page. Absent in a harness with no loop. */
  children?: ReactNode;
  /** The settled history, mounted only once the head's switch asks for it. */
  history?: ReactNode;
}

type QueueView = 'pending' | 'history';

export function QueueDrawer({ open, onClose, children, history }: QueueDrawerProps) {
  const { w } = useWords();
  const [view, setView] = useState<QueueView>('pending');
  useEffect(() => {
    if (!open) setView('pending');
  }, [open]);
  const showingHistory = view === 'history' && history !== undefined;
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
        {history !== undefined && (
          <div className="cb-q-views" role="group" aria-label={w.console.lane_view_label}>
            {(['pending', 'history'] as const).map((v) => (
              <Button
                key={v}
                variant="ghost"
                size="sm"
                className="cb-keep cb-tbtn typo-caption"
                aria-pressed={view === v}
                data-role={`cb-queue-view-${v}`}
                onClick={() => setView(v)}
              >
                {v === 'pending' ? w.console.lane_view_pending : w.console.lane_view_history}
              </Button>
            ))}
          </div>
        )}
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
      <div className="cb-q-body">
        {showingHistory ? history : children}
        {/* HER, at the one moment this drawer has room for her: an empty lane,
            or one nobody could read. The element is always here and the
            stylesheet withdraws it the moment the lane draws a row - a
            watermark that survives under content is a watermark that has
            started competing with it. Same luminance mask over `--primary` as
            the mark in the top bar, so it is the theme's colour in her shape
            and not a second palette arriving from an asset. */}
        <span className="cb-cur-figure" data-role="cb-curator-figure" aria-hidden="true" />
      </div>
    </section>
  );
}
