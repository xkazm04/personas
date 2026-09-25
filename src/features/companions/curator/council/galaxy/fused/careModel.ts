// The folded dock's arithmetic: which subjects need the person in the scope
// the reader stands in, grouped the way the winner groups them (by category
// at the sky and in a domain, by subcategory inside a category), in the
// winner's order (within a category, subcategory first, then name).
import type { CategoryNode, GalaxyLayout, SubjectNode } from '../engine/types';
import { needsCare, subjectsIn, type ScopeNode } from './fusedModel';
import type { CareKind } from './fusedStore';

export interface CareGroup {
  key: string;
  /** The small upper line: the domain (at the sky) or the category. */
  over: string | null;
  /** The group's own name: a category, or a subcategory ('' = unsorted). */
  name: string;
  subjects: SubjectNode[];
}

/** A subject's claim colour: the same token its star is painted with. */
export function careTone(s: SubjectNode, waitingStars: Set<string>): string {
  if (s.mark === 'approved') return 'var(--gx-ok)';
  if (s.mark === 'rejected') return 'var(--gx-err)';
  if (s.mark === 'pending' || waitingStars.has(s.slug)) return 'var(--gx-warn)';
  return 'var(--gx-none)';
}

const bySubcategory = (a: SubjectNode, b: SubjectNode): number => {
  const ga = a.subcategory ?? '';
  const gb = b.subcategory ?? '';
  if (ga === gb) return a.title.localeCompare(b.title);
  if (ga === '') return -1;
  if (gb === '') return 1;
  return ga.localeCompare(gb);
};

/** The scope's subjects in the winner's reading order. */
export function orderedSubjects(layout: GalaxyLayout, scope: ScopeNode): SubjectNode[] {
  const cats: CategoryNode[] = !scope
    ? layout.domains.flatMap((d) => d.categories)
    : scope.kind === 'domain'
      ? scope.categories
      : scope.kind === 'category'
        ? [scope]
        : [scope.category];
  if (scope?.kind === 'subject') return [scope];
  return cats.flatMap((c) => c.subjects.slice().sort(bySubcategory));
}

export function subcategoryTitle(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function careGroups(
  layout: GalaxyLayout,
  scope: ScopeNode,
  waitingStars: Set<string>,
  filters: Record<CareKind, boolean>,
): { all: number; groups: CareGroup[]; count: number } {
  const all = subjectsIn(layout, scope).length;
  const subs = orderedSubjects(layout, scope).filter((s) => needsCare(s, waitingStars, filters));
  const groups: CareGroup[] = [];
  const byCategory = !scope || scope.kind === 'domain';
  for (const s of subs) {
    const key = byCategory ? s.category.id : `${s.category.id}/${s.subcategory ?? ''}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = byCategory
        ? { key, over: !scope ? s.domain.title : null, name: s.category.title, subjects: [] }
        : { key, over: s.category.title, name: s.subcategory ? subcategoryTitle(s.subcategory) : '', subjects: [] };
      groups.push(g);
    }
    g.subjects.push(s);
  }
  return { all, groups, count: subs.length };
}
