/**
 * The human lane - every request the operator filed, oldest first.
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

  const queued = requests.filter((r) => r.state === 'queued').length;

  return (
    <div className="cb-lane" data-role="cb-lane" data-state={requests.length ? 'filled' : 'empty'}>
      <div className="cb-lane-head typo-caption">
        <b className="typo-label cb-up">{w.console.lane_title}</b>
        <i>{w.console.lane_note}</i>
        <span className="cb-sp" />
        {requests.length > 0 && (
          <span data-role="cb-lane-count">
            {tx(w.console.lane_count, { n: requests.length, queued })}
          </span>
        )}
      </div>
      {requests.length === 0 ? (
        <p className="cb-lane-empty typo-caption" data-role="cb-lane-empty">
          {w.console.lane_empty}
        </p>
      ) : (
        <ul className="cb-lane-rows typo-caption" aria-label={w.console.lane_title}>
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} onCancel={onCancel} />
          ))}
        </ul>
      )}
    </div>
  );
}
