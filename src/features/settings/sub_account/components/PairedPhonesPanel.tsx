import { useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, ShieldOff, QrCode } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import {
  cancelControllerPairing,
  listCloudControllers,
  pollControllerPairing,
  revokeCloudController,
  startControllerPairing,
} from '@/api/cloudSync';
import type { CloudController } from '@/lib/bindings/CloudController';
import type { CloudPairingStart } from '@/lib/bindings/CloudPairingStart';
import type { CloudPairingState } from '@/lib/bindings/CloudPairingState';

/** The ceremony's poll cadence while the QR is up (PHASE2-SPEC 3.2 step 3). */
const PAIRING_POLL_MS = 2000;
/** Matches `cloud::trust::MAX_CONTROLLERS`; the backend refuses the ninth anyway. */
const MAX_PHONES = 8;

type RevokeTarget = { id: string | null; name: string };

/**
 * Paired phones of the mobile command plane, inside Settings > Cloud sync.
 *
 * "Pair a phone" shows a QR the phone scans while signed in to personas.so; the
 * desktop polls every 2 s, verifies the phone's proof and stores its public key.
 * A paired phone's pause / resume / cancel / run commands then run here with no
 * prompt, so the list's Revoke and Revoke all are the operator's brake. Rendered
 * only while sync is on (the parent gates it).
 */
export default function PairedPhonesPanel() {
  const { t } = useTranslation();
  const s = t.settings.account;
  const [phones, setPhones] = useState<CloudController[]>([]);
  const [pairing, setPairing] = useState<CloudPairingStart | null>(null);
  const [outcome, setOutcome] = useState<CloudPairingState | null>(null);
  const [starting, setStarting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPhones(await listCloudControllers());
    } catch (e) {
      toastCatch('PairedPhonesPanel:list')(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The ceremony: poll while the QR is up, stop on any settled state.
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const poll = await pollControllerPairing(pairing.pairingId);
        if (cancelled) return;
        if (poll.state === 'waiting') {
          timer = setTimeout(() => void tick(), PAIRING_POLL_MS);
          return;
        }
        setOutcome(poll.state);
        setPairing(null);
        if (poll.state === 'paired') {
          useToastStore
            .getState()
            .addToast(interpolate(s.cloud_phones_paired_toast, { name: poll.controllerName ?? '' }), 'success');
          void refresh();
        }
      } catch (e) {
        if (cancelled) return;
        setPairing(null);
        toastCatch('PairedPhonesPanel:poll', s.cloud_phones_pair_failed)(e);
      }
    };
    timer = setTimeout(() => void tick(), PAIRING_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pairing, refresh, s]);

  const startPairing = async () => {
    setStarting(true);
    setOutcome(null);
    try {
      setPairing(await startControllerPairing());
    } catch (e) {
      toastCatch('PairedPhonesPanel:start', s.cloud_phones_pair_failed)(e);
    } finally {
      setStarting(false);
    }
  };

  const stopPairing = () => {
    if (pairing) void cancelControllerPairing(pairing.pairingId).catch(silentCatch('PairedPhonesPanel:cancel'));
    setPairing(null);
    setOutcome(null);
  };

  // Revocation is a SECURITY action: a failure must reach the operator, or
  // they walk away believing a phone is cut off while it is still trusted.
  const confirmRevoke = async () => {
    const target = revokeTarget;
    setRevokeTarget(null);
    if (!target) return;
    try {
      await revokeCloudController(target.id);
    } catch (e) {
      toastCatch('PairedPhonesPanel:revoke', s.cloud_phones_revoke_failed)(e);
    } finally {
      void refresh();
    }
  };

  const qrDataUri = useMemo(
    () => (pairing ? `data:image/svg+xml;utf8,${encodeURIComponent(pairing.qrSvg)}` : null),
    [pairing],
  );
  const active = phones.filter((p) => !p.revoked);
  const atLimit = active.length >= MAX_PHONES;

  return (
    <div className="space-y-3 rounded-card border border-primary/8 bg-secondary/10 p-4" data-testid="paired-phones">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-primary" aria-hidden />
        <p className="typo-heading">{s.cloud_phones_title}</p>
      </div>
      <p className="typo-caption text-foreground">{s.cloud_phones_description}</p>

      {pairing && qrDataUri ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <img
            src={qrDataUri}
            alt={s.cloud_phones_qr_alt}
            data-testid="paired-phones-qr"
            className="h-40 w-40 shrink-0 rounded-card border border-primary/20"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="typo-body text-foreground">{s.cloud_phones_scan}</p>
            <p className="typo-caption text-foreground" role="status">
              {s.cloud_phones_waiting}
            </p>
            <Button variant="secondary" size="sm" onClick={stopPairing}>
              {s.cloud_phones_cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<QrCode className="w-4 h-4" />}
            loading={starting}
            disabled={starting || atLimit}
            onClick={() => {
              void startPairing();
            }}
          >
            {s.cloud_phones_pair}
          </Button>
          {atLimit && <span className="typo-caption text-foreground">{s.cloud_phones_limit}</span>}
          {outcome === 'expired' && (
            <span className="typo-caption text-status-warning" role="alert">
              {s.cloud_phones_expired}
            </span>
          )}
          {outcome === 'refused' && (
            <span className="typo-caption text-status-error" role="alert">
              {s.cloud_phones_refused}
            </span>
          )}
        </div>
      )}

      {phones.length === 0 ? (
        <p className="typo-caption text-foreground">{s.cloud_phones_none}</p>
      ) : (
        <ul className="divide-y divide-primary/8 rounded-card border border-primary/8" data-testid="paired-phones-list">
          {phones.map((p) => (
            <li key={p.controllerId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="typo-body text-foreground truncate">{p.name}</p>
                <p className="typo-caption text-foreground inline-flex items-center gap-1">
                  {p.revoked ? s.cloud_phones_revoked : s.cloud_phones_paired_on}{' '}
                  <RelativeTime timestamp={p.revoked ? (p.revokedAt ?? p.createdAt) : p.createdAt} />
                </p>
              </div>
              {!p.revoked && (
                <Button
                  variant="accent"
                  tone="error"
                  size="xs"
                  icon={<ShieldOff className="w-3.5 h-3.5" />}
                  onClick={() => setRevokeTarget({ id: p.controllerId, name: p.name })}
                >
                  {s.cloud_phones_revoke}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {active.length > 0 && (
        <Button
          variant="accent"
          tone="error"
          size="xs"
          icon={<ShieldOff className="w-3.5 h-3.5" />}
          onClick={() => setRevokeTarget({ id: null, name: '' })}
        >
          {s.cloud_phones_revoke_all}
        </Button>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title={
            revokeTarget.id === null
              ? s.cloud_phones_revoke_all_title
              : interpolate(s.cloud_phones_revoke_title, { name: revokeTarget.name })
          }
          body={revokeTarget.id === null ? s.cloud_phones_revoke_all_body : s.cloud_phones_revoke_body}
          confirmLabel={revokeTarget.id === null ? s.cloud_phones_revoke_all : s.cloud_phones_revoke}
          danger
          onConfirm={confirmRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
