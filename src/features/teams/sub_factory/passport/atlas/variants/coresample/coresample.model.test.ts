import { describe, expect, it } from 'vitest';
import { byDepth, coreStats, depthTicks } from './coresample.model';
import type { AtlasRow } from '../../atlasModel';
import type { AppPassport } from '../../../passportModel';

// Real CellValues, so these exercise inkOf and inkKindOf and not a stub:
// `present` with a label reads `good`, with none reads `setup`, `bool:false`
// reads `warn`, and `pips` with nothing on reads `bad`.
const row = (key: string, ink: (p: AppPassport) => 'good' | 'setup' | 'warn' | 'bad'): AtlasRow => ({
  key, label: key, info: '', section: 'tooling',
  get: (p) => {
    const k = ink(p);
    if (k === 'warn') return { kind: 'bool', on: false };
    if (k === 'bad') return { kind: 'pips', items: [{ label: 'a', on: false }] };
    return { kind: 'present', label: k === 'good' ? 'x' : null };
  },
});

const project = (slug: string, over: Partial<AppPassport> = {}) => ({
  identity: { slug, name: slug, root: null }, ...over,
} as unknown as AppPassport);

const three = [project('a'), project('b'), project('c')];

describe('coreStats: a core states how deep it has actually been cut', () => {
  it('counts every state and reports the verdict-bearing depth', () => {
    const r = row('x', (p) => (p.identity.slug === 'a' ? 'good' : p.identity.slug === 'b' ? 'warn' : 'setup'));
    const s = coreStats(three, r);
    expect(s.total).toBe(3);
    expect(s.known).toBe(2);
    expect(s.counts).toMatchObject({ good: 1, warn: 1, setup: 1, bad: 0, info: 0, unknown: 0 });
  });

  it('reads zero depth when nobody has measured the dimension', () => {
    expect(coreStats(three, row('x', () => 'setup'))).toMatchObject({ known: 0, total: 3 });
  });

  it('counts an unreadable checkout as unknown, which is absence and not a verdict', () => {
    // `selfverify` is repo-dependent, so inkOf returns `unknown` for it.
    const r: AtlasRow = { ...row('selfverify', () => 'good'), key: 'selfverify' };
    const s = coreStats([project('a', { repoUnreadable: true }), project('b')], r);
    expect(s.counts.unknown).toBe(1);
    expect(s.known).toBe(1);
  });

  it('holds a zero-project lens without dividing by it', () => {
    expect(coreStats([], row('x', () => 'good'))).toMatchObject({ known: 0, total: 0 });
  });
});

describe('byDepth: the frontier is a silhouette, deepest core first', () => {
  const rows = [row('shallow', () => 'setup'), row('deep', () => 'good'), row('mid', (p) => (p.identity.slug === 'a' ? 'bad' : 'setup'))];

  it('orders by how many projects carry a verdict', () => {
    expect(byDepth(three, rows).map((c) => c.row.key)).toEqual(['deep', 'mid', 'shallow']);
  });

  it('keeps the lens index so the roving coordinate still addresses the right dimension', () => {
    expect(byDepth(three, rows).map((c) => c.di)).toEqual([1, 2, 0]);
  });

  it('breaks a tie by the lens order rather than arbitrarily', () => {
    const tied = [row('p', () => 'good'), row('q', () => 'good')];
    expect(byDepth(three, tied).map((c) => c.row.key)).toEqual(['p', 'q']);
  });
});

describe('depthTicks: the operator can name which of the 102 he is on', () => {
  it('marks every tenth project and always the last one', () => {
    expect(depthTicks(102)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 101]);
  });
  it('never duplicates the last index when it is already on the interval', () => {
    expect(depthTicks(11)).toEqual([0, 10]);
  });
  it('degenerates safely', () => {
    expect(depthTicks(0)).toEqual([]);
    expect(depthTicks(1)).toEqual([0]);
    expect(depthTicks(2)).toEqual([0, 1]);
  });
});
