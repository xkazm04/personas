import { describe, it, expect } from 'vitest';

import { deriveScene } from '../lib/deriveScene';
import type { MonitoringSummary } from '../lib/liveState';
import { makePassport } from './passportFactory';

const mon = (o: Partial<MonitoringSummary> = {}): MonitoringSummary =>
  ({ unresolvedIssues: 0, eventsLast24h: 0, eventsLastWeek: 0, ...o });
const monMap = (s: MonitoringSummary) => new Map<string, MonitoringSummary | undefined>([['s', s]]);

describe('deriveScene — live monitoring drives island colour', () => {
  it('no bound monitoring → readiness colour, source=readiness, errors=null', () => {
    const isl = deriveScene([makePassport({ slug: 's', autoScore: 90, prodScore: 88 })], null, false).islands[0];
    expect(isl.state).toBe('healthy');
    expect(isl.stateSource).toBe('readiness');
    expect(isl.monitorErrors).toBeNull();
    expect(isl.attention).toBe(false);
  });

  it('fresh monitoring errors flip a healthy island to critical', () => {
    const p = makePassport({ slug: 's', autoScore: 92, prodScore: 90 });
    const isl = deriveScene([p], null, false, undefined, undefined, monMap(mon({ eventsLast24h: 6, unresolvedIssues: 4 }))).islands[0];
    expect(isl.state).toBe('critical');
    expect(isl.stateSource).toBe('errors');
    expect(isl.monitorErrors).toBe(4);
  });

  it('quiet-but-open issues bump a healthy island to warning', () => {
    const p = makePassport({ slug: 's', autoScore: 92, prodScore: 90 });
    const isl = deriveScene([p], null, false, undefined, undefined, monMap(mon({ unresolvedIssues: 2 }))).islands[0];
    expect(isl.state).toBe('warning');
    expect(isl.stateSource).toBe('errors');
  });

  it('the Monitoring cell surfaces the live unresolved-issue count', () => {
    const p = makePassport({ slug: 's', observabilityLevel: 'errors', monitoring: { errorTracking: 'Sentry' } });
    const isl = deriveScene([p], null, false, undefined, undefined, monMap(mon({ eventsLast24h: 3, unresolvedIssues: 7 }))).islands[0];
    const cell = isl.nodes.find((n) => n.key === 'monitoring')!;
    expect(cell.status).toBe('alert');
    expect(cell.detail).toContain('7');
  });

  it('monitoring cell falls back to static derivation when no count is bound', () => {
    const p = makePassport({ slug: 's', observabilityLevel: 'errors', monitoring: { errorTracking: 'Sentry' } });
    const isl = deriveScene([p], null, false).islands[0];
    const cell = isl.nodes.find((n) => n.key === 'monitoring')!;
    expect(cell.status).toBe('solid');
    expect(cell.detail).toBe('Sentry');
  });
});
