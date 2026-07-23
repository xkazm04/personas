import { describe, it, expect } from 'vitest';

import { combineIslandState, computeAttention, monitoringSeverity, type MonitoringSummary } from '../lib/liveState';
import type { FleetNode } from '../lib/types';

const mon = (o: Partial<MonitoringSummary> = {}): MonitoringSummary =>
  ({ unresolvedIssues: 0, eventsLast24h: 0, eventsLastWeek: 0, ...o });
const node = (state: string): FleetNode => ({ id: state, label: state, state });

describe('liveState — monitoringSeverity', () => {
  it('no summary → none (honest unknown)', () => {
    expect(monitoringSeverity(undefined)).toBe('none');
  });
  it('fresh events in the last 24h → error', () => {
    expect(monitoringSeverity(mon({ eventsLast24h: 4 }))).toBe('error');
  });
  it('open unresolved issues but quiet → warn', () => {
    expect(monitoringSeverity(mon({ unresolvedIssues: 3, eventsLast24h: 0 }))).toBe('warn');
  });
  it('clean (0 issues, 0 events) → none', () => {
    expect(monitoringSeverity(mon())).toBe('none');
  });
  it('unresolvedIssues null (header stripped) + quiet → none', () => {
    expect(monitoringSeverity(mon({ unresolvedIssues: null }))).toBe('none');
  });
});

describe('liveState — combineIslandState (three source combinations)', () => {
  it('no monitoring bound → readiness verbatim, source=readiness', () => {
    expect(combineIslandState('healthy', undefined)).toEqual({ state: 'healthy', source: 'readiness' });
    expect(combineIslandState('critical', undefined)).toEqual({ state: 'critical', source: 'readiness' });
  });
  it('fresh errors → critical, source=errors (regardless of readiness)', () => {
    expect(combineIslandState('healthy', mon({ eventsLast24h: 2 }))).toEqual({ state: 'critical', source: 'errors' });
    expect(combineIslandState('building', mon({ eventsLast24h: 99, unresolvedIssues: 10 }))).toEqual({ state: 'critical', source: 'errors' });
  });
  it('quiet-but-open issues bump healthy/building down to warning', () => {
    expect(combineIslandState('healthy', mon({ unresolvedIssues: 1 }))).toEqual({ state: 'warning', source: 'errors' });
    expect(combineIslandState('building', mon({ unresolvedIssues: 5 }))).toEqual({ state: 'warning', source: 'errors' });
  });
  it('quiet-but-open issues never soften an already-worse readiness', () => {
    expect(combineIslandState('critical', mon({ unresolvedIssues: 1 }))).toEqual({ state: 'critical', source: 'errors' });
    expect(combineIslandState('warning', mon({ unresolvedIssues: 1 }))).toEqual({ state: 'warning', source: 'errors' });
  });
  it('clean monitoring → readiness stands, source=readiness', () => {
    expect(combineIslandState('healthy', mon())).toEqual({ state: 'healthy', source: 'readiness' });
  });
});

describe('liveState — computeAttention', () => {
  it('awaiting_input raises attention', () => {
    expect(computeAttention([node('running'), node('awaiting_input')])).toBe(true);
  });
  it('stale raises attention', () => {
    expect(computeAttention([node('stale')])).toBe(true);
  });
  it('only active/idle sessions → no attention', () => {
    expect(computeAttention([node('running'), node('idle'), node('spawning')])).toBe(false);
  });
  it('empty fleet → no attention', () => {
    expect(computeAttention([])).toBe(false);
  });
});
