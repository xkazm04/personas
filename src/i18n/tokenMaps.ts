/**
 * Status-token-to-i18n-key maps.
 *
 * The Rust backend sends machine tokens (e.g. "queued", "failed", "critical")
 * over IPC. These tokens are language-agnostic identifiers — they must NEVER be
 * shown to the user directly. Instead, the frontend resolves each token to a
 * translated label via the maps below.
 *
 * ## Adding a new token
 *   1. Add the token → i18n key mapping in the relevant `*_TOKENS` record.
 *   2. Add the corresponding English string in `src/i18n/en.ts` under the
 *      matching `status_tokens.*` section.
 *   3. Non-English locales fall back to English automatically via deep merge.
 *
 * ## Usage
 *   const { t } = useTranslation();
 *   const label = tokenLabel(t, 'execution', row.status);   // "Running"
 *   const label = tokenLabel(t, 'severity', issue.severity); // "Critical"
 */

import type { Translations } from './en';

// ---------------------------------------------------------------------------
// Token category → i18n key path mapping
// ---------------------------------------------------------------------------

type TokenSection = keyof Translations['status_tokens'];

const warnedTokens = new Set<string>();

/** Resolve a machine token to its translated label. Falls back to the raw token. */
export function tokenLabel(t: Translations, category: TokenSection, token: string): string {
  const section = t.status_tokens[category];
  if (section && typeof section === 'object' && token in section) {
    return (section as Record<string, string | undefined>)[token] ?? token;
  }
  if (import.meta.env.DEV) {
    const key = `${category}:${token}`;
    if (!warnedTokens.has(key)) {
      warnedTokens.add(key);
      console.warn(
        `[i18n] tokenLabel falling back to raw token "${token}" for category "${category}". ` +
        `Add status_tokens.${category}.${token} to src/i18n/en.ts.`,
      );
    }
  }
  return token;
}

/**
 * React hook shorthand — returns a resolver bound to the current language.
 *
 * @example
 *   const { tToken } = useTokenLabel();
 *   <Badge>{tToken('execution', row.status)}</Badge>
 *   <Badge>{tToken('severity', issue.severity)}</Badge>
 */
export { tokenLabel as tToken };
