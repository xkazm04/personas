import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fetchSentryStats feeds the "Events (24h)" and "Events (7d)" vitals on the
// Overview and on the LLM-overview monitoring section.

const executeApiRequest = vi.hoisted(() => vi.fn());
vi.mock('@/api/system/apiProxy', () => ({ executeApiRequest }));

import { fetchSentryStats } from '../adapters';
import { computeVitalTones } from '../overviewHelpers';

// 2026-10-19T15:00:00Z — mid-afternoon UTC, so "today since UTC midnight" (15h)
// and "the last 24 hours" are different windows.
const NOW_S = Date.UTC(2026, 9, 19, 15, 0, 0) / 1000;
const HOUR = 3600;

function issuesOk() {
  return { status: 200, headers: { 'x-hits': '3' }, body: '[]' };
}

/** What Sentry's stats endpoint answers: one [ts, count] pair per bucket. */
function statsBody(url: string): string {
  const since = Number(/since=(\d+)/.exec(url)![1]);
  const until = Number(/until=(\d+)/.exec(url)![1]);
  const res = /resolution=(\w+)/.exec(url)![1];
  const step = res === '1d' ? 86400 : res === '1h' ? HOUR : NaN;
  const buckets: [number, number][] = [];
  // Buckets are aligned to the resolution, like the real endpoint.
  for (let ts = Math.floor(since / step) * step; ts <= until; ts += step) {
    // One event per elapsed hour: a bucket still open at `until` holds only
    // the hours that have happened so far.
    buckets.push([ts, Math.floor((Math.min(ts + step, until) - ts) / HOUR)]);
  }
  return JSON.stringify(buckets);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_S * 1000);
  executeApiRequest.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('fetchSentryStats', () => {
  it('counts the last 24 hours, not the events since UTC midnight', async () => {
    executeApiRequest.mockImplementation(async (_c: string, _m: string, path: string) =>
      path.includes('/issues/') ? issuesOk() : { status: 200, headers: {}, body: statsBody(path) },
    );
    const s = await fetchSentryStats('cred', 'acme', 'app');
    // One event per hour: the last 24 hours hold 24 of them. A per-day bucket
    // query reads only today's bucket (15 events at 15:00 UTC).
    expect(s.eventsLast24h).toBe(24);
    expect(s.eventsLastWeek).toBeGreaterThanOrEqual(7 * 24);
  });

  it('reports an unreadable stats response as unmeasured, never as zero events', async () => {
    executeApiRequest.mockImplementation(async (_c: string, _m: string, path: string) =>
      path.includes('/issues/')
        ? issuesOk()
        : { status: 403, headers: {}, body: '{"detail":"You do not have permission"}' },
    );
    const s = await fetchSentryStats('cred', 'acme', 'app');
    expect(s.eventsLast24h).toBeNull();
    expect(s.eventsLastWeek).toBeNull();
    // ...and an unmeasured window is never tinted as a passing gate.
    const tones = computeVitalTones(null, s);
    expect(tones.events24).toBe('neutral');
    expect(tones.events7).toBe('neutral');
  });

  it('reports a failed stats request as unmeasured too', async () => {
    executeApiRequest.mockImplementation(async (_c: string, _m: string, path: string) => {
      if (path.includes('/issues/')) return issuesOk();
      throw { error: 'network down', kind: 'network' };
    });
    const s = await fetchSentryStats('cred', 'acme', 'app');
    expect(s.eventsLast24h).toBeNull();
    expect(s.eventsLastWeek).toBeNull();
    expect(s.unresolvedIssues).toBe(3);
  });
});
