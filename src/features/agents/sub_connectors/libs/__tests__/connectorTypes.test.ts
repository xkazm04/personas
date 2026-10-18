import { describe, expect, it } from 'vitest';
import type { ConnectorStatus, ConnectorTestResult } from '../connectorTypes';
import {
  STALE_HEALTHCHECK_MS,
  credentialMatchesConnector,
  deriveReadiness,
  getStatusKey,
  isExecutionReady,
  isStaleResult,
  matchesHealthFilter,
  restoreHealthcheck,
  summarizeTestAll,
} from '../connectorTypes';

function status(over: Partial<ConnectorStatus> = {}): ConnectorStatus {
  return {
    name: 'github',
    credentialId: 'cred-1',
    credentialName: 'GitHub PAT',
    testing: false,
    result: null,
    linkError: null,
    ...over,
  };
}

function result(over: Partial<ConnectorTestResult> = {}): ConnectorTestResult {
  return { success: true, message: '', ...over };
}

// The whole point of the three-valued probe state: `success` is `state != Failed`
// on the Rust side (engine/healthcheck.rs:58), so an unverifiable probe arrives
// with success === true. Every consumer must key on `state`, not on `success` --
// StatusResult did not, and painted it as a green "Ready" nothing had earned.
describe('unverifiable is never treated as verified', () => {
  it('deriveReadiness separates it from healthy even though success is true', () => {
    const r = result({ success: true, state: 'unverifiable' });
    expect(deriveReadiness(status({ result: r }))).toBe('unverifiable');
    expect(deriveReadiness(status({ result: result({ success: true, state: 'verified' }) }))).toBe('healthy');
  });

  it('getStatusKey selects the unverifiable badge, not `ready`', () => {
    expect(getStatusKey(status({ result: result({ success: true, state: 'unverifiable' }) }))).toBe('unverifiable');
    expect(getStatusKey(status({ result: result({ success: true, state: 'verified' }) }))).toBe('ready');
  });

  it('an explicit probe failure is still unhealthy', () => {
    expect(deriveReadiness(status({ result: result({ success: false, state: 'failed' }) }))).toBe('unhealthy');
    expect(getStatusKey(status({ result: result({ success: false, state: 'failed' }) }))).toBe('failed');
  });
});

describe('deriveReadiness / getStatusKey precedence', () => {
  it('no credential outranks everything', () => {
    expect(deriveReadiness(status({ credentialId: null }))).toBe('unlinked');
    expect(getStatusKey(status({ credentialId: null }))).toBe('missing');
  });

  it('a linked-but-unprobed connector is untested, not failed', () => {
    expect(deriveReadiness(status({ result: null }))).toBe('linked_untested');
    expect(getStatusKey(status({ result: null }))).toBe('untested');
  });

  it('an in-flight test wins the badge but not the readiness', () => {
    expect(getStatusKey(status({ testing: true }))).toBe('testing');
    expect(deriveReadiness(status({ testing: true }))).toBe('linked_untested');
  });
});

describe('isStaleResult', () => {
  const now = Date.parse('2026-08-29T12:00:00Z');

  it('a live result from this session is never stale', () => {
    const fresh = result({ cached: false, testedAt: new Date(now - STALE_HEALTHCHECK_MS * 5).toISOString() });
    expect(isStaleResult(fresh, now)).toBe(false);
  });

  it('a restored result goes stale only past the cutoff', () => {
    const justInside = result({ cached: true, testedAt: new Date(now - STALE_HEALTHCHECK_MS + 1000).toISOString() });
    const justOutside = result({ cached: true, testedAt: new Date(now - STALE_HEALTHCHECK_MS - 1000).toISOString() });
    expect(isStaleResult(justInside, now)).toBe(false);
    expect(isStaleResult(justOutside, now)).toBe(true);
  });

  it('an unparseable or missing timestamp is not stale', () => {
    expect(isStaleResult(result({ cached: true, testedAt: 'not-a-date' }), now)).toBe(false);
    expect(isStaleResult(result({ cached: true, testedAt: null }), now)).toBe(false);
    expect(isStaleResult(null, now)).toBe(false);
  });
});

describe('matchesHealthFilter', () => {
  it('a null filter admits everything', () => {
    expect(matchesHealthFilter(status(), null)).toBe(true);
  });

  it('stale is orthogonal to readiness', () => {
    const old = result({ success: true, cached: true, testedAt: '2000-01-01T00:00:00Z' });
    const s = status({ result: old });
    expect(matchesHealthFilter(s, 'stale')).toBe(true);
    expect(matchesHealthFilter(s, 'healthy')).toBe(true);
    expect(matchesHealthFilter(status(), 'stale')).toBe(false);
  });
});

