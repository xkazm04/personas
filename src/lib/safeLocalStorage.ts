// The ONE guarded door onto localStorage for module stores that keep a
// degraded fallback or a crash shadow there.
//
// `docs/concepts/golden-paths/client-state-persistence.md` step 10: every
// direct localStorage touch must guard the read, the parse AND the write,
// because all three throw in a WebView2 profile with storage disabled or quota
// exhausted. Before this file existed the guard was copied per store
// (`layoutStore.ts` carried the reference copy); this is the shared wrapper
// that path's Gaps #1 named, so a new store imports three functions instead of
// writing a 33rd private try/catch dialect.
//
// Scope is deliberately narrow: raw string get/set/remove plus a tolerant JSON
// parse. Anything a user deliberately chose belongs in the backend
// `app_settings` table — see the golden path's "who is the authority" test.
import { silentCatch } from '@/lib/silentCatch';

/** `localStorage.getItem` that returns `null` instead of throwing. */
export function safeLocalGet(key: string, site = 'safeLocalStorage read'): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    silentCatch(site)(e);
    return null;
  }
}

/** `localStorage.setItem` that swallows quota / disabled-storage failures.
 *  Best-effort by contract: a full or blocked storage must never break the
 *  interaction that tried to remember something. */
export function safeLocalSet(key: string, value: string, site = 'safeLocalStorage write'): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    silentCatch(site)(e);
  }
}

/** `localStorage.removeItem` that swallows failures. */
export function safeLocalRemove(key: string, site = 'safeLocalStorage remove'): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    silentCatch(site)(e);
  }
}

/** Parse a stored JSON string, falling back instead of throwing. The result is
 *  still `T` by assertion only — callers that persist across builds must
 *  coerce field by field (golden path step 8). */
export function jsonOr<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
