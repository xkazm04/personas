/**
 * The human lane - every request still PENDING (queued or running), oldest
 * first. It is drawn in the QUEUE DRAWER, beside the docket; the drawer's head
 * carries the title and the switch to the settled history
 * (`RequestHistory`), so this head carries only what the drawer's cannot - the
 * note and the count.
 *
 * Chronological in the order they WROTE it, not re-sorted by state: she drains
 * the lane in that order, so a reader scanning top to bottom is reading the
 * order the work will happen in.
 *
 * Three different empty readings, and they are three different facts:
 *
 * - `null` - the door did not answer. Nobody knows what is queued.
 * - `[]` - the door answered and she has nothing filed.
 * - a list - drawn.
 */
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';

import { useWords } from '../words';

import { RequestRow } from './RequestRow';

export function RequestLane({ requests, onCancel }: {
  requests: CuratorRequest[] | null;
  onCancel: (id: string) => Promise<void>;
}) {
  const { w, tx } = useWords();

  if (!requests) {
    return (
      <div className="cb-lane" data-role="cb-lane" data-state="unread">
        <span className="cb-unset typo-caption" data-cb-tip={w.console.lane_unread_tip}>
          {w.console.lane_unread}
        </span>
      </div>
    );
  }

  // The door lists the open half first and caps the whole; only that open half
  // is the lane. What has settled lives in the history, one page at a time.
  const pending = requests.filter((r) => r.state === 'queued' || r.state === 'dispatched');
  const queued = pending.filter((r) => r.state === 'queued').length;

  return (
    <div className="cb-lane" data-role="cb-lane" data-state={pending.length ? 'filled' : 'empty'}>
      <div className="cb-lane-head typo-caption">
        <i>{w.console.lane_note}</i>
        <span className="cb-sp" />
        {pending.length > 0 && (
          <span data-role="cb-lane-count">
            {tx(w.console.lane_count, { n: pending.length, queued })}
          </span>
        )}
      </div>
      {pending.length === 0 ? (
        <p className="cb-lane-empty typo-caption" data-role="cb-lane-empty">
          {requests.length === 0 ? w.console.lane_empty : w.console.lane_pending_empty}
        </p>
      ) : (
        <ul className="cb-lane-rows typo-caption" aria-label={w.console.lane_title}>
          {pending.map((request) => (
            <RequestRow key={request.id} request={request} onCancel={onCancel} />
          ))}
        </ul>
      )}
    </div>
  );
}
