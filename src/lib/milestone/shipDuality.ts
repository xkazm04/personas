// The state DUALITY, as pure math.
//
// A milestone member carries TWO independent readings:
//   1. the AUTOMATION's — `feature.ready`, recomputed every render from KPI
//      coverage and context health (shipModel.featureState). Nobody types it.
//   2. the OPERATOR's — `member.rating`, a 1..5 judgement stored on the row.
//      `null` means UNRATED, which is a state of its own and never a zero.
//
// Where they agree there is nothing to look at. Where they DISAGREE is the
// whole point of the layer: either the sensors are measuring the wrong thing,
// or the operator is carrying a belief the evidence does not support. Both are
// worth a human look, and neither is worth a veto.
//
// So this file REPORTS and never gates. The ship verdict is folded exclusively
// from the exit-criteria registry (`shipVerdict` over `shipCriteria`), and
// progress is ready-core / total-core. Nothing here feeds either — wiring a
// rating into the verdict would turn a second opinion into a lock, which was
// explicitly rejected in design.
import type { ShipMember } from './shipModel';

/** How one member's two readings line up. */
export type DualityVerdict =
  /** No rating yet — the operator has not weighed in, so there is nothing to compare. */
  | 'unrated'
  /** The readings point the same way (or the rating is a neutral 3). */
  | 'agree'
  /** The readings point opposite ways. The interesting case. */
  | 'disagree';

/** A single member's readings, resolved. */
export interface DualityItem {
  id: string;
  name: string;
  /** The automation's reading. */
  ready: boolean;
  /** The operator's reading; `null` = unrated. */
  rating: number | null;
  verdict: DualityVerdict;
}

export interface DualitySummary {
  /** Core members that carry a rating. */
  rated: number;
  /** Core members with no rating at all. */
  unrated: number;
  agree: number;
  disagree: number;
  /** The disagreeing members, in cut order — what the header points at. */
  conflicts: DualityItem[];
}

/**
 * The DISAGREEMENT boundary, stated once:
 *
 * - automation READY   and rating <= 2  → disagree (the operator distrusts a green light)
 * - automation NOT ready and rating >= 4 → disagree (the operator vouches for a red one)
 * - rating === 3        → agree (the deliberate midpoint takes no side)
 * - rating === null     → unrated (not a disagreement, not an agreement)
 *
 * `ready` is the automation's single boolean: `false` covers both "blocked by a
 * critical context" and "no KPI measuring it" — every reading in which the
 * automation declines to call the member ready.
 */
export function itemVerdict(ready: boolean, rating: number | null): DualityVerdict {
  if (rating === null) return 'unrated';
  if (ready && rating <= 2) return 'disagree';
  if (!ready && rating >= 4) return 'disagree';
  return 'agree';
}

/** Fold the duality over a milestone's CORE members. */
export function deriveDuality(core: ShipMember[]): DualitySummary {
  const items: DualityItem[] = core.map((m) => ({
    id: m.feature.id,
    name: m.feature.name,
    ready: m.feature.ready,
    rating: m.rating,
    verdict: itemVerdict(m.feature.ready, m.rating),
  }));
  return {
    rated: items.filter((i) => i.verdict !== 'unrated').length,
    unrated: items.filter((i) => i.verdict === 'unrated').length,
    agree: items.filter((i) => i.verdict === 'agree').length,
    disagree: items.filter((i) => i.verdict === 'disagree').length,
    conflicts: items.filter((i) => i.verdict === 'disagree'),
  };
}
