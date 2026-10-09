import { describe, expect, it } from 'vitest';

import { en } from '@/i18n/en';

import { docRow } from '../../../../journey/__tests__/detailFixtures';
import { estateDocs, estateRelated, relatedItem } from '../../../../journey/__tests__/docsFixtures';
import { evidenceRowsFor } from '../../../blocks/evidenceRows';
import { docsToFix, splitDocPath } from '../../docsModel';
import { matchBacklog, titleNamesDoc } from '../backlogMatch';
import { ASK_PATH_CAP, fixDocPrompt, fixDocsPrompt } from '../docsAsk';
import { buildEstate, dirKey, estateDepth, filterGroups, matchesFilter, NO_FILTER, toggleStatus } from '../estateModel';
import { dayKey, daysAgo, groupByDay } from '../logModel';
import { cleanDocsNeeded } from '../ShareCard';

const tx = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
// The English catalog and a plain slot-filler: the two members of the view model the builders read.
const words = () => ({ dl: en.plugins.dev_lifecycle, tx }) as unknown as Parameters<typeof fixDocsPrompt>[0];
const project = { name: 'Acme', id: 'p-1' };

describe('the doc estate', () => {
  it('groups docs by their first two folders, root files in the root folder', () => {
    expect(dirKey('docs/features/vault/vault.md', 2)).toBe('docs/features');
    expect(dirKey('README.md', 2)).toBe('');
    const tiles = buildEstate(estateDocs());
    expect(tiles.map((t) => [t.dir, t.docs.length])).toEqual([
      ['docs/features', 12], ['docs/concepts', 9], ['docs/architecture', 6], ['docs/development', 5], ['docs/design', 5], ['', 3],
    ]);
  });

  it('ranks folders worst first and puts each folder rot first', () => {
    const [features, concepts] = buildEstate(estateDocs());
    expect(features!.worst).toBe('broken');
    expect(features!.counts).toEqual({ broken: 2, stale: 0, unverifiable: 0, clean: 10 });
    expect(features!.docs.slice(0, 2).map((d) => d.status)).toEqual(['broken', 'broken']);
    expect(concepts!.worst).toBe('stale');
    expect(concepts!.docs[0]!.status).toBe('stale');
  });

  it('goes one folder deeper when two segments would put every doc in one folder', () => {
    const rows = [docRow('docs/features/a/x.md', 'clean'), docRow('docs/features/b/y.md', 'stale')];
    expect(estateDepth(rows)).toBe(3);
    expect(buildEstate(rows).map((t) => t.dir)).toEqual(['docs/features/b', 'docs/features/a']);
  });

  it('filters by status chips (any of them) and by every search term in the path', () => {
    const rows = estateDocs();
    const stale = { statuses: toggleStatus(new Set(), 'stale'), query: '' };
    expect(filterGroups(rows, stale).map((g) => [g.status, g.docs.length])).toEqual([['stale', 5]]);
    const both = { statuses: toggleStatus(stale.statuses, 'broken'), query: '' };
    expect(filterGroups(rows, both).map((g) => g.status)).toEqual(['broken', 'stale']);
    expect(toggleStatus(both.statuses, 'stale').has('stale')).toBe(false);
    const search = { statuses: new Set<never>(), query: 'GOLDEN  toasts' };
    expect(rows.filter((r) => matchesFilter(r, search)).map((r) => r.docPath)).toEqual(['docs/concepts/golden-paths/toasts.md']);
    expect(rows.every((r) => matchesFilter(r, NO_FILTER))).toBe(true);
  });

  it('splits a path into a quiet folder and a strong file name', () => {
    expect(splitDocPath('docs/features/vault.md')).toEqual({ dir: 'docs/features/', name: 'vault.md' });
    expect(splitDocPath('README.md')).toEqual({ dir: '', name: 'README.md' });
  });
});

