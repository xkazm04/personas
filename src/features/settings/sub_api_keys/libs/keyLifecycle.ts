/**
 * Pure verdicts about external API keys, shared by the API Keys page.
 *
 * Moved out of ApiKeysSettings.tsx unchanged so they can be pinned by tests.
 */
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';

// A key is considered "stale" (probably forgotten) when it's older than the
// grace window AND either never used or unused for the inactivity window.
const STALE_GRACE_DAYS = 7;
const STALE_INACTIVE_DAYS = 30;
export const DAY_MS = 86_400_000;

export function isStaleKey(key: ExternalApiKey, now: number = Date.now()): boolean {
  if (key.revoked_at !== null || !key.enabled) return false;
  const created = new Date(key.created_at).getTime();
  if (isNaN(created) || now - created < STALE_GRACE_DAYS * DAY_MS) return false;
  if (key.last_used_at === null) return true;
  const lastUsed = new Date(key.last_used_at).getTime();
  if (isNaN(lastUsed)) return false;
  return now - lastUsed >= STALE_INACTIVE_DAYS * DAY_MS;
}

/** Expiry display for a key. `null` = never expires; otherwise the whole-days delta (negative once expired). */
export function expiryInfo(
  key: ExternalApiKey,
  now: number = Date.now(),
): { expired: boolean; days: number } | null {
  if (!key.expires_at) return null;
  const exp = new Date(key.expires_at).getTime();
  if (isNaN(exp)) return null;
  return { expired: exp <= now, days: Math.ceil((exp - now) / DAY_MS) };
}

// ---------------------------------------------------------------------------
// Key state, mirroring the backend's auth check. `find_by_token`
// (db/repos/resources/external_api_keys.rs) accepts a key only when it is
// enabled, not revoked, and `is_expired_at` is false; an `expires_at` that does
// not parse as a timestamp counts as expired (fail closed). The page must not
// call a key "live" that the server would reject.
// ---------------------------------------------------------------------------

export type KeyState = 'live' | 'expired' | 'revoked';

export function keyState(key: ExternalApiKey, now: number = Date.now()): KeyState {
  if (key.revoked_at !== null || !key.enabled) return 'revoked';
  if (key.expires_at === null) return 'live';
  const exp = Date.parse(key.expires_at);
  if (isNaN(exp) || exp <= now) return 'expired';
  return 'live';
}

/** How many keys can authenticate right now. */
export function liveCount(keys: readonly ExternalApiKey[], now: number = Date.now()): number {
  return keys.filter((k) => keyState(k, now) === 'live').length;
}

export type RetireReason = 'expired' | 'superseded';

export interface RetireCandidate {
  key: ExternalApiKey;
  reason: RetireReason;
}

export interface PairingGroup {
  origin: string;
  /** Every non-revoked pairing for this origin, newest first. */
  keys: ExternalApiKey[];
  /** The newest live pairing, the one the app is using. `null` when none can authenticate. */
  current: ExternalApiKey | null;
  /** Expired pairings, plus live pairings older than `current` (re-pairing never retires them). */
  retirable: RetireCandidate[];
}

const createdMs = (k: ExternalApiKey) => {
  const t = Date.parse(k.created_at);
  return isNaN(t) ? -Infinity : t;
};

/**
 * One group per paired origin. Only origin-bound, non-revoked keys take part:
 * a regular key (no `bound_origin`) is never grouped and so can never be
 * planned for retirement here.
 */
export function groupPairings(
  keys: readonly ExternalApiKey[],
  now: number = Date.now(),
): PairingGroup[] {
  const byOrigin = new Map<string, ExternalApiKey[]>();
  for (const k of keys) {
    if (!k.bound_origin || keyState(k, now) === 'revoked') continue;
    const list = byOrigin.get(k.bound_origin);
    if (list) list.push(k);
    else byOrigin.set(k.bound_origin, [k]);
  }
  const groups: PairingGroup[] = [];
  for (const [origin, list] of byOrigin) {
    const sorted = [...list].sort((a, b) => createdMs(b) - createdMs(a) || b.id.localeCompare(a.id));
    const current = sorted.find((k) => keyState(k, now) === 'live') ?? null;
    const retirable: RetireCandidate[] = [];
    for (const k of sorted) {
      if (k === current) continue;
      retirable.push({ key: k, reason: keyState(k, now) === 'expired' ? 'expired' : 'superseded' });
    }
    groups.push({ origin, keys: sorted, current, retirable });
  }
  return groups.sort((a, b) => a.origin.localeCompare(b.origin));
}

/** Every pairing that can be retired without cutting off an app that still works. */
export function retirePlan(keys: readonly ExternalApiKey[], now: number = Date.now()): RetireCandidate[] {
  return groupPairings(keys, now).flatMap((g) => g.retirable);
}

export interface RetireOutcome {
  retired: string[];
  failed: { id: string; message: string }[];
}

/**
 * Revoke each id in turn. One failure does not stop the pass; it is reported
 * with its message. Sequential on purpose: every revoke re-derives the CORS
 * allowlist from the database.
 */
export async function runRetire(
  ids: readonly string[],
  revokeFn: (id: string) => Promise<unknown>,
): Promise<RetireOutcome> {
  const out: RetireOutcome = { retired: [], failed: [] };
  for (const id of ids) {
    try {
      await revokeFn(id);
      out.retired.push(id);
    } catch (e) {
      out.failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
