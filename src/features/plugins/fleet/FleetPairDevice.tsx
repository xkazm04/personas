import { useState, useCallback } from 'react';
import { Smartphone, QrCode, RefreshCw, Copy, Check, Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';

/**
 * "Pair a device" — stage 1 of the mobile companion pairing flow.
 *
 * This is intentionally a UI scaffold: it mints an ephemeral local pairing
 * code and shows the endpoint a phone would dial, with explainer copy and a
 * QR placeholder. The actual secure handshake (relay/P2P), live QR encoding,
 * and the mobile client are architect-scale and ship in a later stage — so
 * this carries no new dependency and no backend call. The one durable
 * promise it makes is the product's hard rule: credentials stay on-device.
 */

function genToken(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export function FleetPairDevice() {
  const { t } = useTranslation();
  const port = useSystemStore((s) => s.fleetHookPort);
  const [token, setToken] = useState(genToken);
  const [copied, setCopied] = useState(false);

  const endpoint = `127.0.0.1:${port || '—'}`;

  const regenerate = useCallback(() => {
    setToken(genToken());
    setCopied(false);
  }, []);

  const copy = useCallback(() => {
    navigator.clipboard
      .writeText(`${endpoint}|${token}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(silentCatch('FleetPairDevice:copy'));
  }, [endpoint, token]);

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-pair-device"
    >
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-primary" aria-hidden="true" />
        <p className="typo-caption font-medium text-foreground">{t.plugins.fleet.pair_title}</p>
        <span className="ml-1 rounded-interactive border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
          {t.plugins.fleet.pair_preview_badge}
        </span>
      </div>
      <p className="text-[12px] text-foreground leading-relaxed mb-3">{t.plugins.fleet.pair_desc}</p>

      <div className="flex flex-col sm:flex-row gap-4">
        {/* QR placeholder */}
        <div
          className="flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-1.5 rounded-modal border border-dashed border-primary/20 bg-background/60 text-center"
          aria-hidden="true"
        >
          <QrCode className="w-8 h-8 text-foreground opacity-40" />
          <span className="px-2 text-[10px] text-foreground">{t.plugins.fleet.pair_qr_placeholder}</span>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="typo-label uppercase tracking-wider text-foreground mb-0.5">
              {t.plugins.fleet.pair_token_label}
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded-input border border-primary/15 bg-background/60 px-2 py-1 font-mono text-[13px] tracking-widest text-foreground">
                {token}
              </code>
              <button
                type="button"
                data-testid="fleet-pair-copy"
                onClick={copy}
                aria-label={copied ? t.plugins.fleet.pair_copied : t.plugins.fleet.pair_copy}
                title={copied ? t.plugins.fleet.pair_copied : t.plugins.fleet.pair_copy}
                className="rounded-interactive p-1.5 text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                data-testid="fleet-pair-regenerate"
                onClick={regenerate}
                aria-label={t.plugins.fleet.pair_regenerate}
                title={t.plugins.fleet.pair_regenerate}
                className="rounded-interactive p-1.5 text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <p className="typo-label uppercase tracking-wider text-foreground mb-0.5">
              {t.plugins.fleet.pair_endpoint_label}
            </p>
            <code className="font-mono text-[12px] text-foreground">{endpoint}</code>
          </div>

          <p className="flex items-start gap-1.5 text-[11px] text-foreground">
            <Lock className="mt-0.5 w-3 h-3 shrink-0 text-emerald-400" aria-hidden="true" />
            <span>{t.plugins.fleet.pair_credentials_note}</span>
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-foreground leading-relaxed">{t.plugins.fleet.pair_preview_note}</p>
    </div>
  );
}
