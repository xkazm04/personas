// How fresh the practice's measurement is, from `snapshot.tip`: the header's
// freshness segment. Pure, so the header and the unit test read one rule.
//
// - no tip (no base branch resolves, not a repo): say nothing;
// - never measured: say so;
// - measured on the tip itself, or 0 commits behind: up to date;
// - N commits behind: say how far, in the warning tone;
// - measured, distance unknown: when and on what, and no claim either way.
import type { LifecycleTipView } from '@/lib/bindings/LifecycleTipView';

export type Freshness =
  | { kind: 'never' }
  | { kind: 'current'; at: string; sha: string; branch: string }
  | { kind: 'behind'; at: string; count: number; branch: string }
  | { kind: 'measured'; at: string; sha: string };

/** A sha as the header shows it. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function freshnessOf(tip: LifecycleTipView | null): Freshness | null {
  if (!tip) return null;
  if (!tip.measuredSha || !tip.measuredAt) return { kind: 'never' };
  const at = tip.measuredAt;
  if (tip.commitsBehind != null && tip.commitsBehind > 0) {
    return { kind: 'behind', at, count: tip.commitsBehind, branch: tip.branch };
  }
  if (tip.commitsBehind === 0 || tip.measuredSha === tip.sha) {
    return { kind: 'current', at, sha: shortSha(tip.measuredSha), branch: tip.branch };
  }
  return { kind: 'measured', at, sha: shortSha(tip.measuredSha) };
}
