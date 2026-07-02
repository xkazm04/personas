/**
 * Table test for the error registry — the single mapping layer between raw
 * backend/invoke errors and every user-facing error toast. A pattern
 * regression here silently degrades error UX app-wide, so the top rules,
 * their ORDER (most-specific-first), and the fallback are pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addBreadcrumb = vi.fn();
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
}));

import { resolveError, friendlySeverity } from '../errorRegistry';

describe('resolveError', () => {
  beforeEach(() => {
    addBreadcrumb.mockClear();
  });

  // ── Representative raw string → rule table ─────────────────────────────
  const CASES: Array<{ raw: string; contains: string; category: string }> = [
    { raw: 'NetworkOffline', contains: 'offline', category: 'system' },
    { raw: 'Request timed out after 30s', contains: 'took too long', category: 'recoverable' },
    { raw: 'Auth token missing or invalid', contains: 'session has expired', category: 'user_action' },
    { raw: 'API rate limit exceeded, retry later', contains: 'Too many requests', category: 'recoverable' },
    { raw: 'Budget limit exceeded for persona x', contains: 'spending limit', category: 'user_action' },
    { raw: 'Claude CLI not found on PATH', contains: 'not installed', category: 'system' },
    { raw: 'NotFound: persona 123', contains: 'could not be found', category: 'recoverable' },
    { raw: 'Decryption failed: bad tag', contains: 'Could not decrypt', category: 'user_action' },
    { raw: 'Circular chain detected between A and B', contains: 'loop', category: 'user_action' },
    { raw: 'Validation: name too short', contains: 'input values are invalid', category: 'user_action' },
    { raw: 'interval_seconds must be at least 60', contains: 'once per minute', category: 'user_action' },
    { raw: 'Webhook returned HTTP 502', contains: 'external service returned an error', category: 'system' },
  ];

  it.each(CASES)('maps "$raw" to the expected rule', ({ raw, contains, category }) => {
    const friendly = resolveError(raw);
    expect(friendly.message.toLowerCase()).toContain(contains.toLowerCase());
    expect(friendly.category).toBe(category);
    expect(friendly.suggestion.length).toBeGreaterThan(0);
  });

  // ── Rule ordering (most-specific-first is load-bearing) ────────────────
  it('matches the weekly usage-limit rule before the generic usage-limit rule', () => {
    // Both rules match the substring "usage limit reached" — the weekly rule
    // must win because it is registered first (registry comment pins this).
    const weekly = resolveError('Claude weekly usage limit reached');
    expect(weekly.message).toContain('weekly');
    expect(weekly.category).toBe('user_action');

    const windowed = resolveError('usage limit reached — resets at 5pm');
    expect(windowed.message).not.toContain('weekly');
    expect(windowed.category).toBe('recoverable');
  });

  // ── Fallback behavior ──────────────────────────────────────────────────
  it('returns the generic unclassified fallback for unmatched errors', () => {
    const friendly = resolveError('some totally novel failure xyzzy');
    expect(friendly.message).toBe('Something went wrong.');
    expect(friendly.category).toBe('unclassified');
  });

  it('returns the fallback for null/undefined/empty without breadcrumbing', () => {
    for (const raw of [null, undefined, '']) {
      expect(resolveError(raw).category).toBe('unclassified');
    }
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  // ── Sentry breadcrumb + 1s dedupe window ───────────────────────────────
  it('records one breadcrumb per resolve, deduping identical raw errors within 1s', () => {
    resolveError('NetworkOffline');
    resolveError('NetworkOffline'); // same raw+category inside the window → deduped
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb.mock.calls[0][0]).toMatchObject({
      category: 'error.resolved',
      message: 'NetworkOffline',
    });

    resolveError('Session expired'); // different raw → new breadcrumb
    expect(addBreadcrumb).toHaveBeenCalledTimes(2);
  });
});

describe('friendlySeverity', () => {
  it('maps known severities and passes unknown codes through', () => {
    expect(friendlySeverity('critical')).toBe('Needs immediate attention');
    expect(friendlySeverity('low')).toBe('Informational');
    expect(friendlySeverity('bizarre')).toBe('bizarre');
  });
});
