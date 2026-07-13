import { describe, it, expect } from 'vitest';
import { computeSinceLeftBriefing, type BriefingInput } from './sinceLeftBriefing';

const NOW = Date.parse('2026-07-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const LAST_SEEN = NOW - 6 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function input(over: Partial<BriefingInput> = {}): BriefingInput {
  return { runs: [], alerts: [], approvalsWaiting: 0, ...over };
}

describe('computeSinceLeftBriefing', () => {
  it('is a quiet first-run when there is no prior anchor', () => {
    const r = computeSinceLeftBriefing(input({ approvalsWaiting: 3 }), null);
    expect(r.firstRun).toBe(true);
    expect(r.lines).toEqual([]);
  });

  it('produces no lines when nothing happened since last visit', () => {
    const r = computeSinceLeftBriefing(
      input({
        runs: [{ persona_id: 'a', status: 'completed', created_at: iso(LAST_SEEN - HOUR) }],
        alerts: [{ fired_at: iso(LAST_SEEN - HOUR) }],
      }),
      LAST_SEEN,
    );
    expect(r.firstRun).toBe(false);
    expect(r.lines).toEqual([]);
  });

  it('counts runs since last visit and how many failed', () => {
    const r = computeSinceLeftBriefing(
      input({
        runs: [
          { persona_id: 'a', status: 'completed', created_at: iso(NOW - HOUR) },
          { persona_id: 'b', status: 'failed', created_at: iso(NOW - 2 * HOUR) },
          { persona_id: 'c', status: 'failed', created_at: iso(NOW - 3 * HOUR) },
          { persona_id: 'd', status: 'completed', created_at: iso(LAST_SEEN - HOUR) }, // before anchor
        ],
      }),
      LAST_SEEN,
    );
    expect(r.lines).toEqual([{ kind: 'runs', count: 3, failed: 2 }]);
  });

  it('counts alerts raised strictly after the anchor', () => {
    const r = computeSinceLeftBriefing(
      input({
        alerts: [
          { fired_at: iso(NOW - HOUR) },
          { fired_at: iso(LAST_SEEN) }, // exactly at anchor → excluded (strict >)
          { fired_at: 'garbage' },      // unparseable → skipped
        ],
      }),
      LAST_SEEN,
    );
    expect(r.lines).toEqual([{ kind: 'alerts', count: 1 }]);
  });

  it('includes approvals waiting as a current-state count', () => {
    const r = computeSinceLeftBriefing(input({ approvalsWaiting: 2 }), LAST_SEEN);
    expect(r.lines).toEqual([{ kind: 'approvals', count: 2 }]);
  });

  it('orders lines runs → alerts → approvals when all present', () => {
    const r = computeSinceLeftBriefing(
      input({
        runs: [{ persona_id: 'a', status: 'failed', created_at: iso(NOW - HOUR) }],
        alerts: [{ fired_at: iso(NOW - HOUR) }],
        approvalsWaiting: 4,
      }),
      LAST_SEEN,
    );
    expect(r.lines.map((l) => l.kind)).toEqual(['runs', 'alerts', 'approvals']);
    expect(r.lines[0]).toEqual({ kind: 'runs', count: 1, failed: 1 });
  });

  it('treats a null runs sample (not yet loaded) as no runs line', () => {
    const r = computeSinceLeftBriefing(input({ runs: null, approvalsWaiting: 1 }), LAST_SEEN);
    expect(r.lines).toEqual([{ kind: 'approvals', count: 1 }]);
  });
});
