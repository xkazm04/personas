// The fused HUD's arithmetic over the product's own data: `GalaxyLayout` for
// the field and the council overlay it already carries, plus the councils in
// `councilStore`. Pure functions, no React, no canvas. A figure an instrument
// prints is computed here once, so the list, the dock, the dial and the
// tooltip can never disagree about it.
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import type { EnginePath } from '../engine/GalaxyEngine';
import type { CategoryNode, DomainNode, GalaxyLayout, GalaxyNode, SubjectNode, TechniqueNode } from '../engine/types';
import type { CareKind } from './fusedStore';

export type ScopeNode = DomainNode | CategoryNode | SubjectNode | null;

/** A decision waiting on the person, with the stars it lands on. */
export interface Decision {
  subject: CouncilSubjectState;
  stars: SubjectNode[];
  /** Registry slugs the council names that the registry does not hold. */
  missing: number;
}

export function decisionsOf(layout: GalaxyLayout | null, waiting: CouncilSubjectState[]): Decision[] {
  return waiting.map((subject) => {
    const stars = subject.registrySubjects
      .map((slug) => layout?.bySlug.get(slug))
      .filter((s): s is SubjectNode => Boolean(s));
    return { subject, stars, missing: subject.registrySubjects.length - stars.length };
  });
}

/** Why a subject needs the person: a decision waiting, a pending council, a rejection. */
export function careKinds(s: SubjectNode, waitingStars: Set<string>): CareKind[] {
  const out: CareKind[] = [];
  if (waitingStars.has(s.slug)) out.push('waiting');
  if (s.overlay && s.overlay.pending > 0) out.push('pending');
  if (s.overlay && s.overlay.rejected > 0) out.push('rejected');
  return out;
}

export function needsCare(s: SubjectNode, waitingStars: Set<string>, filters: Record<CareKind, boolean>): boolean {
  return careKinds(s, waitingStars).some((k) => filters[k]);
}

export function subjectsIn(layout: GalaxyLayout, node: ScopeNode): SubjectNode[] {
  if (!node) return layout.subjects;
  if (node.kind === 'domain') return node.categories.flatMap((c) => c.subjects);
  if (node.kind === 'category') return node.subjects;
  return [node];
}

/** The scope the care strip reads: a subject is shown among its category. */
export function careScope(path: EnginePath): ScopeNode {
  if (path.subject) return path.subject.category;
  return path.category ?? path.domain;
}

/** 0 sky, 1 domain, 2 category, 3 subject, 4 technique. */
export function levelOf(path: EnginePath): number {
  if (path.technique) return 4;
  if (path.subject) return 3;
  if (path.category) return 2;
  if (path.domain) return 1;
  return 0;
}

export function focusNode(path: EnginePath): ScopeNode {
  return path.subject ?? path.category ?? path.domain;
}

/** The level below where the reader stands: the rows of the nested list. */
export function childrenOf(layout: GalaxyLayout, node: GalaxyNode | null): GalaxyNode[] {
  if (!node) return layout.domains;
  if (node.kind === 'domain') return node.categories;
  if (node.kind === 'category') return node.subjects;
  if (node.kind === 'subject') return node.techniques;
  return [];
}

/** The figure each row prints: subjects, techniques, or a technique's laws. */
export function countOf(node: GalaxyNode): number {
  if (node.kind === 'technique') return node.laws.length;
  if (node.kind === 'subject') return node.techniques.length;
  if (node.kind === 'category') return node.subjects.length;
  return node.subjectCount;
}

/** How much lies below a node, per rung. Null is not measured, never zero. */
export function depthBelow(layout: GalaxyLayout, node: ScopeNode): Array<number | null> {
  const d: Array<number | null> = [null, null, null, null, null];
  if (!node) {
    d[1] = layout.domains.length;
    d[2] = layout.domains.reduce((n, x) => n + x.categories.length, 0);
    d[3] = layout.subjects.length;
    d[4] = layout.subjects.reduce((n, s) => n + s.techniques.length, 0);
  } else if (node.kind === 'domain') {
    d[2] = node.categories.length;
    d[3] = node.subjectCount;
    d[4] = node.techniqueCount;
  } else if (node.kind === 'category') {
    d[3] = node.subjects.length;
    d[4] = node.techniqueCount;
  } else {
    d[4] = node.techniques.length;
  }
  return d;
}

/** A sounding's bar: the log of what lies below, against the whole corpus. */
export function soundWidth(n: number, total: number): number {
  return Math.round(Math.max(6, (Math.log10(n + 1) / Math.log10(total + 1)) * 50));
}

const ACRONYMS = new Set(['llm', 'llms', 'ui', 'ux', 'ai', 'api', 'mcp', 'ci', 'sql', 'p2p', 'pii', 'hitl', 'ipc', 'dag', 'tts', 'kpi', 'json', 'http', 'sdk', 'id', 'url', 'os', 'db', 'rag', 'io', 'cli', 'csv', 'pdf', 'svg', 'gpu', 'cpu', 'ttl', 'sla', 'slo']);
const SMALL = new Set(['and', 'or', 'of', 'to', 'the', 'in', 'for', 'vs', 'a', 'an', 'on', 'at', 'by', 'with', 'per', 'not', 'is', 'as']);

/** A technique's slug as the winner prints it: title case, initialisms kept. */
export function techniqueTitle(t: TechniqueNode): string {
  return t.slug
    .split('-')
    .filter(Boolean)
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function nodeTitle(n: GalaxyNode): string {
  return n.kind === 'technique' ? techniqueTitle(n) : n.title;
}

/** The node's siblings, in rank order: what `[` and `]` step through. */
export function siblingsOf(layout: GalaxyLayout, n: GalaxyNode): GalaxyNode[] {
  if (n.kind === 'technique') return n.subject.techniques;
  if (n.kind === 'subject') return n.category.subjects;
  if (n.kind === 'category') return n.domain.categories;
  return layout.domains;
}

export function parentCount(layout: GalaxyLayout, n: GalaxyNode): number {
  return siblingsOf(layout, n).length;
}
