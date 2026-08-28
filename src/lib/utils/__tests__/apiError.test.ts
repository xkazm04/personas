import { describe, it, expect, vi } from 'vitest';
import { ApiError, classifyError, withRetry } from '../apiError';
import type { TauriErrorKind } from '@/lib/types/tauriError';

const tauriError = (kind: TauriErrorKind, error = 'backend said no') => ({ error, kind });

/** Every kind the backend can send, so the invariant is checked exhaustively. */
const ALL_KINDS: TauriErrorKind[] = [
  'database', 'pool', 'not_found', 'validation', 'io', 'serde', 'execution',
  'process_spawn', 'auth', 'network_offline', 'cloud', 'gitlab', 'rate_limited',
  'forbidden', 'oauth_revoked', 'retry_exhausted', 'keyring_lost',
  'authorization_required', 'device_group_conflict', 'internal', 'external',
];

describe('classifyError', () => {
  it('classifies structured Tauri errors by kind', () => {
    expect(classifyError(tauriError('network_offline'), 'fb').severity).toBe('transient');
    expect(classifyError(tauriError('rate_limited'), 'fb').retryAfterMs).toBe(5000);
    expect(classifyError(tauriError('not_found'), 'fb').severity).toBe('permanent');
    expect(classifyError(tauriError('execution'), 'fb').severity).toBe('unknown');
  });

  it('falls back to regex classification for unstructured errors', () => {
    expect(classifyError(new Error('request timeout'), 'fb').severity).toBe('transient');
    expect(classifyError(new Error('404 not found'), 'fb').severity).toBe('permanent');
    expect(classifyError(new Error('something odd'), 'fb').severity).toBe('unknown');
  });

  // Regression guard. TRANSIENT_PATTERNS used to be tested before
  // PERMANENT_PATTERNS, so every message in the intersection of the two
  // vocabularies was auto-retried even though no retry could succeed.
  it('lets permanent win an overlap with a transient keyword', () => {
    expect(classifyError(new Error('Invalid network configuration'), 'fb').severity).toBe('permanent');
    expect(classifyError(new Error('400 Bad Request - please try again'), 'fb').severity).toBe('permanent');
    expect(classifyError(new Error('Validation failed, please try again'), 'fb').severity).toBe('permanent');
  });

  // Regression guard. The lists held bare `/503/`, `/429/`, `/400/`, so any
  // three-digit run anywhere in the message classified the error.
  it('reads a status code only where the message declares one', () => {
    expect(classifyError(new Error('queued 502 of 900 rows'), 'fb').severity).toBe('unknown');
    expect(classifyError(new Error('listening on port 4041'), 'fb').severity).toBe('unknown');
    expect(classifyError(new Error('HTTP 503 upstream refused'), 'fb').severity).toBe('transient');
    expect(classifyError(new Error('status code: 429'), 'fb').retryAfterMs).toBe(5000);
    expect(classifyError(new Error('error 403 from the connector'), 'fb').severity).toBe('permanent');
  });

  it('uses the fallback message when the error carries none', () => {
    expect(classifyError({}, 'fallback text').message).toBe('fallback text');
  });

  // Regression guard. `unknown` carried retryAfterMs 3000 while `withRetry`
  // gates on `isTransient` — dead data that READ like a missing retry, inviting
  // a future reader to widen the gate and start retrying `execution` and `io`.
  it('gives a non-zero retry delay if and only if the error is transient', () => {
    const cases: unknown[] = [
      ...ALL_KINDS.map((k) => tauriError(k)),
      new Error('request timeout'),
      new Error('429 too many requests'),
      new Error('404 not found'),
      new Error('something odd'),
      'plain string failure',
      {},
    ];
    for (const raw of cases) {
      const classified = classifyError(raw, 'fb');
      expect(classified.retryAfterMs > 0, JSON.stringify(raw)).toBe(classified.isTransient);
    }
  });
});

describe('withRetry', () => {
  it('retries a transient failure exactly once, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const promise = withRetry(async () => {
        calls += 1;
        if (calls === 1) throw tauriError('network_offline');
        return 'ok';
      }, 'fb');
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('ok');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw tauriError('validation');
      }, 'fb'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  // The other half of the invariant: an uncovered kind must be surfaced, not
  // silently re-run. `execution` re-runs a persona; retrying it is not free.
  it('does not retry an unknown-severity failure', async () => {
    for (const kind of ['execution', 'io', 'database'] as TauriErrorKind[]) {
      let calls = 0;
      await expect(
        withRetry(async () => {
          calls += 1;
          throw tauriError(kind);
        }, 'fb'),
      ).rejects.toMatchObject({ severity: 'unknown' });
      expect(calls, kind).toBe(1);
    }
  });
});
