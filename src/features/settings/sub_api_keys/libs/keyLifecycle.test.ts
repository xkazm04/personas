/**
 * keyLifecycle: which API keys can still authenticate, and which paired keys
 * are safe to retire.
 *
 * The fixture is shaped like the measured local table (2026-09-23): one live
 * regular key plus 36 origin-bound keys across 4 origins, 25/7/1/3 per origin,
 * where only the 3 ship-orchestrator pairings are unexpired. Retiring revokes
 * credentials, so the plan is pinned from both sides: what it must contain and
 * what it must never contain.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import {
  DAY_MS,
  isStaleKey,
  keyState,
  liveCount,
  groupPairings,
  retirePlan,
  runRetire,
} from './keyLifecycle';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const HOUR_MS = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function key(over: Partial<ExternalApiKey> = {}): ExternalApiKey {
  seq += 1;
  return {
    id: `k${seq}`,
    name: `key ${seq}`,
    key_prefix: `pk_${seq}`,
    scopes: '[]',
    enabled: true,
    created_at: iso(NOW - 40 * DAY_MS),
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
    bound_origin: null,
    label: null,
    ...over,
  };
}

const BENCH = 'http://kp-app-master-bench.localhost';
const KANDIDATE = 'https://kandidate.example';
const PROBE = 'http://probe.localhost';
const SHIP = 'http://ship-orchestrator.localhost';

function paired(origin: string, n: number, opts: { expired: boolean; baseDaysAgo: number }): ExternalApiKey[] {
  return Array.from({ length: n }, (_, i) =>
    key({
      bound_origin: origin,
      name: `Paired: ${origin}`,
      created_at: iso(NOW - (opts.baseDaysAgo - i) * DAY_MS),
      expires_at: opts.expired ? iso(NOW - HOUR_MS) : iso(NOW + 20 * DAY_MS),
    }),
  );
}

/** The measured table: 37 non-system, non-revoked keys; 33 expired an hour ago. */
function measured() {
  const bridge = key({ name: 'kp grand-simulation hire bridge', last_used_at: iso(NOW - HOUR_MS) });
  const bench = paired(BENCH, 25, { expired: true, baseDaysAgo: 60 });
  const kandidate = paired(KANDIDATE, 7, { expired: true, baseDaysAgo: 50 });
  const probe = paired(PROBE, 1, { expired: true, baseDaysAgo: 45 });
  const ship = paired(SHIP, 3, { expired: false, baseDaysAgo: 5 });
  return { bridge, bench, kandidate, probe, ship, all: [bridge, ...bench, ...kandidate, ...probe, ...ship] };
}

describe('case 1: keyState fails closed like find_by_token', () => {
  it('revoked when revoked_at is set', () => {
    expect(keyState(key({ revoked_at: iso(NOW - DAY_MS) }), NOW)).toBe('revoked');
  });
  it('revoked when disabled', () => {
    expect(keyState(key({ enabled: false }), NOW)).toBe('revoked');
  });
  it('expired when expires_at is in the past or exactly now', () => {
    expect(keyState(key({ expires_at: iso(NOW - HOUR_MS) }), NOW)).toBe('expired');
    expect(keyState(key({ expires_at: iso(NOW) }), NOW)).toBe('expired');
  });
  it('expired when expires_at does not parse', () => {
    expect(keyState(key({ expires_at: 'not-a-date' }), NOW)).toBe('expired');
    expect(keyState(key({ expires_at: '' }), NOW)).toBe('expired');
  });
  it('live when it never expires or expires later', () => {
    expect(keyState(key(), NOW)).toBe('live');
    expect(keyState(key({ expires_at: iso(NOW + HOUR_MS) }), NOW)).toBe('live');
  });
  it('revoked outranks expired', () => {
    expect(keyState(key({ enabled: false, expires_at: iso(NOW - HOUR_MS) }), NOW)).toBe('revoked');
  });
});

describe('case 2: liveCount counts keys that can authenticate', () => {
  it('4 live among 37 non-revoked keys where 33 expired an hour ago', () => {
    const { all } = measured();
    expect(all).toHaveLength(37);
    expect(all.filter((k) => k.enabled && !k.revoked_at)).toHaveLength(37); // the old header's number
    expect(liveCount(all, NOW)).toBe(4);
  });
});

describe('case 3: groupPairings collapses pairings to one group per origin', () => {
  it('36 origin-bound keys across 4 origins give 4 groups', () => {
    const { all } = measured();
    const groups = groupPairings(all, NOW);
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.origin).sort()).toEqual([BENCH, KANDIDATE, PROBE, SHIP].sort());
    expect(groups.reduce((n, g) => n + g.keys.length, 0)).toBe(36);
  });
  it('an all-expired origin has no current key and all 25 are retirable as expired', () => {
    const { all, bench } = measured();
    const g = groupPairings(all, NOW).find((x) => x.origin === BENCH)!;
    expect(g.current).toBeNull();
    expect(g.retirable).toHaveLength(25);
    expect(g.retirable.map((c) => c.key.id).sort()).toEqual(bench.map((k) => k.id).sort());
    expect(g.retirable.every((c) => c.reason === 'expired')).toBe(true);
  });
});

