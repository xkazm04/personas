// What the technique document prints, from data the page already holds: the
// laws from the registry galaxy (the only cross-subject edges the corpus
// has), and the council runs' technique proofs, which the page holds only in
// fixture mode. Outside the fixture that figure is NOT MEASURED, and the
// document says so rather than printing an empty list as if it were zero.
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';

import { parsePayload } from '../../table/runModel';
import type { GalaxyLayout, TechniqueNode } from '../engine/types';

export interface DocLaw {
  slug: string;
  title: string;
  statement: string;
  techniques: TechniqueNode[];
  subjectSpan: number;
}

export interface DocProof {
  key: string;
  proof: string;
  dimension: string;
  subject: string;
  round: number;
}

function lawTitle(slug: string): string {
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Resolve `subject/technique` addresses against the laid-out field. */
export function lawsOf(t: TechniqueNode, laws: Map<string, { statement: string; techniques: string[] }>, layout: GalaxyLayout): DocLaw[] {
  return t.laws
    .map((slug) => {
      const law = laws.get(slug);
      if (!law) return null;
      const techniques = law.techniques
        .map((addr) => {
          const [subject, technique] = addr.split('/');
          return layout.bySlug.get(subject ?? '')?.techniques.find((x) => x.slug === technique) ?? null;
        })
        .filter((x): x is TechniqueNode => x !== null);
      return { slug, title: lawTitle(slug), statement: law.statement, techniques, subjectSpan: new Set(techniques.map((x) => x.subject)).size };
    })
    .filter((x): x is DocLaw => x !== null);
}

/** Siblings bound here by a shared law, and techniques bound elsewhere. */
export function bindings(t: TechniqueNode, laws: DocLaw[]): { same: number; other: number; otherSubjects: number } {
  const same = new Set<TechniqueNode>();
  const other = new Set<TechniqueNode>();
  for (const l of laws) {
    for (const x of l.techniques) {
      if (x === t) continue;
      (x.subject === t.subject ? same : other).add(x);
    }
  }
  return { same: same.size, other: other.size, otherSubjects: new Set([...other].map((x) => x.subject)).size };
}

/** Council runs that cite this technique as proof. Null when not measured. */
export function proofsOf(t: TechniqueNode, runs: Record<string, CouncilRunDetail>, fixtureOn: boolean): DocProof[] | null {
  if (!fixtureOn) return null;
  const out: DocProof[] = [];
  for (const run of Object.values(runs)) {
    for (const v of run.verdicts) {
      for (const p of parsePayload(v.payloadJson).techniques) {
        if (p.subject !== t.subject.slug || p.technique !== t.slug) continue;
        out.push({ key: `${run.run.id}:${v.dimension}`, proof: p.proof, dimension: v.dimension, subject: run.subject.title, round: run.run.roundNo });
      }
    }
  }
  return out;
}
