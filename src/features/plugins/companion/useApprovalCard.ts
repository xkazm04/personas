import { useCallback, useMemo, useState } from 'react';
import {
  companionApproveAction,
  companionRejectAction,
  type ApprovalOutcome,
  type PendingApproval,
} from '@/api/companion';
import { applyClientAction } from './applyClientAction';

/**
 * useApprovalCard - the logic behind one `propose_action` approval, without
 * the look. `ApprovalCard` renders it as the product's own chat card;
 * card-native surfaces render the same approve / reject verbs their own way.
 */
export interface ApprovalCardModel {
  busy: 'approve' | 'reject' | null;
  /** The approve / reject call threw. */
  error: string | null;
  /** Approved, but the underlying action failed (its message, prefix stripped). */
  failedOutcome: string | null;
  /** The params JSON, pretty-printed (raw on a parse failure). */
  prettyParams: string;
  approve: () => Promise<void>;
  reject: () => Promise<void>;
}

export function useApprovalCard(
  approval: PendingApproval,
  onResolved: (id: string, status: ApprovalOutcome['status']) => void,
): ApprovalCardModel {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedOutcome, setFailedOutcome] = useState<string | null>(null);

  const handle = useCallback(
    async (kind: 'approve' | 'reject') => {
      setBusy(kind);
      setError(null);
      setFailedOutcome(null);
      try {
        if (kind === 'approve') {
          const result = await companionApproveAction(approval.id);
          if (result.status === 'approved_failed') {
            setFailedOutcome(result.message);
            setBusy(null);
            return;
          }
          // UI-only ops (open_route) carry their follow-up here; we
          // dispatch BEFORE marking resolved so the panel collapses
          // smoothly rather than re-rendering with the card disappearing.
          if (result.clientAction) {
            applyClientAction(result.clientAction);
          }
        } else {
          await companionRejectAction(approval.id);
        }
        onResolved(approval.id, kind === 'approve' ? 'approved' : 'rejected');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(null);
      }
    },
    [approval.id, onResolved],
  );

  // Pretty-print the JSON params; fall back to raw on parse failure.
  const prettyParams = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(approval.paramsJson), null, 2);
    } catch {
      return approval.paramsJson;
    }
  }, [approval.paramsJson]);

  const approve = useCallback(() => handle('approve'), [handle]);
  const reject = useCallback(() => handle('reject'), [handle]);

  return {
    busy,
    error,
    failedOutcome: failedOutcome ? failedOutcome.replace(/^Execution failed:\s*/i, '') : null,
    prettyParams,
    approve,
    reject,
  };
}
