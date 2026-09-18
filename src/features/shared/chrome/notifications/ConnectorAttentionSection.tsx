import { AlertTriangle, ChevronRight, KeyRound, Terminal } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';
import { ATTENTION_REASON_KEY, type ConnectorAttentionKind } from '@/lib/credentials/connectorAttention';
import {
  openConnectorForAttention,
  useConnectorAttention,
} from '@/features/vault/sub_credentials/components/card/attention/useConnectorAttention';

const KIND_ICON: Record<ConnectorAttentionKind, typeof AlertTriangle> = {
  reauth: KeyRound,
  cli_expired: Terminal,
  healthcheck_failed: AlertTriangle,
};

/**
 * Pinned "Connections need attention" block at the top of the notification
 * tray.
 *
 * Deliberately NOT a `notificationCenterStore` entry: those are events — they
 * are marked read on open, cleared by "Clear all", dismissed per row and aged
 * out after 7 days, all of which would hide a connector that is still broken.
 * This block is state: it is derived from the vault store on every render, has
 * no dismiss, and disappears only when the connector is healthy or deleted.
 */
export function ConnectorAttentionSection() {
  const { t, tx } = useTranslation();
  const a = t.vault.connector_attention;
  const items = useConnectorAttention();
  if (items.length === 0) return null;

  return (
    <section
      aria-label={a.title}
      data-testid="notification-connector-attention"
      className="rounded-card border border-amber-500/20 bg-amber-500/5"
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <AlertTriangle className={`w-4 h-4 shrink-0 ${STATUS_PALETTE.warning.text}`} />
        <h3 className="typo-title">{a.title}</h3>
        <span className={`ml-auto typo-label tabular-nums ${STATUS_PALETTE.warning.text}`}>
          {items.length}
        </span>
      </header>
      <ul className="pb-1.5">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          const tone = item.kind === 'reauth' ? STATUS_PALETTE.error : STATUS_PALETTE.warning;
          return (
            <li key={item.credentialId}>
              <button
                type="button"
                onClick={() => openConnectorForAttention(item.credentialId)}
                aria-label={tx(a.open_aria, { name: item.credentialName })}
                className="group w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-secondary/30 transition-colors focus-ring"
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${tone.text}`} />
                <span className="min-w-0 flex-1">
                  <span className="block typo-card-label truncate">{item.credentialName}</span>
                  <span className={`block typo-caption truncate ${tone.text}`}>{a[ATTENTION_REASON_KEY[item.kind]]}</span>
                </span>
                <span className="shrink-0 inline-flex items-center gap-0.5 typo-caption text-primary">
                  {a.open_connections}
                  <ChevronRight className="w-3 h-3" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
