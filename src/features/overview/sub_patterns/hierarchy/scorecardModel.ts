// Pure lookups over the census adherence scorecard (Patterns v2 P4). No I/O,
// no React — everything is a function of the `HierarchyScorecard` the Rust
// reader returned.
//
// The honesty contract every consumer must keep: a subject ABSENT from the
// scorecard has no census rules yet — absence is NOT cleanliness, so absent
// subjects get NO ring / NO badge, never a green one. The adherence ratio is
// `cleanContexts / applicableContexts` and BOTH come from the artifact:
// `contexts` lists only dirty contexts, so the denominator can never be
// derived from the array.
import type { HierarchyScorecard } from '@/lib/bindings/HierarchyScorecard';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';

/** slug → score, or `null` when there is no census signal at all (no fetch
 *  yet, or the artifact is absent for this repo). A present-but-empty
 *  scorecard still returns a Map — that is a real (if useless) census. */
export function subjectScoreMap(
  scorecard: HierarchyScorecard | null,
): Map<string, SubjectScore> | null {
  if (!scorecard || !scorecard.source.present) return null;
  return new Map(scorecard.subjects.map((s) => [s.slug, s]));
}

/** `cleanContexts / applicableContexts` in [0, 1]. Zero applicable contexts
 *  means the rules scanned nothing mapped — rendered as 0, not 1: no
 *  denominator is no evidence of cleanliness. */
export function adherenceRatio(score: SubjectScore): number {
  if (score.applicableContexts <= 0) return 0;
  return Math.min(1, score.cleanContexts / score.applicableContexts);
}

/** One context as the Context lens lists it: identity plus its total sites
 *  across every subject (union over the per-subject dirty-context arrays). */
export interface ContextLensEntry {
  id: string;
  name: string;
  /** Context-map group NAME string. */
  group: string;
  totalSites: number;
}

/** Every context that carries ≥1 site in ANY subject, sorted by group name
 *  then sites desc — ready for a grouped popover list. */
export function buildContextLensEntries(
  scores: ReadonlyMap<string, SubjectScore>,
): ContextLensEntry[] {
  const byId = new Map<string, ContextLensEntry>();
  for (const score of scores.values()) {
    for (const ctx of score.contexts) {
      const existing = byId.get(ctx.id);
      if (existing) existing.totalSites += ctx.sites;
      else byId.set(ctx.id, { id: ctx.id, name: ctx.name, group: ctx.group, totalSites: ctx.sites });
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || b.totalSites - a.totalSites || a.name.localeCompare(b.name),
  );
}

/** subject slug → sites inside ONE context. Subjects clean (or inapplicable)
 *  in that context are absent from the map. */
export function sitesBySubjectForContext(
  scores: ReadonlyMap<string, SubjectScore>,
  contextId: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slug, score] of scores) {
    const ctx = score.contexts.find((c) => c.id === contextId);
    if (ctx && ctx.sites > 0) out.set(slug, ctx.sites);
  }
  return out;
}
