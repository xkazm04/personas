// The gate: the one place in this product where a council decision is made.
//
// Three rules it holds, and none of them is decoration:
//  1. It opens ONLY when `decidable(subject)`. Every other state is a closed
//     gate carrying one sentence that says why, and a rejection shows back
//     the reason that was written.
//  2. No key commits. `G` moves the FOCUS to Approve and stops there. The
//     arm-then-confirm on Approve and the reason gate on Reject live in the
//     component that owns the mutation, never in a global key handler.
//  3. The write goes through `decideCouncilRow` in `@/lib/decisions/rowWrites`,
//     which carries the `sawDigest` of the run ON SCREEN. A decision quoting
//     a digest the council has moved past is refused by the door, refetched,
//     and said out loud; nothing is retried silently.
import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

const MIN_REASON = 12;
/** Long enough to be deliberate, short enough that a slip does not commit. */
const ARM_MS = 5000;

export interface GateProps {
  open: boolean;
  /** The one sentence, already interpolated. */
  why: string;
  /** Present when a decision already stands on this subject. */
  standing: { decision: 'approved' | 'rejected'; reason: string | null } | null;
  /** Rejected with the CAS refusal, so the page can say the council moved. */
  onDecide: (decision: 'approved' | 'rejected', reason: string | null) => Promise<void>;
  /** Focus request from the `G` key. It focuses; it never commits. */
  focusNonce: number;
  /** The fixture has no backend, and the gate says so rather than pretending. */
  fixture: boolean;
}

export function CouncilGate({ open, why, standing, onDecide, focusNonce, fixture }: GateProps) {
  const { t, tx } = useTranslation();
  const g = t.council.gate;
  const [armed, setArmed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const approveRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (focusNonce > 0 && open) approveRef.current?.focus();
  }, [focusNonce, open]);

  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (!open) {
    const title = standing
      ? standing.decision === 'approved'
        ? g.approved_title
        : g.rejected_title
      : g.closed_title;
    return (
      <section
        data-testid="council-gate"
        data-gate-open="false"
        className={`grid grid-cols-[auto_1fr] items-center gap-x-[22px] gap-y-3.5 rounded-modal border p-4 ${
          standing?.decision === 'approved'
            ? 'border-status-success/40 bg-status-success/[0.06]'
            : standing?.decision === 'rejected'
              ? 'border-status-error/40 bg-status-error/[0.06]'
              : 'border-border bg-secondary/[0.04]'
        }`}
      >
        <Lock
          className={`h-8 w-8 ${
            standing?.decision === 'approved'
              ? 'text-status-success'
              : standing?.decision === 'rejected'
                ? 'text-status-error'
                : 'text-muted-dark'
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h3 className="m-0 mb-1 typo-heading text-foreground">{title}</h3>
          <p className="m-0 typo-body text-foreground">{why}</p>
          {standing?.reason ? (
            <blockquote className="mt-3 border-l-4 border-status-error py-1 pl-4">
              <span className="block typo-caption uppercase tracking-wide text-muted">
                {g.reason_recorded}
              </span>
              <span className="typo-body text-foreground">{standing.reason}</span>
            </blockquote>
          ) : null}
        </div>
      </section>
    );
  }

  const short = reason.trim().length < MIN_REASON;

  return (
    <section
      data-testid="council-gate"
      data-gate-open="true"
      className="grid grid-cols-[auto_1fr_auto] items-center gap-x-[22px] gap-y-3.5 rounded-modal border border-status-pending/50 bg-gradient-to-br from-status-pending/10 to-transparent p-4 shadow-elevation-3"
    >
      <LockOpen className="h-8 w-8 text-status-pending" aria-hidden="true" />
      <div className="min-w-0">
        <h3 className="m-0 mb-1 typo-heading text-foreground">{g.open_title}</h3>
        <p className="m-0 typo-body text-foreground">{why}</p>
        {fixture ? (
          <p className="m-0 mt-1 typo-caption text-status-warning">{t.council.bench.fixture_mode}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="secondary"
          size="md"
          className="!text-status-error !border-status-error/50"
          onClick={() => {
            setRejecting(true);
            window.setTimeout(() => reasonRef.current?.focus(), 0);
          }}
          data-testid="council-gate-reject"
        >
          {g.reject}
        </Button>
        <AsyncButton
          ref={approveRef}
          variant="primary"
          size="md"
          data-testid="council-gate-approve"
          onClick={async () => {
            // Armed, then confirmed. The first press changes the label and
            // nothing else.
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            await onDecide('approved', null);
          }}
        >
          {armed ? g.approve_confirm : g.approve}
        </AsyncButton>
      </div>

      {rejecting ? (
        <div className="col-span-full">
          <label htmlFor="council-reject-reason" className="mb-2 block typo-heading text-foreground">
            {g.reason_label}
          </label>
          <textarea
            id="council-reject-reason"
            ref={reasonRef}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={g.reason_placeholder}
            className={`${INPUT_FIELD} mb-3 w-full resize-y`}
            data-testid="council-reject-reason"
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto typo-body text-muted" data-testid="council-reject-need">
              {short ? tx(g.reason_need, { count: MIN_REASON - reason.trim().length }) : g.reason_ok}
            </span>
            <Button variant="secondary" size="md" onClick={() => setRejecting(false)}>
              {g.cancel}
            </Button>
            <AsyncButton
              variant="danger"
              size="md"
              disabled={short}
              data-testid="council-gate-reject-go"
              onClick={async () => {
                if (short) return;
                await onDecide('rejected', reason.trim());
              }}
            >
              {g.reject_go}
            </AsyncButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default CouncilGate;
