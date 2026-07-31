/**
 * Zero-Plaintext Credential Broker — frontend API wrappers.
 *
 * External consumers (fleet sessions, scripts, MCP clients) never hold vault
 * secrets: they hold short-lived, narrowly-scoped handles and route real API
 * calls through the audited `/api/proxy/{credential_id}` route. This module
 * powers the vault Broker surface: consumer list, per-consumer activity,
 * handle minting, and the kill-switch.
 *
 * NOTE on types: the Rust structs (`BrokerConsumerView`, `ApiKeyAuditEntry`,
 * `CreateApiKeyResponse`) are ts-rs exported; the interfaces below mirror
 * their camelCase serialization so this module does not depend on a bindings
 * regeneration step.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/** One observed broker consumer (an external API key that used credentials). */
export interface BrokerConsumer {
  consumerKeyId: string;
  consumerName: string;
  /** Safe display prefix (e.g. "pk_a1b2c3"); null when the key row is gone. */
  keyPrefix: string | null;
  /** True when the key still authenticates (enabled, not revoked). */
  active: boolean;
  revokedAt: string | null;
  expiresAt: string | null;
  credentialIds: string[];
  credentialNames: string[];
  totalCalls: number;
  lastStatus: number | null;
  lastUsedAt: string | null;
}

/** One management-API request a consumer key made (per-key audit trail). */
export interface BrokerConsumerActivityEntry {
  id: string;
  key_id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  persona_id: string | null;
  origin: string | null;
}

/** Response from minting a derived handle — plaintext returned exactly once. */
export interface MintedHandle {
  record: {
    id: string;
    name: string;
    key_prefix: string;
    scopes: string;
    enabled: boolean;
    created_at: string;
    expires_at: string | null;
    label: string | null;
  };
  plaintext_token: string;
}

/** All observed broker consumers, most recently active first. */
export const listBrokerConsumers = () =>
  invoke<BrokerConsumer[]>('list_broker_consumers');

/** Recent request trail for one consumer key (newest first). */
export const listBrokerConsumerActivity = (consumerKeyId: string, limit?: number) =>
  invoke<BrokerConsumerActivityEntry[]>('list_broker_consumer_activity', {
    consumerKeyId,
    limit,
  });

/**
 * Mint a short-lived derived handle for one credential. The returned plaintext
 * is shown once and never retrievable again; the credential's secret is never
 * part of the response. TTL clamps server-side to 5 min .. 24 h (default 60).
 */
export const mintCredentialHandle = (
  credentialId: string,
  consumerName: string,
  ttlMinutes?: number,
) =>
  invoke<MintedHandle>('mint_credential_handle', {
    credentialId,
    consumerName,
    ttlMinutes,
  });

/**
 * Kill-switch: revoke a consumer key. Effective on the consumer's next
 * request; its blast-radius edges drop from the dependents graph immediately.
 */
export const revokeBrokerConsumer = (consumerKeyId: string) =>
  invoke<void>('revoke_broker_consumer', { consumerKeyId });
