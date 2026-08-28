import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Smartphone, QrCode, Copy, Check, Lock, ShieldOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import {
  pairDevice,
  companionDevices,
  revokeCompanionDevice,
  type FleetPairResult,
  type FleetCompanionStatus,
} from '@/api/fleet/fleet';
import { useNowTick, formatAgo } from './relativeAgo';

/**
 * "Pair a device" — the real pairing flow for Fleet Command Anywhere.
 *
 * Calls `fleet_pair_device`: the backend mints a device-scoped token, stores
 * only its SHA-256 fingerprint, starts the LAN-only companion server, and
 * returns a genuine QR (companion URL with the token in the fragment). The
 * token is displayed exactly once — regenerating means pairing a new device.
 * Below the QR, the paired-device list gives per-device revocation.
 *
 * The one durable promise stays: credentials never leave this desktop — the
 * phone receives status projections and sends allowlisted verdicts only.
 */

export function FleetPairDevice() {
  const { t } = useTranslation();
  const now = useNowTick();
  const [pair, setPair] = useState<FleetPairResult | null>(null);
  const [status, setStatus] = useState<FleetCompanionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshDevices = useCallback(() => {
    companionDevices()
      .then(setStatus)
      .catch(silentCatch('FleetPairDevice:devices'));
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const generate = useCallback(() => {
    setBusy(true);
    setError(false);
    setCopied(false);
    pairDevice()
      .then((res) => {
        setPair(res);
        refreshDevices();
      })
      .catch((e) => {
        setError(true);
        silentCatch('FleetPairDevice:pair')(e);
      })
      .finally(() => setBusy(false));
  }, [refreshDevices]);

  // The 1.5s copy confirmation outlives the component if the operator navigates
  // away right after copying. Holding the handle in a ref lets the unmount
  // effect below clear it — this component displays a one-time-use pairing
  // token, so it is exactly the wrong place to leave a callback holding a
  // closure over its state after it is gone. Re-copying also cancels the
  // previous window rather than stacking a second one.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(() => {
    if (!pair) return;
    copyText(pair.url)
      .then(() => {
        setCopied(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => {
          copiedTimer.current = null;
          setCopied(false);
        }, 1500);
      })
      .catch(silentCatch('FleetPairDevice:copy'));
  }, [pair]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // Revocation is a SECURITY action: the operator clicks Revoke to cut a
  // phone's access and then walks away. Swallowing the failure silently is the
  // one outcome we cannot afford — the row keeps rendering its Revoke button
  // unchanged, refreshDevices never runs, and the operator believes a device is
  // disconnected while it is still paired. toastCatch is the door the repo
  // reserves for exactly this: a failure the user must be told about.
  const revoke = useCallback(
    (deviceId: string) => {
      revokeCompanionDevice(deviceId)
        .then(() => refreshDevices())
        .catch(toastCatch('FleetPairDevice:revoke', t.plugins.fleet.pair_revoke_error));
    },
    [refreshDevices, t],
  );

  const qrDataUri = useMemo(
    () => (pair ? `data:image/svg+xml;utf8,${encodeURIComponent(pair.qrSvg)}` : null),
    [pair],
  );

  const devices = status?.devices ?? [];

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-pair-device"
    >
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-primary" aria-hidden="true" />
        <p className="typo-caption font-medium text-foreground">{t.plugins.fleet.pair_title}</p>
        <span className="ml-1 rounded-interactive border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[12px] uppercase tracking-wider text-emerald-300">
          {t.plugins.fleet.pair_lan_badge}
        </span>
      </div>
      <p className="text-[14px] text-foreground leading-relaxed mb-3">{t.plugins.fleet.pair_desc}</p>

      <div className="flex flex-col sm:flex-row gap-4">
        {/* QR — real once paired, honest empty state before */}
        {qrDataUri ? (
          <img
            src={qrDataUri}
            alt={t.plugins.fleet.pair_qr_alt}
            data-testid="fleet-pair-qr"
            className="h-32 w-32 shrink-0 rounded-modal border border-primary/20"
          />
        ) : (
          <div
            className="flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-1.5 rounded-modal border border-dashed border-primary/20 bg-background/60 text-center"
            aria-hidden="true"
          >
            <QrCode className="w-8 h-8 text-foreground opacity-40" />
            <span className="px-2 text-[12px] text-foreground">
              {t.plugins.fleet.pair_qr_placeholder}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <button
            type="button"
            data-testid="fleet-pair-generate"
            onClick={generate}
            disabled={busy}
            className="rounded-interactive border border-primary/25 bg-primary/10 px-3 py-1.5 text-[14px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          >
            {busy ? t.plugins.fleet.pair_generating : t.plugins.fleet.pair_generate}
          </button>
          {/* role="alert" so a screen-reader user is TOLD the pairing failed.
              Without it the only signal is a colour change they cannot see. */}
          {error ? (
            <p role="alert" className="text-[13px] text-red-300">
              {t.plugins.fleet.pair_error_generic}
            </p>
          ) : null}

          {pair ? (
            <>
              <div>
                <p className="typo-label text-foreground mb-0.5">
                  {t.plugins.fleet.pair_url_label}
                </p>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="truncate rounded-input border border-primary/15 bg-background/60 px-2 py-1 font-mono text-[13px] text-foreground">
                    {pair.url}
                  </code>
                  <button
                    type="button"
                    data-testid="fleet-pair-copy"
                    onClick={copy}
                    aria-label={copied ? t.plugins.fleet.pair_copied : t.plugins.fleet.pair_copy}
                    title={copied ? t.plugins.fleet.pair_copied : t.plugins.fleet.pair_copy}
                    className="shrink-0 rounded-interactive p-1.5 text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-[13px] text-foreground">{t.plugins.fleet.pair_token_once}</p>
              </div>
              <p className="text-[13px] text-foreground leading-relaxed">
                {t.plugins.fleet.pair_scan_hint}
              </p>
            </>
          ) : null}

          <p className="flex items-start gap-1.5 text-[13px] text-foreground">
            <Lock className="mt-0.5 w-3 h-3 shrink-0 text-emerald-400" aria-hidden="true" />
            <span>{t.plugins.fleet.pair_credentials_note}</span>
          </p>
        </div>
      </div>

      {/* Paired devices */}
      <div className="mt-4 border-t border-primary/10 pt-3">
        <p className="typo-label text-foreground mb-1.5">
          {t.plugins.fleet.pair_devices_title}
        </p>
        {devices.length === 0 ? (
          <p className="text-[13px] text-foreground">{t.plugins.fleet.pair_no_devices}</p>
        ) : (
          <ul className="space-y-1" data-testid="fleet-pair-devices">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-interactive border border-primary/10 bg-background/40 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <span className="text-[14px] text-foreground">{d.name}</span>
                  <span className="ml-2 text-[12px] text-foreground opacity-70">
                    {d.lastSeenMs > 0
                      ? formatAgo(t, d.lastSeenMs, now)
                      : t.plugins.fleet.pair_never_connected}
                  </span>
                </div>
                {d.revoked ? (
                  <span className="shrink-0 rounded-interactive border border-primary/10 px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-foreground opacity-60">
                    {t.plugins.fleet.pair_revoked_badge}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid={`fleet-pair-revoke-${d.id}`}
                    onClick={() => revoke(d.id)}
                    className="flex shrink-0 items-center gap-1 rounded-interactive border border-red-400/25 bg-red-400/10 px-2 py-0.5 text-[12px] text-red-300 transition-colors hover:bg-red-400/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                  >
                    <ShieldOff className="w-3 h-3" aria-hidden="true" />
                    {t.plugins.fleet.pair_revoke}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
