// The field, laid out once per dataset.
//
// Ported verbatim in geometry from `docs/design/council-reference/index.html`
// (the layout block at :401-461): ten globular clusters relaxed until none
// collide, categories as sub-discs with rank 1 nearest the core, subcategory
// wedges A to Z clockwise from twelve, subjects spiralling outward inside
// their wedge, techniques on a sunflower spiral around their subject. Every
// rank is the 1-based position in NAME order, which is the same number the
// docked list prints.
import type { CouncilOverlay } from '@/lib/bindings/CouncilOverlay';
import type { RegistryGalaxy } from '@/lib/bindings/RegistryGalaxy';

import type {
  CategoryNode,
  CouncilMark,
  DomainNode,
  Dust,
  GalaxyLayout,
  SubjectNode,
  TechniqueNode,
  Wedge,
} from './types';

export const TAU = Math.PI * 2;
/** The golden angle. Every spiral in the field is driven by it. */
export const GOLDEN_ANGLE = 2.399963229728653;

interface Relaxable {
  x: number;
  y: number;
  r: number;
  pad: number;
}

/** Push overlapping discs apart until they clear each other. */
function relax(items: Relaxable[], iterations: number): void {
  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const need = a.r + b.r + a.pad;
        if (d < need) {
          const f = ((need - d) / d) * 0.5;
          a.x -= dx * f;
          a.y -= dy * f;
          b.x += dx * f;
          b.y += dy * f;
        }
      }
    }
  }
}

/**
 * Council signal on one star. A subject absent from the overlay has never
 * been councilled — which is `none`, a different thing from a zero count.
 */
export function markOf(row: { approved: number; rejected: number; pending: number } | null | undefined): CouncilMark {
  if (!row) return 'none';
  if (row.rejected > 0) return 'rejected';
  if (row.approved > 0) return 'approved';
  if (row.pending > 0) return 'pending';
  return 'none';
}

function byTitle(a: { title: string }, b: { title: string }): number {
  return a.title.localeCompare(b.title);
}

function buildDust(boundRadius: number): Dust[] {
  const out: Dust[] = [];
  let seed = 23;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 280; i += 1) {
    const a = rnd() * TAU;
    const r = boundRadius * 0.2 + rnd() * boundRadius * 1.15;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, s: rnd() });
  }
  return out;
}

function layoutTechniques(subject: SubjectNode): void {
  subject.techniques.forEach((technique, i) => {
    const a = i * GOLDEN_ANGLE;
    const r = 13 * Math.sqrt((i + 0.5) / subject.techniques.length);
    technique.x = subject.x + Math.cos(a) * r;
    technique.y = subject.y + Math.sin(a) * r;
  });
}

function layoutCategory(category: CategoryNode, overlay: Map<string, CouncilOverlay['subjects'][number]>): void {
  const groups = new Map<string, SubjectNode[]>();
  for (const s of category.subjects) {
    const key = s.subcategory ?? '';
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }
  const keys = [...groups.keys()].sort();
  let a0 = -Math.PI / 2;
  for (const key of keys) {
    const arr = groups.get(key) ?? [];
    const span = (TAU * arr.length) / category.subjects.length;
    const wedge: Wedge = { key, a0, a1: a0 + span, mid: a0 + span / 2, n: arr.length };
    category.wedges.push(wedge);
    const inner = category.r * 0.22;
    const outer = category.r * 0.93;
    arr.forEach((s, si) => {
      const t = (si + 0.5) / arr.length;
      const rad = inner + (outer - inner) * Math.sqrt(t);
      const ang = a0 + (span * ((si * GOLDEN_ANGLE) % TAU)) / TAU;
      s.x = category.x + Math.cos(ang) * rad;
      s.y = category.y + Math.sin(ang) * rad;
      s.wedge = wedge;
      const row = overlay.get(s.slug) ?? null;
      s.overlay = row;
      s.mark = markOf(row);
      category.domain.counts[s.mark] += 1;
      layoutTechniques(s);
    });
    a0 += span;
  }
}