describe('restoreHealthcheck', () => {
  it('returns null for a credential that was never probed, leaving auto-test free to fire', () => {
    expect(restoreHealthcheck(null)).toBeNull();
    expect(restoreHealthcheck(undefined)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(restoreHealthcheck({ healthcheck_last_success: null } as any)).toBeNull();
  });

  it('marks a restored result cached so the UI can say "last checked"', () => {
    const restored = restoreHealthcheck({
      healthcheck_last_success: false,
      healthcheck_last_message: 'Service returned HTTP 401',
      healthcheck_last_state: 'failed',
      healthcheck_last_tested_at: '2026-08-28T00:00:00Z',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(restored).toEqual({
      success: false,
      message: 'Service returned HTTP 401',
      state: 'failed',
      testedAt: '2026-08-28T00:00:00Z',
      cached: true,
    });
  });
});

// A connector slot may name a concrete service OR a category -- templates
// routinely declare requirements at the category level, and a strict
// service_type test finds nothing at all for those.
describe('credentialMatchesConnector', () => {
  it('matches on the concrete service type', () => {
    expect(credentialMatchesConnector({ service_type: 'github' }, 'github')).toBe(true);
  });

  it('matches a category-shaped slot through the connector catalog tags', () => {
    expect(credentialMatchesConnector({ service_type: 'github' }, 'source_control')).toBe(true);
    expect(credentialMatchesConnector({ service_type: 'github' }, 'ci_cd')).toBe(true);
  });

  it('does not match an unrelated connector or category', () => {
    expect(credentialMatchesConnector({ service_type: 'github' }, 'slack')).toBe(false);
    expect(credentialMatchesConnector({ service_type: 'github' }, 'messaging')).toBe(false);
  });

  it('an unknown service type falls back to the strict test only', () => {
    expect(credentialMatchesConnector({ service_type: 'made_up' }, 'made_up')).toBe(true);
    expect(credentialMatchesConnector({ service_type: 'made_up' }, 'source_control')).toBe(false);
  });
});

// `unreachable` (connect / DNS / timeout) is not a judgement about the
// credential: engine/healthcheck.rs `is_verdict()` says so, the vault store
// returns it un-persisted (credentialSlice.ts) so the caller can paint "could
// not check", and the vault list files it beside `untested`. Its `success` is
// false, so keying on the boolean painted an offline laptop's good keys red here.
describe('unreachable is never treated as a failure', () => {
  const offline = result({ success: false, state: 'unreachable', message: 'connect timeout' });

  it('deriveReadiness reports no verdict rather than unhealthy', () => {
    expect(deriveReadiness(status({ result: offline }))).toBe('linked_untested');
    expect(matchesHealthFilter(status({ result: offline }), 'unhealthy')).toBe(false);
    expect(isExecutionReady(status({ result: offline }))).toBe(true);
  });

  it('getStatusKey selects its own badge, not `failed`', () => {
    expect(getStatusKey(status({ result: offline }))).toBe('unreachable');
  });

  it('a result without a state token still falls back to the boolean', () => {
    expect(deriveReadiness(status({ result: result({ success: false }) }))).toBe('unhealthy');
    expect(getStatusKey(status({ result: result({ success: false }) }))).toBe('failed');
  });
});

describe('summarizeTestAll', () => {
  const ok = result({ success: true, state: 'verified' });
  const bad = result({ success: false, state: 'failed' });
  const offline = result({ success: false, state: 'unreachable' });

  it('counts recovered, newly failing and still failing against the baseline', () => {
    const baseline = new Map([['a', bad], ['b', ok], ['c', bad], ['d', null]]);
    const outcomes = [
      { name: 'a', result: ok },
      { name: 'b', result: bad },
      { name: 'c', result: bad },
      { name: 'd', result: bad },
    ];
    expect(summarizeTestAll(outcomes, baseline)).toEqual({ recovered: 1, regressed: 1, failing: 2 });
  });

  it('an unreachable probe is neither a regression nor a failure', () => {
    const baseline = new Map([['a', ok], ['b', null]]);
    const outcomes = [{ name: 'a', result: offline }, { name: 'b', result: offline }];
    expect(summarizeTestAll(outcomes, baseline)).toEqual({ recovered: 0, regressed: 0, failing: 0 });
  });

  it('an unreachable baseline is not a failure a pass can recover from', () => {
    const baseline = new Map([['a', offline]]);
    expect(summarizeTestAll([{ name: 'a', result: ok }], baseline)).toEqual({ recovered: 0, regressed: 0, failing: 0 });
  });

  it('a skipped (already in flight) test counts nowhere', () => {
    expect(summarizeTestAll([{ name: 'a', result: null }], new Map([['a', bad]]))).toEqual({ recovered: 0, regressed: 0, failing: 0 });
  });
});
