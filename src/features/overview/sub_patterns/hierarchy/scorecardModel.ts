// Pure lookups over the census adherence scorecard (Patterns v2 P4). No I/O,
// no React — everything is a function of the `HierarchyScorecard` the Rust
// reader returned.
//
// The honesty contract every consumer must keep: a subject ABSENT from the
// scorecard has no census rules yet — absence is NOT cleanliness, so absent
// subjects get NO ring / NO badge, never a green one.
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