/** Build the whole field. Pure, deterministic and independent of the canvas. */
export function buildLayout(galaxy: RegistryGalaxy, overlay: CouncilOverlay | null): GalaxyLayout {
  const overlayBySlug = new Map((overlay?.subjects ?? []).map((s) => [s.slug, s]));
  const sortedDomains = galaxy.domains.slice().sort(byTitle);
  const subjects: SubjectNode[] = [];

  // Paired with its domain rather than parked in a side array: a positional
  // lookup here would have to default its miss, and a count that defaults to
  // zero cannot tell "this cluster is empty" from "we did not look".
  let maxSubjects = 0;
  const counted = sortedDomains.map((raw) => {
    const count = raw.categories.reduce((acc, c) => acc + c.subjects.length, 0);
    maxSubjects = Math.max(maxSubjects, count);
    return { raw, count };
  });

  const domains: DomainNode[] = counted.map(({ raw, count }, i) => {
    const rr = 520 * Math.sqrt((i + 0.6) / sortedDomains.length) * 1.9;
    const a = i * GOLDEN_ANGLE;
    return {
      kind: 'domain',
      slug: raw.slug,
      title: raw.title,
      rank: i + 1,
      x: Math.cos(a) * rr,
      y: Math.sin(a) * rr,
      r: 110 + 250 * Math.sqrt(count / Math.max(1, maxSubjects)),
      pad: 64,
      categories: [],
      subjectCount: count,
      techniqueCount: 0,
      lawCount: raw.laws.length,
      counts: { none: 0, approved: 0, rejected: 0, pending: 0 },
    };
  });
  relax(domains, 220);

  domains.forEach((domain, di) => {
    const raw = sortedDomains[di];
    if (!raw) return;
    const cats = raw.categories.slice().sort(byTitle);
    let maxInCat = 0;
    for (const c of cats) maxInCat = Math.max(maxInCat, c.subjects.length);

    domain.categories = cats.map((rawCat, ci) => {
      const rr = domain.r * 0.58 * Math.sqrt((ci + 0.55) / cats.length);
      const a = ci * GOLDEN_ANGLE;
      const node: CategoryNode = {
        kind: 'category',
        id: rawCat.id,
        title: rawCat.title,
        rank: ci + 1,
        x: domain.x + Math.cos(a) * rr,
        y: domain.y + Math.sin(a) * rr,
        r: Math.max(26, domain.r * 0.3 * Math.sqrt(rawCat.subjects.length / Math.max(1, maxInCat)) + 18),
        pad: 14,
        domain,
        subjects: [],
        wedges: [],
        techniqueCount: 0,
      };
      return node;
    });
    relax(domain.categories, 180);

    domain.categories.forEach((category) => {
      // Keep every sub-disc inside the cluster that owns it.
      const dx = category.x - domain.x;
      const dy = category.y - domain.y;
      const dd = Math.hypot(dx, dy);
      const lim = domain.r - category.r - 6;
      if (dd > lim) {
        const f = lim / (dd || 1);
        category.x = domain.x + dx * f;
        category.y = domain.y + dy * f;
      }
    });

    domain.categories.forEach((category, ci) => {
      const rawSubjects = (cats[ci]?.subjects ?? []).slice().sort(byTitle);
      category.subjects = rawSubjects.map((raw2, si) => {
        const node: SubjectNode = {
          kind: 'subject',
          slug: raw2.slug,
          title: raw2.title,
          subcategory: raw2.subcategory,
          status: raw2.status,
          applications: raw2.applications,
          rank: si + 1,
          x: 0,
          y: 0,
          domain,
          category,
          wedge: { key: '', a0: 0, a1: 0, mid: 0, n: 0 },
          techniques: [],
          lawCount: 0,
          mark: 'none',
          overlay: null,
        };
        const laws = new Set<string>();
        node.techniques = raw2.techniques
          .slice()
          .sort((p, q) => p.slug.localeCompare(q.slug))
          .map((tech, ti): TechniqueNode => {
            for (const law of tech.laws) laws.add(law);
            return {
              kind: 'technique',
              slug: tech.slug,
              laws: tech.laws,
              useWhen: tech.useWhen ?? [],
              rank: ti + 1,
              x: 0,
              y: 0,
              subject: node,
            };
          });
        node.lawCount = laws.size;
        category.techniqueCount += node.techniques.length;
        domain.techniqueCount += node.techniques.length;
        subjects.push(node);
        return node;
      });
      layoutCategory(category, overlayBySlug);
    });
  });

  let boundRadius = 0;
  for (const d of domains) boundRadius = Math.max(boundRadius, Math.hypot(d.x, d.y) + d.r);

  return {
    domains,
    subjects,
    bySlug: new Map(subjects.map((s) => [s.slug, s])),
    boundRadius,
    dust: buildDust(boundRadius),
    totals: {
      domains: galaxy.totals.domains,
      subjects: galaxy.totals.subjects,
      techniques: galaxy.totals.techniques,
    },
  };
}