describe('case 4: the newest live pairing is current, older live ones are superseded', () => {
  it('t1 < t2 < t3 gives current = t3 and retirable = t1, t2', () => {
    const { all, ship } = measured();
    const [t1, t2, t3] = ship as [ExternalApiKey, ExternalApiKey, ExternalApiKey]; // paired(SHIP, 3) builds exactly 3
    const g = groupPairings(all, NOW).find((x) => x.origin === SHIP)!;
    expect(g.current?.id).toBe(t3.id);
    expect(g.retirable.map((c) => c.key.id).sort()).toEqual([t1.id, t2.id].sort());
    expect(g.retirable.every((c) => c.reason === 'superseded')).toBe(true);
  });
  it('input order does not decide which pairing is current', () => {
    const { all, ship } = measured();
    const g = groupPairings([...all].reverse(), NOW).find((x) => x.origin === SHIP)!;
    expect(g.current?.id).toBe(ship[2]!.id);
  });
});

describe('case 5: retirePlan holds only expired or superseded origin-bound keys', () => {
  it('the measured table retires 35 = 33 expired + 2 superseded', () => {
    const { all } = measured();
    const plan = retirePlan(all, NOW);
    expect(plan).toHaveLength(35);
    expect(plan.filter((c) => c.reason === 'expired')).toHaveLength(33);
    expect(plan.filter((c) => c.reason === 'superseded')).toHaveLength(2);
    for (const c of plan) {
      expect(c.key.bound_origin).not.toBeNull();
      const st = keyState(c.key, NOW);
      expect(c.reason === 'expired' ? st === 'expired' : st === 'live').toBe(true);
    }
  });

  // [guard] the three things a revoke pass must never touch.
  it('[guard] never a regular key, never a revoked key, never the newest live pairing', () => {
    const { all, ship, bridge } = measured();
    const staleRegular = key({ name: 'forgotten', created_at: iso(NOW - 90 * DAY_MS), last_used_at: null });
    const expiredRegular = key({ name: 'old cli', expires_at: iso(NOW - DAY_MS) });
    const revokedPaired = key({ bound_origin: SHIP, created_at: iso(NOW), revoked_at: iso(NOW - HOUR_MS) });
    const disabledPaired = key({ bound_origin: SHIP, created_at: iso(NOW), enabled: false });
    const keys = [...all, staleRegular, expiredRegular, revokedPaired, disabledPaired];
    expect(isStaleKey(staleRegular, NOW)).toBe(true);

    const ids = new Set(retirePlan(keys, NOW).map((c) => c.key.id));
    for (const k of [bridge, staleRegular, expiredRegular, revokedPaired, disabledPaired, ship[2]!]) {
      expect(ids.has(k.id)).toBe(false);
    }
    // Every origin with a live pairing keeps exactly one live key out of the plan.
    for (const g of groupPairings(keys, NOW)) {
      const liveKept = g.keys.filter((k) => keyState(k, NOW) === 'live' && !ids.has(k.id));
      const hasLive = g.keys.some((k) => keyState(k, NOW) === 'live');
      expect(liveKept).toHaveLength(hasLive ? 1 : 0);
      if (g.current) expect(ids.has(g.current.id)).toBe(false);
    }
  });

  it('[guard] an expired pairing newer than the live one does not unseat the live key', () => {
    const live = key({ bound_origin: PROBE, created_at: iso(NOW - 3 * DAY_MS), expires_at: iso(NOW + DAY_MS) });
    const newerExpired = key({ bound_origin: PROBE, created_at: iso(NOW - DAY_MS), expires_at: 'garbage' });
    const g = groupPairings([live, newerExpired], NOW)[0]!;
    expect(g.current?.id).toBe(live.id);
    expect(retirePlan([live, newerExpired], NOW).map((c) => c.key.id)).toEqual([newerExpired.id]);
  });
});

describe('case 6: runRetire keeps going past a failure', () => {
  it('calls revoke for every id and reports the one that failed', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    const revokeFn = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('database is locked');
    });
    const out = await runRetire(ids, revokeFn);
    expect(revokeFn.mock.calls.map((c) => c[0])).toEqual(ids);
    expect(out.retired).toEqual(['a', 'c', 'd']);
    expect(out.failed).toEqual([{ id: 'b', message: 'database is locked' }]);
  });
  it('a non-Error rejection still yields a message', async () => {
    const out = await runRetire(['x'], () => Promise.reject('nope'));
    expect(out).toEqual({ retired: [], failed: [{ id: 'x', message: 'nope' }] });
  });
});

describe('[guard] regular keys keep their stale verdicts', () => {
  it('isStaleKey verdicts are unchanged by the lifecycle helpers', () => {
    const fresh = key({ created_at: iso(NOW - 2 * DAY_MS) });
    const unusedOld = key({ created_at: iso(NOW - 10 * DAY_MS) });
    const idle = key({ created_at: iso(NOW - 90 * DAY_MS), last_used_at: iso(NOW - 31 * DAY_MS) });
    const active = key({ created_at: iso(NOW - 90 * DAY_MS), last_used_at: iso(NOW - DAY_MS) });
    const revoked = key({ revoked_at: iso(NOW - DAY_MS) });
    expect([fresh, unusedOld, idle, active, revoked].map((k) => isStaleKey(k, NOW))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});
