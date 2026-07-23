import { describe, it, expect } from 'vitest';

import { deriveScene } from '../lib/deriveScene';
import { DIM_INK } from '../lib/ink';
import { makePassport } from './passportFactory';

const island = (families?: Parameters<typeof deriveScene>[6], ideaAt?: Map<string, string | null>) =>
  deriveScene([makePassport({ slug: 's' })], null, false, undefined, ideaAt, undefined, families).islands[0];

describe('deriveScene — honest unknown cells on family failure', () => {
  it('KPI cell → unknown (not fake "absent") when the KPI family failed', () => {
    const cell = island({ kpiUnknown: true }).nodes.find((n) => n.key === 'kpi')!;
    expect(cell.status).toBe('unknown');
    expect(cell.detail).toBeNull();
  });

  it('Ideas cell → unknown (not fake "never scanned") when the scans family failed', () => {
    const cell = island({ scansUnknown: true }, new Map([['s', null]])).nodes.find((n) => n.key === 'ideas')!;
    expect(cell.status).toBe('unknown');
    expect(cell.days).toBeNull();
  });

  it('no family failure → the cells keep their honest absent state, never unknown', () => {
    const nodes = island().nodes;
    expect(nodes.find((n) => n.key === 'kpi')!.status).toBe('absent');
    expect(nodes.find((n) => n.key === 'ideas')!.status).toBe('absent');
  });

  it('scansUnknown does not bleed into other cells', () => {
    const nodes = island({ scansUnknown: true }).nodes;
    // Only Ideas reads the scan family; DB (no live input) stays as derived.
    expect(nodes.find((n) => n.key === 'db')!.status).not.toBe('unknown');
  });
});

describe('ink — unknown is a distinct muted tone', () => {
  it('unknown ink differs from absent ink', () => {
    expect(DIM_INK.unknown).not.toBe(DIM_INK.absent);
    expect(DIM_INK.unknown).toContain('color-mix');
  });
});
