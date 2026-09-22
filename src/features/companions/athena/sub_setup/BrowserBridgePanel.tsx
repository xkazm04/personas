import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { browserBridgeRegenerateToken, browserBridgeStatus } from '@/api/companion';
import type { BrowserBridgeStatus } from '@/lib/bindings/BrowserBridgeStatus';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Companion Setup → Browser testing: pairing surface for the Athena Browser
 * Bridge extension. Shows live connection state, the bridge port, and the
 * pairing token (copyable, rotatable). Polls while mounted so plugging the
 * extension in flips the status chip without a manual refresh.
 */
export function BrowserBridgePanel() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [status, setStatus] = useState<BrowserBridgeStatus | null>(null);
  const [rotating, setRotating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await browserBridgeStatus());
    } catch (e) {
      silentCatch('BrowserBridgePanel:status')(e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const rotate = async () => {
    setRotating(true);
    try {
      await browserBridgeRegenerateToken();
      await refresh();
    } catch (e) {
      toastCatch('BrowserBridgePanel:rotate')(e);
    } finally {
      setRotating(false);
    }
  };

  const connected = status?.extensionConnected ?? false;

  return (
    <div data-testid="companion-browser-bridge-panel">
      <SectionCard title={c.browser_bridge_title} titleClassName="text-primary">
      <p className="typo-caption text-foreground/70">{c.browser_bridge_desc}</p>

      <div className="mt-3 flex items-center gap-2" data-testid="browser-bridge-status">
        <span
          className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-status-success' : 'bg-foreground/25'}`}
        />
        <span className="typo-body">
          {connected
            ? c.browser_bridge_status_connected
            : c.browser_bridge_status_disconnected}
        </span>
      </div>

      <dl className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <dt className="typo-caption w-28 shrink-0">{c.browser_bridge_port}</dt>
          <dd className="typo-body font-mono">{status?.port ?? '—'}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="typo-caption w-28 shrink-0">{c.browser_bridge_token}</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            <code className="truncate rounded-interactive bg-secondary/60 px-2 py-0.5 typo-caption">
              {status?.pairingToken ?? '…'}
            </code>
            {status?.pairingToken && <CopyButton text={status.pairingToken} />}
            {status && !status.envOverride && (
              <AsyncButton
                size="sm"
                variant="ghost"
                isLoading={rotating}
                onClick={rotate}
                data-testid="browser-bridge-regenerate"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {c.browser_bridge_regenerate}
              </AsyncButton>
            )}
          </dd>
        </div>
      </dl>

      {status?.envOverride && (
        <p className="mt-2 typo-caption text-status-warning">
          {c.browser_bridge_env_override}
        </p>
      )}
      <p className="mt-3 typo-caption text-foreground/60">{c.browser_bridge_hint}</p>
      </SectionCard>
    </div>
  );
}