describe('backlog items tied to docs', () => {
  it('matches a path only as a whole token', () => {
    expect(titleNamesDoc('Refresh stale doc: docs/a.md', 'docs/a.md')).toBe(true);
    expect(titleNamesDoc('docs/a.md is behind its sources', 'docs/a.md')).toBe(true);
    expect(titleNamesDoc('Fix docs/a.md.', 'docs/a.md')).toBe(true);
    expect(titleNamesDoc('Refresh stale doc: docs/a.md.bak', 'docs/a.md')).toBe(false);
    expect(titleNamesDoc('Refresh stale doc: old/docs/a.md', 'docs/a.md')).toBe(false);
  });

  it('ties each doc-rot item to the doc its title names; others stay unmatched and other sources are ignored', () => {
    const m = matchBacklog(estateDocs().map((d) => d.docPath), estateRelated());
    expect(m.byDoc.get('docs/features/vault/vault.md')!.map((i) => i.id)).toEqual(['rot-vault']);
    expect(m.docOf.get('rot-toasts')).toBe('docs/concepts/golden-paths/toasts.md');
    expect(m.docOf.has('rot-old')).toBe(false);
    expect(m.docOf.has('ov-docs')).toBe(false);
  });

  it('prefers the longest listed path a title names', () => {
    const m = matchBacklog(['a.md', 'docs/a.md'], [relatedItem('x', 'Refresh stale doc: docs/a.md')]);
    expect(m.docOf.get('x')).toBe('docs/a.md');
  });
});

describe('what Athena is asked', () => {
  it('names a broken doc, every reference that is gone, and its changed sources', () => {
    const fleet = estateDocs().find((d) => d.docPath === 'docs/features/fleet/fleet.md')!;
    const text = fixDocPrompt(words(), project, fleet)!;
    expect(text).toContain('docs/features/fleet/fleet.md');
    expect(text).toContain('Acme (id p-1)');
    expect(text).toContain('src/features/fleet/FleetGrid.tsx');
    expect(text).toContain('src/features/fleet/fleetModel.ts');
    expect(text).toContain('describe_lifecycle');
  });

  it('names a stale doc and all its changed sources; an unverifiable one says why; a clean one asks nothing', () => {
    const docs = estateDocs();
    const stale = fixDocPrompt(words(), project, docs.find((d) => d.docPath.endsWith('warm-verification-service.md'))!)!;
    expect(stale).toContain('scripts/gate/census.mjs');
    expect(fixDocPrompt(words(), project, docs.find((d) => d.status === 'unverifiable')!)).toContain('names no source');
    expect(fixDocPrompt(words(), project, docs.find((d) => d.status === 'clean')!)).toBeNull();
  });

  it('the bulk prompt lists every broken and stale doc, capped with "and N more"', () => {
    const { broken, stale } = docsToFix(estateDocs());
    expect(broken).toHaveLength(2);
    expect(stale).toHaveLength(5);
    const text = fixDocsPrompt(words(), project, [...broken, ...stale]);
    for (const d of [...broken, ...stale]) expect(text).toContain(d);
    const many = Array.from({ length: ASK_PATH_CAP + 4 }, (_, i) => `docs/d${i}.md`);
    expect(fixDocsPrompt(words(), project, many)).toContain('and 4 more');
  });
});

describe('the clean share and the change log', () => {
  it('counts the clean docs still missing for the line', () => {
    expect(cleanDocsNeeded(32, 39, 90)).toBe(4);
    expect(cleanDocsNeeded(36, 40, 90)).toBe(0);
    expect(cleanDocsNeeded(0, 0, 90)).toBe(0);
  });

  it('cuts the log into days in one named zone, keeping the order', () => {
    const rows = evidenceRowsFor('docs', [
      { sourceKind: 'commit', sourceRef: 'a', title: 'a', occurredAt: '2026-10-08T23:30:00Z', outcomes: [] },
      { sourceKind: 'commit', sourceRef: 'b', title: 'b', occurredAt: '2026-10-08T01:00:00Z', outcomes: [] },
      { sourceKind: 'commit', sourceRef: 'c', title: 'c', occurredAt: '2026-10-07T12:00:00Z', outcomes: [] },
    ]);
    expect(groupByDay(rows, 'UTC').map((d) => [d.key, d.rows.length])).toEqual([['2026-10-08', 2], ['2026-10-07', 1]]);
    // In Prague the late change is already on the 9th.
    expect(groupByDay(rows, 'Europe/Prague').map((d) => d.key)).toEqual(['2026-10-09', '2026-10-08', '2026-10-07']);
    expect(dayKey('not a time', 'UTC')).toBe('');
    expect(daysAgo('2026-10-07', '2026-10-08')).toBe(1);
    expect(daysAgo('', '2026-10-08')).toBeNull();
  });
});
