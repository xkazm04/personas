import { parseJsonOrDefault } from '@/lib/utils/parseJson';

/**
 * Why a connector needs the user:
 * - `reauth`             — the OAuth grant was revoked at the provider
 * - `cli_expired`        — a CLI-captured credential's terminal session expired
 * - `healthcheck_failed` — the last live probe ran and failed
 */
export type ConnectorAttentionKind = 'reauth' | 'cli_expired' | 'healthcheck_failed';

export interface ConnectorAttentionItem {
  credentialId: string;
  credentialName: string;
  serviceType: string;
  kind: ConnectorAttentionKind;
  /** Last healthcheck message, when the probe left one. */
  detail: string | null;
}

/** The subset of a credential the derivation reads. */
export interface ConnectorAttentionFields {
  id: string;
  name: string;
  service_type: string;
  metadata: string | null;
  healthcheck_last_success: boolean | null;
  healthcheck_last_message: string | null;
}

/** i18n key under `vault.connector_attention` naming each reason. */
export const ATTENTION_REASON_KEY = {
  reauth: 'reason_reauth',
  cli_expired: 'reason_cli_expired',
  healthcheck_failed: 'reason_healthcheck_failed',
} as const satisfies Record<ConnectorAttentionKind, string>;

const KIND_ORDER: Record<ConnectorAttentionKind, number> = {
  reauth: 0,
  cli_expired: 1,
  healthcheck_failed: 2,
};

/**
 * Derive the connectors that need attention from PERSISTED credential state,
 * never from a session event log. That is what makes the list permanent: an
 * item exists exactly as long as its cause does, and disappears on its own
 * when the connector is healthy again (reconnect clears `needs_reauth`, a
 * passing re-test flips `healthcheck_last_success`) or when it is deleted.
 *
 * `healthcheck_last_success` is read directly rather than through
 * `readCredentialHealthState` on purpose: the store mirrors that field the
 * moment a re-test finishes, while the metadata token it prefers is only
 * refreshed by the next full fetch — so the token would keep a just-fixed
 * connector listed. `false` is only ever written for a probe that ran and
 * failed (an unverifiable connector is never `false`).
 */
export function deriveConnectorAttention(
  credentials: readonly ConnectorAttentionFields[],
): ConnectorAttentionItem[] {
  const items: ConnectorAttentionItem[] = [];
  for (const c of credentials) {
    const meta = parseJsonOrDefault<Record<string, unknown> | null>(c.metadata, null);
    let kind: ConnectorAttentionKind | null = null;
    if (meta?.needs_reauth === true) {
      kind = meta.source === 'cli' ? 'cli_expired' : 'reauth';
    } else if (c.healthcheck_last_success === false) {
      kind = 'healthcheck_failed';
    }
    if (!kind) continue;
    items.push({
      credentialId: c.id,
      credentialName: c.name,
      serviceType: c.service_type,
      kind,
      detail: kind === 'healthcheck_failed' ? c.healthcheck_last_message : null,
    });
  }
  return items.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.credentialName.localeCompare(b.credentialName),
  );
}
