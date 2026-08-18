import { describe, expect, it } from 'vitest';

import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';

import {
  buildHierarchyIndex,
  groupSubjectsByCategory,
  HIERARCHY_SEARCH_MIN,
  isExternalHref,
  resolveDocLink,
  searchHierarchy,
  subjectMatchMap,
} from '../hierarchyModel';

function makeGraph(): HierarchyGraph {
  return {
    categories: [
      // Deliberately out of declaration order: `order` must win.
      { id: 'client-architecture', title: 'Client Architecture', order: 2 },
      { id: 'ui-surfaces', title: 'UI Surfaces', order: 1 },
    ],
    subjects: [
      {
        slug: 'table',
        title: 'Table',
        summary: 'Comparison across uniform attributes.',
        file: 'docs/concepts/paths/table/table.md',
        category: 'ui-surfaces',
        status: 'forged',
        techniques: ['pagination'],
        sharedTechniques: [],
        applications: [
          { file: 'docs/concepts/paths/table/applications/react-table.md', stack: 'react', technique: 'pagination' },
        ],
        evidence: ['src/a.ts'],
        counterEvidence: [],
        deviations: ['table-no-error-state'],
        legacyCount: 1,
      },
      {
        slug: 'feed',
        title: 'Feed',
        summary: 'A feed orders by recency.',
        file: 'docs/concepts/paths/feed/feed.md',
        category: 'ui-surfaces',
        status: 'draft',
        techniques: [],
        sharedTechniques: [{ technique: 'pagination', owner: 'table' }],
        applications: [],
        evidence: [],
        counterEvidence: [],
        deviations: [],
        legacyCount: 0,
      },
      {
        slug: 'state-sync',
        title: 'State Sync',
        summary: 'Keeping client caches honest.',
        file: 'docs/concepts/paths/state-sync/state-sync.md',
        category: 'client-architecture',
        status: null,
        techniques: [],
        sharedTechniques: [],
        applications: [],
        evidence: [],
        counterEvidence: [],
        deviations: [],
        legacyCount: 0,
      },
      {
        slug: 'orphan',
        title: 'Orphan',
        summary: 'No category assigned.',
        file: 'docs/concepts/paths/orphan/orphan.md',
        category: null,
        status: 'draft',
        techniques: [],
        sharedTechniques: [],
        applications: [],
        evidence: [],
        counterEvidence: [],
        deviations: [],
        legacyCount: 0,
      },
    ],
    techniques: [
      {
        slug: 'pagination',
        subject: 'table',
        title: 'Pagination',
        summary: 'Cursor over offset.',
        file: 'docs/concepts/paths/table/techniques/pagination.md',
        status: 'forged',
        laws: ['gate-sees-target'],
        sharedWith: ['feed'],
      },
    ],
    laws: [{ id: 'gate-sees-target', title: 'Gate sees target', summary: 'A gate must observe the behavior it protects.' }],
    crossLinks: [],
    corpusMap: [{ legacyFile: 'tables.md', subject: 'table' }],
    warnings: [],
    source: { root: '/repo', present: true, reason: null },
    counts: { subjects: 4, techniques: 1, applications: 1, evidence: 1, legacyMapped: 1 },
  };
}

describe('groupSubjectsByCategory', () => {
  it('orders groups by categories[].order, not declaration order', () => {
    const groups = groupSubjectsByCategory(makeGraph());
    expect(groups.map((g) => g.id)).toEqual(['ui-surfaces', 'client-architecture', null]);
  });

  it('collects unassigned subjects into a trailing null group', () => {
    const groups = groupSubjectsByCategory(makeGraph());
    const last = groups[groups.length - 1];
    expect(last.id).toBeNull();
    expect(last.subjects.map((s) => s.slug)).toEqual(['orphan']);
  });

  it('rolls up subject counts and status distribution per group', () => {
    const groups = groupSubjectsByCategory(makeGraph());
    const ui = groups[0];
    expect(ui.subjectCount).toBe(2);
    expect(ui.statusCounts).toEqual({ forged: 1, draft: 1 });
    // A null status counts as 'unknown', never dropped.
    const client = groups[1];
    expect(client.statusCounts).toEqual({ unknown: 1 });
  });

  it('sorts subjects alphabetically by title within a group', () => {
    const groups = groupSubjectsByCategory(makeGraph());
    expect(groups[0].subjects.map((s) => s.title)).toEqual(['Feed', 'Table']);
  });

  it('drops empty categories rather than rendering hollow headers', () => {
    const graph = makeGraph();
    graph.categories.push({ id: 'operations', title: 'Operations', order: 3 });
    const groups = groupSubjectsByCategory(graph);
    expect(groups.some((g) => g.id === 'operations')).toBe(false);
  });
});

