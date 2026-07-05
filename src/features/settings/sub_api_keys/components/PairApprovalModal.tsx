/**
 * Cloud-app pairing approval gate (Direction 1). Surfaces `personas://pair` /
 * `POST /pair/request` pairing requests and requires an explicit Approve/Reject —
 * nothing is minted without the user's click. On approve, the backend mints an
 * origin-bound, scoped, expiring key the cloud app claims once. Mounted once at
 * the app root (mirrors RemoteApprovalPrompt).
 */
import { useCallback, useEffect, useState } from 'react';
import { Globe, ShieldCheck, AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import {
  listPendingPairings,
  approvePairing,
  rejectPairing,
  type PendingPairingView,
} from '@/api/auth/pairing';

// Arm-delay before Approve is clickable — approving grants a remote origin
// access, so guard against an accidental one-click / double-tap.
const APPROVE_ARM_DELAY_MS = 450;
const EXPIRY_OPTIONS = [7, 30, 90] as const;

export default function PairApprovalModal() {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const [queue, setQueue] = useState<PendingPairingView[]>([]);
  const [scopes, setScopes] = useState<Set<string>>(() => new Set());
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const current = queue[0];
  const nonce = current?.nonce;

  // Catch pairings that arrived before this mounted.
  useEffect(() => {
    listPendingPairings()
      .then(setQueue)
      .catch(() => {});
  }, []);

  const enqueue = useCallback(
    (e: { payload: PendingPairingView }) =>
      setQueue((q) => (q.some((p) => p.nonce === e.payload.nonce) ? q : [...q, e.payload])),
    [],
  );
  useTauriEvent<PendingPairingView>('pairing-requested', enqueue);

  // Per-request reset: default scopes to everything requested; disarm Approve.
  useEffect(() => {
    if (!current) return;
    setScopes(new Set(current.requested_scopes));
    setExpiresInDays(30);
    setBusy(false);
    setArmed(false);
    const tid = setTimeout(() => setArmed(true), APPROVE_ARM_DELAY_MS);
    return () => clearTimeout(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (!current) return null;

  const dequeue = () => setQueue((q) => q.filter((p) => p.nonce !== current.nonce));
  const isHttps = current.origin.startsWith('https://');

  const toggleScope = (scope: string) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  const onApprove = async () => {
    setBusy(true);
    try {
      await approvePairing(current.nonce, [...scopes], expiresInDays);
      dequeue();
    } catch (e) {
      toastCatch('PairApprovalModal:approve')(e);
      setBusy(false);
    }
  };

  const onReject = async () => {
    setBusy(true);
    try {
      await rejectPairing(current.nonce);
      dequeue();
    } catch (e) {
      toastCatch('PairApprovalModal:reject')(e);
      setBusy(false);
    }
  };

  return (
    <BaseModal isOpen onClose={dequeue} titleId="pair-approval-title" size="sm" portal>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-2 typo-caption font-medium text-sky-300">
          <Globe className="w-3.5 h-3.5" />
          {s.pair_title}
        </div>

        <div>
          <h2 id="pair-approval-title" className="typo-body-lg font-semibold text-foreground break-all">
            {current.app_name}
          </h2>
          <p className="typo-caption text-foreground break-all mt-0.5">{current.origin}</p>
          {!isHttps && (
            <div className="flex items-center gap-1.5 typo-caption text-amber-400 mt-2">
              <AlertTriangle size={12} />
              {s.pair_insecure_origin}
            </div>
          )}
        </div>

        <p className="typo-body text-foreground">{s.pair_body}</p>

        <div className="space-y-1.5">
          <p className="typo-caption font-medium text-foreground uppercase tracking-wide">
            {s.pair_scopes_label}
          </p>
          {current.requested_scopes.length === 0 ? (
            <p className="typo-caption text-foreground bg-secondary/30 rounded-card p-2">{s.pair_no_scopes}</p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {current.requested_scopes.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  disabled={busy}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-input border transition-colors disabled:opacity-50 ${
                    scopes.has(scope) ? 'border-primary/40 bg-primary/10' : 'border-border/30 bg-secondary/20'
                  }`}
                >
                  <input type="checkbox" checked={scopes.has(scope)} readOnly tabIndex={-1} />
                  <code className="typo-code text-foreground truncate">{scope}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="typo-caption font-medium text-foreground uppercase tracking-wide">
            {s.field_expiry_label}
          </p>
          <div className="flex gap-1.5">
            {EXPIRY_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setExpiresInDays(days)}
                disabled={busy}
                className={`flex-1 px-2 py-1.5 rounded-interactive typo-caption border transition-colors disabled:opacity-50 ${
                  expiresInDays === days
                    ? 'border-primary/50 bg-primary/15 text-foreground'
                    : 'border-border/30 bg-secondary/30 text-foreground'
                }`}
              >
                {days === 7 ? s.expiry_7d : days === 30 ? s.expiry_30d : s.expiry_90d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-card border border-emerald-500/15 bg-emerald-500/5 p-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
          <p className="typo-caption text-foreground">{s.pair_safety_note}</p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={dequeue} disabled={busy}>
            {s.pair_later}
          </Button>
          <Button
            variant="ghost"
            className="text-red-300 hover:bg-red-500/10"
            onClick={() => void onReject()}
            disabled={busy}
          >
            {s.pair_reject}
          </Button>
          <Button variant="primary" onClick={() => void onApprove()} loading={busy} disabled={!armed}>
            {s.pair_approve}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
