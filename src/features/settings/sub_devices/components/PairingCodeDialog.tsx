/**
 * Initiator side of the ceremony: shows the code this device derived and waits
 * for the human on the OTHER device to confirm. Modal on purpose — the operator
 * has to carry these six digits to another screen, and a dismissable inline
 * card invites losing them.
 */
import { AsyncButton } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevicePairingRequest } from '@/api/network/devices';
import { FingerprintCode } from './FingerprintCode';

interface PairingCodeDialogProps {
  request: DevicePairingRequest | null;
  busy: boolean;
  onCancel: (peerId: string, displayName: string) => void;
}

export function PairingCodeDialog({ request, busy, onCancel }: PairingCodeDialogProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;

  return (
    <BaseModal
      isOpen={request !== null}
      onClose={() => request && onCancel(request.peerId, request.displayName)}
      titleId="device-pairing-code-title"
      size="sm"
      portal
    >
      {request && (
        <div data-testid="pairing-code-dialog" className="p-6 space-y-4 text-center">
          <h2 id="device-pairing-code-title" className="typo-title text-foreground">
            {st.pairing_code_title}
          </h2>
          <p className="typo-caption text-foreground">
            {tx(st.pairing_code_body, { device: request.displayName })}
          </p>

          <div className="rounded-modal border border-border bg-secondary/20 py-5">
            <FingerprintCode fingerprint={request.fingerprint} />
          </div>

          <p className="flex items-center justify-center gap-2 typo-caption text-foreground">
            <LoadingSpinner size="sm" className="text-foreground" />
            {st.pairing_code_waiting}
          </p>

          <AsyncButton
            variant="secondary"
            block
            isLoading={busy}
            data-testid="pairing-code-cancel"
            onClick={() => onCancel(request.peerId, request.displayName)}
          >
            {st.pairing_cancel}
          </AsyncButton>
        </div>
      )}
    </BaseModal>
  );
}