describe('search', () => {
  const graph = makeGraph();
  const index = buildHierarchyIndex(graph);

  it('returns nothing under the minimum query length', () => {
    expect(searchHierarchy(index, 'p'.repeat(HIERARCHY_SEARCH_MIN - 1))).toEqual([]);
  });

  it('ranks a subject title hit above a technique hit of the same strength', () => {
    // 'ta' prefixes 'table' (subject) — subject weight must put it first.
    const results = searchHierarchy(index, 'table');
    expect(results[0]).toMatchObject({ kind: 'subject', subject: 'table' });
  });

  it('finds techniques and carries the parent subject slug', () => {
    const results = searchHierarchy(index, 'pagination');
    const tech = results.find((r) => r.kind === 'technique');
    expect(tech).toMatchObject({ kind: 'technique', subject: 'table', technique: 'pagination' });
  });

  it('finds applications by stack', () => {
    const results = searchHierarchy(index, 'react');
    expect(results.some((r) => r.kind === 'application' && r.subject === 'table')).toBe(true);
  });

  it('discounts summary-only hits below title hits', () => {
    // 'recency' appears only in feed's summary; 'feed' matches feed's title.
    const bySummary = searchHierarchy(index, 'recency');
    expect(bySummary).toHaveLength(1);
    expect(bySummary[0].kind).toBe('subject');
    const byTitle = searchHierarchy(index, 'feed');
    expect(byTitle[0].score).toBeGreaterThan(bySummary[0].score);
  });

  it('subjectMatchMap distinguishes direct hits from child-hint hits', () => {
    const map = subjectMatchMap(searchHierarchy(index, 'pagination'));
    // table owns the technique — child hit; feed shares it — also child hit.
    expect(map.get('table')).toMatchObject({ direct: false, childHint: 'Pagination' });
  });

  it('subjectMatchMap marks a subject hit as direct', () => {
    const map = subjectMatchMap(searchHierarchy(index, 'table'));
    expect(map.get('table')?.direct).toBe(true);
  });
});

describe('resolveDocLink', () => {
  const graph = makeGraph();
  const from = 'docs/concepts/paths/table/table.md';

  it('leaves external links alone', () => {
    expect(isExternalHref('https://example.com')).toBe(true);
    expect(resolveDocLink(from, 'https://example.com', graph)).toBeNull();
    expect(resolveDocLink(from, 'mailto:a@b.c', graph)).toBeNull();
  });

  it('resolves a sibling subject golden path', () => {
    expect(resolveDocLink(from, '../feed/feed.md', graph)).toEqual({
      kind: 'subject',
      subject: 'feed',
    });
  });

  it('resolves a subject folder link (no file) to the subject', () => {
    expect(resolveDocLink(from, '../feed', graph)).toEqual({ kind: 'subject', subject: 'feed' });
  });

  it('resolves a technique link with the reader-issued file path', () => {
    expect(resolveDocLink(from, 'techniques/pagination.md', graph)).toEqual({
      kind: 'technique',
      subject: 'table',
      technique: 'pagination',
      file: 'docs/concepts/paths/table/techniques/pagination.md',
    });
  });

  it('resolves a cross-subject technique link', () => {
    const fromFeed = 'docs/concepts/paths/feed/feed.md';
    expect(resolveDocLink(fromFeed, '../table/techniques/pagination.md', graph)).toMatchObject({
      kind: 'technique',
      subject: 'table',
      technique: 'pagination',
    });
  });

  it('resolves an application link', () => {
    expect(resolveDocLink(from, 'applications/react-table.md', graph)).toEqual({
      kind: 'application',
      subject: 'table',
      file: 'docs/concepts/paths/table/applications/react-table.md',
    });
  });

  it('resolves a known law anchor in _laws.md', () => {
    expect(resolveDocLink(from, '../_laws.md#gate-sees-target', graph)).toEqual({
      kind: 'law',
      law: 'gate-sees-target',
      file: 'docs/concepts/paths/_laws.md',
    });
  });

  it('rejects an unknown law anchor rather than faking a target', () => {
    expect(resolveDocLink(from, '../_laws.md#no-such-law', graph)).toBeNull();
  });

  it('resolves other docs/concepts files as plain docs, keeping the anchor', () => {
    expect(
      resolveDocLink(from, '../../golden-path-deferred-fixes.md#table-no-error-state', graph),
    ).toEqual({
      kind: 'doc',
      file: 'docs/concepts/golden-path-deferred-fixes.md',
      anchor: 'table-no-error-state',
    });
  });

  it('resolves legacy golden-paths docs as plain docs', () => {
    expect(resolveDocLink(from, '../../golden-paths/tables.md', graph)).toEqual({
      kind: 'doc',
      file: 'docs/concepts/golden-paths/tables.md',
      anchor: null,
    });
  });

  it('returns null for unknown subjects, escapes, and anchors-only hrefs', () => {
    expect(resolveDocLink(from, '../nope/nope.md', graph)).toBeNull();
    expect(resolveDocLink(from, '../../../../etc/passwd', graph)).toBeNull();
    expect(resolveDocLink(from, '#local-anchor', graph)).toBeNull();
  });

  it('returns null for paths outside docs/concepts', () => {
    expect(resolveDocLink(from, '../../../../src/main.tsx', graph)).toBeNull();
  });

  it('resolves an unknown technique file under a known subject to null', () => {
    expect(resolveDocLink(from, 'techniques/missing.md', graph)).toBeNull();
  });
});
