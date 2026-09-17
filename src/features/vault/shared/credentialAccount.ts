import type { ConnectorDefinition } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/platform/connectors';

/**
 * The provider account an OAuth credential is bound to, as recorded on the
 * credential's ledger (`metadata`) by the backend at save time.
 *
 * Why this is read here and not through `parseCredentialLedger`: the four
 * `account_*` keys are added by the Rust half of this same change, so the
 * generated `CredentialLedger` binding may not carry them yet. The parser
 * spreads unknown keys through untouched, so this is a typing gap, not a data
 * one — and typing it locally keeps the read honest instead of asserting past
 * the binding.
 */
export interface CredentialAccount {
  /** Provider email (e.g. the Google account), or null when never recorded. */
  email: string | null;
  /** Stable provider subject id — survives an email rename. */
  sub: string | null;
  /** Hosted domain, for Workspace accounts. */
  hd: string | null;
  /** Epoch ms of the last successful identity verification. */
  verifiedAt: number | null;
}

const EMPTY_ACCOUNT: CredentialAccount = { email: null, sub: null, hd: null, verifiedAt: null };

interface AccountLedgerFields {
  account_email?: unknown;
  account_sub?: unknown;
  account_hd?: unknown;
  account_verified_at?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/** Read the bound-account identity out of a credential's `metadata` JSON. */
export function readCredentialAccount(metadata: string | null | undefined): CredentialAccount {
  if (!metadata) return { ...EMPTY_ACCOUNT };
  let raw: unknown;
  try {
    raw = JSON.parse(metadata);
  } catch {
    return { ...EMPTY_ACCOUNT };
  }
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_ACCOUNT };
  const ledger = raw as AccountLedgerFields;
  return {
    email: str(ledger.account_email),
    sub: str(ledger.account_sub),
    hd: str(ledger.account_hd),
    verifiedAt: typeof ledger.account_verified_at === 'number' ? ledger.account_verified_at : null,
  };
}

/**
 * Whether a credential can be re-authorized through the in-place Google
 * consent flow. Prefers the vault's own connector predicate; falls back to the
 * service type when the connector definition has not loaded (the re-auth
 * banner can mount before `fetchConnectorDefinitions` resolves).
 */
export function isGoogleReauthTarget(
  connector: ConnectorDefinition | undefined,
  serviceType: string,
): boolean {
  if (connector) return isGoogleOAuthConnector(connector, serviceType);
  const s = serviceType.toLowerCase();
  return s.startsWith('google') || s.startsWith('gmail');
}

/**
 * The backend's refusal when a re-auth consent redeemed a DIFFERENT account
 * than the one the credential is bound to. The old token is kept and
 * `needs_reauth` stays set, so the caller must keep the entry on screen.
 */
export const OAUTH_ACCOUNT_MISMATCH_PREFIX = 'oauth_account_mismatch:';

/**
 * Detect that refusal. Returns the trailing detail (which account came back)
 * when the error is a mismatch, or null when it is any other failure.
 */
export function parseAccountMismatch(err: unknown): { detail: string } | null {
  const raw = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : typeof (err as { message?: unknown })?.message === 'string'
        ? (err as { message: string }).message
        : '';
  const at = raw.indexOf(OAUTH_ACCOUNT_MISMATCH_PREFIX);
  if (at === -1) return null;
  return { detail: raw.slice(at + OAUTH_ACCOUNT_MISMATCH_PREFIX.length).trim() };
}
