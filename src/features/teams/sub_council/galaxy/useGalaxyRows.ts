// What the docked list shows, derived from the ONE focus in the store.
//
// The list is the galaxy's text alternative: everything the canvas draws is
// reachable here by keyboard, in name order, with the same rank number the
// canvas prints. Under council focus the list becomes the council's own star
// set, A to Z, so the sidebar and the field never describe different places.
import { useMemo } from 'react';

import { matchesQuery } from '@/lib/text/search';

import type { CouncilMark, GalaxyLayout, GalaxyNode, GalaxyFocus } from './engine/types';

export type RailLevel = 'domain' | 'category' | 'subject' | 'technique' | 'council';

export interface RailRow {
  key: string;
  node: GalaxyNode;
  rank: number;
  name: string;
  count: number;
  /** Which noun the count is of, so the row can label it honestly. */
  countKind: 'children' | 'techniques' | 'laws';
  marks: CouncilMark[];
  /** Subcategory heading this row opens, when it opens one. */
  groupKey: string | null;
  groupCount: number;
}

export interface RailModel {
  level: RailLevel;
  rows: RailRow[];
  /** Rows before the name filter, so "0 of 58" can be said honestly. */
  total: number;
}

function rollUp(marks: CouncilMark[]): CouncilMark[] {
  const out: CouncilMark[] = [];
  if (marks.includes('approved')) out.push('approved');
  if (marks.includes('rejected')) out.push('rejected');
  if (marks.includes('pending')) out.push('pending');
  return out.length ? out : ['none'];
}

function humanise(slug: string): string {
  return slug.replace(/-/g, ' ');
}

function nodesFor(layout: GalaxyLayout, focus: GalaxyFocus): { level: RailLevel; nodes: GalaxyNode[] } {
  if (focus.kind === 'council') {
    const nodes = focus.registrySubjects
      .map((slug) => layout.bySlug.get(slug))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
    return { level: 'council', nodes };
  }
  if (focus.kind === 'none') return { level: 'domain', nodes: layout.domains };
  const domain = layout.domains.find((d) => d.slug === focus.domainSlug);
  if (!domain) return { level: 'domain', nodes: layout.domains };
  const category = domain.categories.find((c) => c.id === focus.categoryId);
  if (!category) return { level: 'category', nodes: domain.categories };
  const subject = category.subjects.find((s) => s.slug === focus.subjectSlug);
  if (!subject) return { level: 'subject', nodes: category.subjects };
  return { level: 'technique', nodes: subject.techniques };
}

function toRow(node: GalaxyNode, showGroups: boolean, previousGroup: string | null): RailRow {
  if (node.kind === 'domain') {
    return {
      key: node.slug,
      node,
      rank: node.rank,
      name: node.title,
      count: node.subjectCount,
      countKind: 'children',
      marks: rollUp(
        (['approved', 'rejected', 'pending'] as CouncilMark[]).filter((m) => node.counts[m] > 0),
      ),
      groupKey: null,
      groupCount: 0,
    };
  }
  if (node.kind === 'category') {
    return {
      key: node.id,
      node,
      rank: node.rank,
      name: node.title,
      count: node.subjects.length,
      countKind: 'children',
      marks: rollUp(node.subjects.map((s) => s.mark)),
      groupKey: null,
      groupCount: 0,
    };
  }
  if (node.kind === 'subject') {
    const opensGroup = showGroups && node.wedge.key !== previousGroup;
    return {
      key: node.slug,
      node,
      rank: node.rank,
      name: node.title,
      count: node.techniques.length,
      countKind: 'techniques',
      marks: [node.mark],
      groupKey: opensGroup ? node.wedge.key : null,
      groupCount: opensGroup ? node.wedge.n : 0,
    };
  }
  return {
    key: `${node.subject.slug}/${node.slug}`,
    node,
    rank: node.rank,
    name: humanise(node.slug),
    count: node.laws.length,
    countKind: 'laws',
    marks: [],
    groupKey: null,
    groupCount: 0,
  };
}

export function useGalaxyRows(layout: GalaxyLayout | null, focus: GalaxyFocus, filter: string): RailModel {
  return useMemo(() => {
    if (!layout) return { level: 'domain', rows: [], total: 0 };
    const { level, nodes } = nodesFor(layout, focus);
    const needle = filter.trim();
    const visible = needle
      ? nodes.filter((n) => matchesQuery(n.kind === 'technique' ? n.slug : n.title, needle))
      : nodes;

    // Wedge headings only make sense at subject level, in a category that has
    // more than one wedge, and only when the list is not being filtered.
    const first = visible[0];
    const showGroups =
      level === 'subject' && !needle && first?.kind === 'subject' && first.category.wedges.length > 1;

    let previousGroup: string | null = null;
    const rows = visible.map((node) => {
      const row = toRow(node, showGroups, previousGroup);
      if (row.groupKey !== null) previousGroup = row.groupKey;
      return row;
    });
    return { level, rows, total: nodes.length };
  }, [layout, focus, filter]);
}
