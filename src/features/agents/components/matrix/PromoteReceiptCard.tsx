/**
 * PromoteReceiptCard -- the in-app answer to Promote when the answer is not
 * a clean "ready".
 *
 * `needs_setup` names the connectors the backend verified are still not
 * ready (or, with none, that the first check run could not deliver value) and
 * offers one door to the fix, Design > Connectors, plus "Later" for the old
 * route. `failed` shows the backend's reason with a Retry. `ready` and
 * `in_flight` render nothing: a clean promote keeps its timed redirect.
 */
import { useEffect } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { announceImperative } from "@/features/shared/components/feedback/AriaLiveProvider";
import Button from "@/features/shared/components/buttons/Button";
import AsyncButton from "@/features/shared/components/buttons/AsyncButton";
import { useTranslation, interpolate } from "@/i18n/useTranslation";
import type { PromoteReceipt } from "./promoteReceipt";

interface PromoteReceiptCardProps {
  receipt: PromoteReceipt | null;
  /** needs_setup: open the promoted persona on Design > Connectors. */
  onConnect: () => void;
  /** needs_setup: take today's route (the matrix) instead. */
  onLater: () => void;
  /** failed: run the same promote again. */
  onRetry: () => Promise<unknown>;
  /** failed: hide the card; the build stays at test_complete. */
  onDismiss: () => void;
}

export function PromoteReceiptCard({ receipt, onConnect, onLater, onRetry, onDismiss }: PromoteReceiptCardProps) {
  const { t } = useTranslation();
  const m = t.agents.matrix_entry;
  const needsSetup = receipt?.kind === "needs_setup";

  // The held state is announced through the app-wide live region, which is
  // mounted for the app lifetime, rather than by giving this card a live
  // region of its own: a region born in the same commit as its text is never
  // announced (screen-reader-announcements golden path). The failed card uses
  // role="alert", the documented exception.
  useEffect(() => {
    if (needsSetup) announceImperative(m.promote_receipt_needs_setup_title, "polite");
  }, [needsSetup, m.promote_receipt_needs_setup_title]);

  if (receipt?.kind === "needs_setup") {
    return (
      <div
        data-testid="promote-receipt-needs-setup"
        className="flex items-start gap-3 px-3 py-2.5 rounded-card border border-status-warning/25 bg-status-warning/5 flex-shrink-0"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 text-status-warning flex-shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="typo-heading text-foreground">{m.promote_receipt_needs_setup_title}</span>
          {receipt.connectors.length > 0 && (
            <span className="typo-caption text-foreground">
              {interpolate(m.promote_receipt_connectors, { names: receipt.connectors.join(", ") })}
            </span>
          )}
          {receipt.unverified && (
            <span className="typo-caption text-foreground">{m.promote_receipt_unverified}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onLater} data-testid="promote-receipt-later">
            {m.promote_receipt_later}
          </Button>
          <Button variant="primary" size="sm" onClick={onConnect} data-testid="promote-receipt-connect">
            {m.promote_receipt_connect}
          </Button>
        </div>
      </div>
    );
  }

  if (receipt?.kind === "failed") {
    return (
      <div
        role="alert"
        data-testid="promote-receipt-failed"
        className="flex items-start gap-3 px-3 py-2.5 rounded-card border border-status-error/30 bg-status-error/10 flex-shrink-0"
      >
        <XCircle className="w-4 h-4 mt-0.5 text-status-error flex-shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="typo-heading text-foreground">{m.promote_receipt_failed_title}</span>
          {receipt.message && (
            <span className="typo-caption text-foreground break-words">{receipt.message}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            {t.errors.dismiss_error}
          </Button>
          <AsyncButton variant="secondary" size="sm" onClick={onRetry} data-testid="promote-receipt-retry">
            {m.promote_receipt_retry}
          </AsyncButton>
        </div>
      </div>
    );
  }

  return null;
}
