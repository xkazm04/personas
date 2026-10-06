import { describe, expect, it } from 'vitest';
import { measured, mosaicCols, seal, splitLead } from './stampsheet.model';
import type { AtlasRow } from '../../atlasModel';
import type { AppPassport } from '../../../passportModel';

// Real CellValues, so these exercise inkOf and inkKindOf rather than a stub:
// `present` with a label reads `good`, `present` with none reads `setup` (the
// blue invitation), and `bool:false` reads `warn`.
const row = (key: string, ink: 'good' | 'setup' | 'warn'): AtlasRow => ({
  key, label: key, info: '', section: 'tooling',
  get: () => (ink === 'warn' ? { kind: 'bool', on: false } : { kind: 'present', label: ink === 'good' ? 'x' : null }),
});

const project = (over: Partial<AppPassport> = {}) => ({
  identity: { slug: 's', name: 'n', root: null },
  ...over,
} as unknown as AppPassport);

describe('splitLead: a name is cut where it already punctuates itself', () => {
  it('keeps every qualifying segment in the lead and the thing itself as the title', () => {
    expect(splitLead('Gig · Frontend · Add print styles so receipts print well'))
      .toEqual({ lead: 'Gig · Frontend', title: 'Add print styles so receipts print well' });
  });
  it('gives a two-part name a one-part lead', () => {
    expect(splitLead('Gig · Blockchain backend')).toEqual({ lead: 'Gig', title: 'Blockchain backend' });
  });
  it('leaves a plain name whole and unqualified', () => {
    expect(splitLead('personas')).toEqual({ lead: null, title: 'personas' });
  });
  it('does not invent a split from a bare middle dot with no spaces', () => {
    expect(splitLead('a·b')).toEqual({ lead: null, title: 'a·b' });
  });
});

describe('measured: the denominator the stamp states on itself', () => {
  const rows = [row('a', 'good'), row('b', 'setup'), row('c', 'warn')];
  it('counts only the dimensions carrying a verdict', () => {
    expect(measured(project(), rows)).toEqual({ known: 2, total: 3 });
  });
  it('reads zero known when the whole lens is absent', () => {
    expect(measured(project(), [row('b', 'setup')])).toEqual({ known: 0, total: 1 });
  });
});

describe('seal: the stamp carries its single worst verdict', () => {
  it('is setup when nothing has been measured, not good', () => {
    expect(seal(project(), [row('b', 'setup')])).toBe('setup');
  });
  it('is good once any dimension carries a passing verdict', () => {
    expect(seal(project(), [row('a', 'good'), row('b', 'setup')])).toBe('good');
  });
  it('is warn when a dimension is deficient but none is failing', () => {
    expect(seal(project(), [row('a', 'good'), row('c', 'warn')])).toBe('warn');
  });
  it('is unknown for an unreadable checkout whatever the rows say', () => {
    expect(seal(project({ repoUnreadable: true }), [row('a', 'good')])).toBe('unknown');
  });
});

describe('mosaicCols: a mosaic stays a block', () => {
  it('is near-square for a lens', () => {
    expect([1, 6, 10, 14].map(mosaicCols)).toEqual([1, 3, 4, 4]);
  });
  it('caps at six so thirty dimensions never become a strip', () => {
    expect(mosaicCols(30)).toBe(6);
    expect(mosaicCols(400)).toBe(6);
  });
  it('never returns zero for an empty lens', () => {
    expect(mosaicCols(0)).toBe(1);
  });
});
