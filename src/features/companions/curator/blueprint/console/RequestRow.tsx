/**
 * One request in the operator's lane, as they wrote it.
 *
 * The row draws only what the record carries. A request that has not started
 * has no start stamp and no outcome, and those cells stay EMPTY rather than
 * rendering a dash that could be read as a measured nothing - the same rule
 * the ledger above holds to for its nine columns.
 *
 * `queued` is the only state that may be withdrawn, because it is the only one
 * she has not picked up. The control is absent - not disabled - everywhere
 * else: a disabled Withdraw on a landed request is an affordance that was
 * never real.
 */
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';

import { utcStamp } from '../format';
import { useWords } from '../words';

export function RequestRow({ request, onCancel }: {
  request: CuratorRequest;
  onCancel: (id: string) => Promise<void>;
}) {
  const { w, tx } = useWords();
  const state = w.console.request_state[request.state];
  // The run's own words, in the order they become true: why it failed, then
  // what it produced. Neither is invented when the record holds neither.
  const say = request.failureReason ?? request.outcome;

  return (
    <li className="cb-req" data-role="cb-request" data-state={request.state} data-cb-id={request.id}>
      <span className="cb-req-state typo-label" data-role="cb-request-state">
        {state}
      </span>
      <span className="cb-req-skill">
        <b>{request.skill}</b>
        {request.argument === null ? (
          <i className="cb-unset" data-cb-tip={w.console.request_bare_tip}>
            {w.console.request_bare}
          </i>
        ) : (
          <i className="cb-req-arg">{request.argument}</i>
        )}
      </span>
      {request.note && <span className="cb-req-note">{request.note}</span>}
      <span className="cb-sp" />
      {say && (
        <span className="cb-req-say" data-cb-tip={request.resultRef ?? undefined}>
          {say}
        </span>
      )}
      <span className="cb-req-when" data-cb-tip={tx(w.console.request_filed, { at: utcStamp(request.createdAt) })}>
        {utcStamp(request.settledAt ?? request.startedAt ?? request.createdAt)}
      </span>
      {request.state === 'queued' && (
        <AsyncButton
          variant="ghost"
          size="xs"
          className="cb-keep"
          aria-label={tx(w.console.request_cancel_label, { skill: request.skill })}
          data-testid="curator-request-cancel"
          onClick={() => onCancel(request.id)}
        >
          {w.console.request_cancel}
        </AsyncButton>
      )}
    </li>
  );
}
