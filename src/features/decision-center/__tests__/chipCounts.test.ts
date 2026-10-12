import { describe, expect, it } from 'vitest';

import { buildChipCounts, decisionTotal } from '../roster/chipCounts';
import { pendingCounts } from './rosterFixtures';

const ok = { n: 0, failed: false };

describe('buildChipCounts — failed is never 0', () => {
  it('maps PendingCounts onto the chips', () => {
    const c = buildChipCounts({
      pending: pendingCounts(),
      pendingFailed: false,
      questions: 3,
      chat: { n: 2, failed: false },
      ready: { n: 5, failed: false },
    });
    expect(c.gates.n).toBe(2 + 2 + 3); // reviews + approvals + questions
    expect(c.proposals.n).toBe(1 + 1 + 1);
    expect(c.backlog.n).toBe(7);
    expect(c.incidents).toEqual({ n: 3, lamp: 'danger', failed: false });
    expect(c.council.n).toBe(1);
    expect(c.reports.n).toBe(4);
    expect(c.chat.n).toBe(2);
    expect(c.ready.n).toBe(5);
    expect(decisionTotal(c)).toBe(7 + 3 + 7 + 3 + 1 + 4 + 2); // ready excluded
  });

  it('lamps incidents warning when open but none blocking', () => {
    const c = buildChipCounts({
      pending: pendingCounts({ blockingIncidents: 0 }),
      pendingFailed: false,
      questions: 0,
      chat: ok,
      ready: { n: 0, failed: false },
    });
    expect(c.incidents.lamp).toBe('warning');
  });

  it('a failed counts read fails every chip it feeds, keeping the last answer', () => {
    const c = buildChipCounts({
      pending: pendingCounts(),
      pendingFailed: true,
      questions: 0,
      chat: { n: 1, failed: false },
      ready: { n: 0, failed: false },
    });
    for (const chip of ['gates', 'proposals', 'backlog', 'incidents', 'council', 'reports'] as const) {
      expect(c[chip].failed).toBe(true);
    }
    expect(c.backlog.n).toBe(7);
    // Chat and ready have their own sources; they did not fail.
    expect(c.chat.failed).toBe(false);
    expect(c.ready.failed).toBe(false);
  });

  it('a failed read with nothing ever answered is failed, not a confident zero', () => {
    const c = buildChipCounts({
      pending: null,
      pendingFailed: true,
      questions: 0,
      chat: ok,
      ready: { n: null, failed: true },
    });
    expect(c.backlog).toEqual({ n: 0, lamp: 'neutral', failed: true });
    expect(c.ready.failed).toBe(true);
  });

  it('a failed chat derivation fails only chat', () => {
    const c = buildChipCounts({
      pending: pendingCounts(),
      pendingFailed: false,
      questions: 0,
      chat: { n: 0, failed: true },
      ready: { n: 0, failed: false },
    });
    expect(c.chat.failed).toBe(true);
    expect(c.gates.failed).toBe(false);
    expect(c.incidents.failed).toBe(false);
  });
});
