import { describe, expect, it } from 'vitest';
import { bandOf, collapse, groupCohorts } from './cohorts.model';
import type { AtlasRow } from '../../atlasModel';
import type { AppPassport } from '../../../passportModel';

// Real CellValues, so these exercise inkOf / inkKindOf and not a stub.
const row = (key: string, ink: (p: AppPassport) => 'good' | 'setup' | 'warn'): AtlasRow => ({
  key, label: key, info: '', section: 'tooling',
  get: (p) => (ink(p) === 'warn' ? { kind: 'bool', on: false } : { kind: 'present', label: ink(p) === 'good' ? 'x' : null }),
});

const project = (slug: string, over: Partial<AppPassport> = {}) => ({
  identity: { slug, name: slug, root: null }, ...over,
} as unknown as AppPassport);

/** Four projects of which three are identical: the real portfolio's shape. */
const four = [project('a'), project('b'), project('c'), project('d')];
const scanned = new Set(['a']);
const rows = [
  row('x', (p) => (scanned.has(p.identity.slug) ? 'good' : 'setup')),
  row('y', (p) => (scanned.has(p.identity.slug) ? 'warn' : 'setup')),
];

describe('groupCohorts: the portfolio collapses to the shapes it really has', () => {
  it('puts every project with an identical passport in one band', () => {
    const c = groupCohorts(four, rows);
    expect(c).toHaveLength(2);
    expect(c[0]?.members.map((m) => m.p.identity.slug)).toEqual(['b', 'c', 'd']);
    expect(c[1]?.members.map((m) => m.p.identity.slug)).toEqual(['a']);
  });

  it('orders the largest band first and keeps the project sort order inside it', () => {
    expect(groupCohorts(four, rows)[0]?.members.map((m) => m.pi)).toEqual([1, 2, 3]);
  });

  it('breaks a tie by first appearance, so re-sorting does not reshuffle the bands', () => {
    const two = groupCohorts([project('a'), project('z')], [row('x', (p) => (p.identity.slug === 'a' ? 'good' : 'warn'))]);
    expect(two.map((c) => c.members[0]?.p.identity.slug)).toEqual(['a', 'z']);
  });

  it('separates two projects that differ in exactly one cell', () => {
    const r = [row('x', () => 'good'), row('y', (p) => (p.identity.slug === 'a' ? 'good' : 'warn'))];
    expect(groupCohorts([project('a'), project('b')], r)).toHaveLength(2);
  });

  it('counts the verdict-bearing dimensions of the shape, not of a member', () => {
    const c = groupCohorts(four, rows);
    expect(c[0]?.known).toBe(0);
    expect(c[1]?.known).toBe(2);
  });

  it('makes every project one band of its own when the lens is empty', () => {
    // No dimensions means one empty signature, so the whole portfolio is one shape.
    expect(groupCohorts(four, [])).toHaveLength(1);
  });

  it('holds an empty portfolio', () => {
    expect(groupCohorts([], rows)).toEqual([]);
  });
});

describe('bandOf: the roving project still finds its band', () => {
  it('finds the band holding a project index', () => {
    const c = groupCohorts(four, rows);
    expect(bandOf(c, 0)).toBe(1);
    expect(bandOf(c, 2)).toBe(0);
  });
  it('reports -1 rather than 0 for an index nothing holds', () => {
    expect(bandOf(groupCohorts(four, rows), 99)).toBe(-1);
    expect(bandOf([], 0)).toBe(-1);
  });
});

describe('collapse: the compression is stated, not claimed', () => {
  it('reports shapes against projects', () => {
    expect(collapse(groupCohorts(four, rows), four.length)).toEqual({ shapes: 2, projects: 4 });
  });
});
