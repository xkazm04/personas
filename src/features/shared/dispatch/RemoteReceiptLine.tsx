// RemoteReceiptLine — what a finished remote session handed back, in one line:
// the branch, the short SHA, and whether THIS device could confirm it.
//
// The verdict comes from `receiptVerdict` (`@/lib/network/remoteSessionModel`):
// the SHA is read from `git ls-remote` on the running device, and "verified"
// means this device fetched the branch and found that commit. "Could not
// verify" (no local checkout) is deliberately calm, not an error - it says
// nothing is wrong with the work, only that this machine cannot look.
//
// One component for the Monitor's remote tile and drawer and for Settings ->
// Devices, so the three places cannot describe the same receipt differently.

import { CheckCircle2, CircleAlert, CircleDashed, GitBranch, XCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSessionJobReceipt } from '@/lib/bindings/FleetSessionJobReceipt';
import { receiptVerdict, shortSha, type ReceiptVerdict } from '@/lib/network/remoteSessionModel';

const VERDICT_TONE: Record<ReceiptVerdict, { icon: typeof CheckCircle2; tone: string }> = {
  verified: { icon: CheckCircle2, tone: 'text-status-success' },
  unverified: { icon: XCircle, tone: 'text-status-error' },
  could_not_verify: { icon: CircleDashed, tone: 'text-foreground' },
  not_pushed: { icon: CircleDashed, tone: 'text-foreground' },
  push_failed: { icon: CircleAlert, tone: 'text-status-warning' },
};

export function RemoteReceiptLine({ receipt, className = '' }: {
  receipt: FleetSessionJobReceipt;
  className?: string;
}) {
  const { t, tx } = useTranslation();
  const verdict = receiptVerdict(receipt);
  const label: Record<ReceiptVerdict, string> = {
    verified: t.common.dispatch_receipt_verified,
    unverified: t.common.dispatch_receipt_unverified,
    could_not_verify: t.common.dispatch_receipt_could_not_verify,
    not_pushed: t.common.dispatch_receipt_not_pushed,
    push_failed: t.common.dispatch_receipt_push_failed,
  };
  const sha = shortSha(receipt.pushedSha);
  const { icon: Icon, tone } = VERDICT_TONE[verdict];
  const detail = tx(t.common.dispatch_receipt_detail, { branch: receipt.branch, sha: sha ?? '-' });

  return (
    <Tooltip content={<span className="whitespace-pre-line">{receipt.pushError ? `${detail}\n${receipt.pushError}` : detail}</span>}>
      <span
        className={`inline-flex min-w-0 items-center gap-1 ${className}`}
        data-testid="remote-receipt"
        data-verdict={verdict}
      >
        <GitBranch className="h-3 w-3 flex-shrink-0 text-foreground" aria-hidden />
        <span className="min-w-0 truncate font-mono">{receipt.branch}</span>
        {sha && <span className="flex-shrink-0 font-mono text-foreground">{sha}</span>}
        <span className={`inline-flex flex-shrink-0 items-center gap-0.5 ${tone}`}>
          <Icon className="h-3 w-3" aria-hidden />
          {label[verdict]}
        </span>
      </span>
    </Tooltip>
  );
}

export default RemoteReceiptLine;
