import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, KeyRound, RefreshCw, Terminal } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { listCliSpecs, refreshCredentialCliNow, type CliSpecInfo } from '@/api/auth/cliCapture';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useVaultStore } from '@/stores/vaultStore';
import { STATUS_PALETTE, type StatusToken } from '@/lib/design/statusTokens';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { ATTENTION_REASON_KEY, type ConnectorAttentionItem, type ConnectorAttentionKind } from '@/lib/credentials/connectorAttention';
import { useConnectorAttention } from './useConnectorAttention';

const KIND_TONE: Record<ConnectorAttentionKind, StatusToken> = {
  reauth: STATUS_PALETTE.error,
  cli_expired: STATUS_PALETTE.warning,
  healthcheck_failed: STATUS_PALETTE.warning,
};

const KIND_ICON: Record<ConnectorAttentionKind, typeof AlertTriangle> = {
  reauth: KeyRound,
  cli_expired: Terminal,
  healthcheck_failed: AlertTriangle,
};

/**
 * Structured "needs attention" list at the top of the Connections list.
 *
 * Replaced the stack of one-yellow-alert-per-credential re-auth banners
 * (ReauthBanner). Items are derived from persisted credential state
 * (`deriveConnectorAttention`), so there is no dismiss: a row leaves the list
 * when its connector is healthy again or deleted. The same derivation feeds
 * the pinned section of the notification tray, so the two never disagree.
 */
export function ConnectorAttentionList({ onOpen }: { onOpen: (credentialId: string) => void }) {
  const { t, tx } = useTranslation();
  const a = t.vault.connector_attention;
  const items = useConnectorAttention();

  // Lazily fetch CLI specs the first time a CLI-sourced item appears, so the
  // row can show the spec's login instruction (e.g. "Run `gcloud auth login`").
  const [cliSpecs, setCliSpecs] = useState<CliSpecInfo[] | null>(null);
  const hasCliItem = items.some((i) => i.kind === 'cli_expired');
  useEffect(() => {
    if (!hasCliItem || cliSpecs !== null) return;
    listCliSpecs().then(setCliSpecs).catch((e) => {
      silentCatch('ConnectorAttentionList:listCliSpecs')(e);
      setCliSpecs([]);
    });
  }, [hasCliItem, cliSpecs]);

  if (items.length === 0) return null;

  const retryCliCapture = async (item: ConnectorAttentionItem) => {
    try {
      await refreshCredentialCliNow(item.credentialId);
      useToastStore.getState().addToast(a.retry_success, 'success', 4000);
      await useVaultStore.getState().fetchCredentials({ force: true });
    } catch (err) {
      toastCatch('ConnectorAttentionList:retryCliCapture')(err);
    }
  };

  return (
    <section
      aria-label={a.title}
      data-testid="connector-attention-list"
      className="mb-3 rounded-card border border-amber-500/20 bg-secondary/20 overflow-hidden"
    >
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10">
        <AlertTriangle className={`w-4 h-4 shrink-0 ${STATUS_PALETTE.warning.text}`} />
        <h3 className="typo-title">{a.title}</h3>
        <span className={`ml-1 px-1.5 rounded-full typo-label tabular-nums ${STATUS_PALETTE.warning.bg} ${STATUS_PALETTE.warning.text}`}>
          {items.length}
        </span>
        <span className="ml-auto typo-caption text-foreground">{a.subtitle}</span>
      </header>
      <ul className="divide-y divide-primary/5">
        {items.map((item) => {
          const tone = KIND_TONE[item.kind];
          const Icon = KIND_ICON[item.kind];
          const spec = item.kind === 'cli_expired'
            ? cliSpecs?.find((s) => s.service_type === item.serviceType) ?? null
            : null;
          return (
            <li
              key={item.credentialId}
              data-testid="connector-attention-row"
              className="flex items-start gap-3 px-4 py-2.5"
            >
              <span className={`mt-0.5 shrink-0 p-1 rounded-interactive ${tone.bg}`}>
                <Icon className={`w-3.5 h-3.5 ${tone.text}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="typo-card-label truncate">{item.credentialName}</span>
                  <span className="typo-caption text-foreground truncate">{item.serviceType}</span>
                </div>
                <div className={`typo-caption ${tone.text}`}>{a[ATTENTION_REASON_KEY[item.kind]]}</div>
                {item.detail && (
                  <div className="typo-caption text-foreground break-words line-clamp-2">{item.detail}</div>
                )}
                {spec && <div className="typo-caption text-foreground">{spec.auth_instruction}</div>}
              </div>
              <div className="shrink-0 self-center">
                {item.kind === 'cli_expired' ? (
                  <AsyncButton
                    size="xs"
                    variant="secondary"
                    icon={<RefreshCw className="w-3 h-3" />}
                    onClick={() => retryCliCapture(item)}
                  >
                    {a.retry_capture}
                  </AsyncButton>
                ) : (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => onOpen(item.credentialId)}
                    data-testid="reauth-reconnect"
                    aria-label={tx(a.open_aria, { name: item.credentialName })}
                  >
                    {item.kind === 'reauth' ? a.reconnect : a.review}
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
