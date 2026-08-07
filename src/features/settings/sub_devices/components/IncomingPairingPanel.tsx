/**
 * Responder side: pairings another device asked for, awaiting a decision HERE.
 *
 * Populated by the `network:device-pairing-requested` event, and by
 * `list_pending_device_pairings` on mount for the case where this app was
 * closed when the request arrived. Renders nothing when there is nothing to
 * decide — an empty state here would be noise on a page that already has one.
 */
import { ShieldQuestion } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevicePairingRequest } from '@/api/network/devices';
import { FingerprintCode } from './FingerprintCode';

interface IncomingPairingPanelProps {
  requests: DevicePairingRequest[];
  isBusy: (peerId: string) => boolean;
  onConfirm: (peerId: string, displayName: string) => void;
  onDecline: (peerId: string, displayName: string) => void;
}

export function IncomingPairingPanel({
  requests,
  isBusy,
  onConfirm,
  onDecline,
}: IncomingPairingPanelProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;

  if (requests.length === 0) return null;

  return (
    <SectionCard
      title={st.incoming_title}
      subtitle={st.incoming_body}
      icon={<ShieldQuestion className="w-4 h-4 text-cyan-400" />}
      titleClassName="text-primary"
    >
      <ul data-testid="incoming-pairings" className="space-y-2">
        {requests.map((request) => (
          <li
            key={request.peerId}
            data-testid={`incoming-pairing-${request.peerId}`}
            className="rounded-modal border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="typo-body font-medium text-foreground truncate">
                  {tx(st.incoming_from, { device: request.displayName })}
                </p>
                <UuidLabel value={request.peerId} />
              </div>
              <FingerprintCode
                fingerprint={request.fingerprint}
                data-testid={`incoming-fingerprint-${request.peerId}`}
              />
            </div>

            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="secondary"
                size="sm"
                data-testid={`incoming-decline-${request.peerId}`}
                disabled={isBusy(request.peerId)}
                onClick={() => onDecline(request.peerId, request.displayName)}
              >
                {st.incoming_decline}
              </Button>
              <AsyncButton
                variant="primary"
                size="sm"
                isLoading={isBusy(request.peerId)}
                data-testid={`incoming-confirm-${request.peerId}`}
                onClick={() => onConfirm(request.peerId, request.displayName)}
              >
                {st.incoming_confirm}
              </AsyncButton>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
