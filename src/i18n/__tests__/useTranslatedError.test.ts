/**
 * Fallback-chain test for resolveErrorTranslated — the translated front-end of
 * the error registry. Pins the four-link chain:
 *   1. KEY_MAP match + i18n key present → translated message.
 *   2. KEY_MAP match + i18n key missing → graceful raw-string fallback.
 *   3. KEY_MAP miss but errorRegistry classifies → English friendly (chain into
 *      resolveError).
 *   4. Nothing matches → generic translated fallback.
 * Also covers the registry-gap-closure variants and the authorize action.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));

import { resolveErrorTranslated } from '../useTranslatedError';
import type { Translations } from '../en';

const BASE = {
  generic_message: 'Something went wrong.',
  generic_suggestion: 'Try again.',
};

function makeT(registry: Record<string, string>): Translations {
  return { error_registry: { ...BASE, ...registry } } as unknown as Translations;
}

describe('resolveErrorTranslated — gap closure + fallback chain', () => {
  it('translates the five structured AppError variants when keys are present', () => {
    const t = makeT({
      oauth_revoked_message: 'Authorization revoked.',
      oauth_revoked_suggestion: 'Reconnect the account.',
      retry_exhausted_message: 'Kept failing after retries.',
      retry_exhausted_suggestion: 'Try later.',
      keyring_lost_message: 'Credential store unavailable.',
      keyring_lost_suggestion: 'Restart the app.',
      authorization_required_message: 'This tool needs authorization.',
      authorization_required_suggestion: 'Open the page to grant consent.',
      external_service_message: 'External service failed.',
      external_service_suggestion: 'Check the service.',
    });

    expect(resolveErrorTranslated(t, 'OAuth grant revoked: c1').message).toBe('Authorization revoked.');
    expect(resolveErrorTranslated(t, 'Retry exhausted: 5 attempts').message).toBe('Kept failing after retries.');
    expect(resolveErrorTranslated(t, 'Identity keyring lost: gone').message).toBe('Credential store unavailable.');
    expect(
      resolveErrorTranslated(t, "Authorization required for tool 'x' on credential 'y' — open https://a.io/g to grant consent").message,
    ).toBe('This tool needs authorization.');
    expect(resolveErrorTranslated(t, 'Resource list returned HTTP 500: boom').message).toBe('External service failed.');
  });

  it('translates a previously English-only build-pipeline validator', () => {
    const t = makeT({
      interval_too_fast_message: 'Polling is too frequent.',
      interval_too_fast_suggestion: 'Use 60 seconds or more.',
    });
    const res = resolveErrorTranslated(t, 'interval_seconds must be at least 60');
    expect(res.message).toBe('Polling is too frequent.');
    expect(res.category).toBe('user_action');
  });

  it('surfaces an authorize action carrying the parsed consent URL', () => {
    const t = makeT({ authorization_required_message: 'x', authorization_required_suggestion: 'y' });
    const res = resolveErrorTranslated(
      t,
      "Authorization required for tool 'gmail' on credential 'c1' — open https://auth.example/grant?c=1 to grant consent",
    );
    expect(res.action).toEqual({ type: 'authorize', url: 'https://auth.example/grant?c=1' });
  });

  it('falls back to the raw string when a matched key is not yet translated', () => {
    const t = makeT({}); // no oauth_revoked_* keys
    const raw = 'OAuth grant revoked: c1';
    expect(resolveErrorTranslated(t, raw).message).toBe(raw);
    expect(resolveErrorTranslated(t, raw).category).toBe('user_action');
  });

  it('returns the generic translated fallback for a fully unmatched error', () => {
    const t = makeT({});
    const res = resolveErrorTranslated(t, 'totally novel xyzzy failure');
    expect(res.message).toBe('Something went wrong.');
    expect(res.category).toBe('unclassified');
  });

  it('returns the generic fallback for null/empty raw', () => {
    const t = makeT({});
    expect(resolveErrorTranslated(t, null).category).toBe('unclassified');
    expect(resolveErrorTranslated(t, '').message).toBe('Something went wrong.');
  });
});
