// The rules the Features page shares. A rule lives here exactly once, so the
// header band, the column grouping, the map colouring and the feature tab's
// one action can never disagree about the same feature.
//
// Nothing here recomputes what the board already decided: `envelope` arrives
// folded by `aggregate_scenarios` on the Rust side (S1-S10) and is READ here,
// never re-derived. The only place those rules are mirrored in TypeScript is
// the DEV fixture mapper, which has no Rust behind it.
import { CONTEXT_ROLES, SCENARIO_DEFAULT_FLOOR, type ContextRole } from '@/api/devTools/features';
import {
  councilCta,
  toCouncilState,
  type CouncilCtaKind,
  type CouncilGlyphKind,
} from '@/features/plugins/dev-tools/sub_context/councilGlyph';
import { decidable } from '@/features/teams/sub_council/councilRules';
import { FEATURE_V1 } from '@/features/teams/sub_council/table/rubrics';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';

/** The bar a council overall is read against, and the coverage below which
 *  there is no overall at all. Taken from the pinned rubric, never a literal. */
export const FEATURE_THRESHOLD = FEATURE_V1.threshold;
export const FEATURE_COVERAGE_FLOOR = FEATURE_V1.coverageFloor;

// ---------------------------------------------------------------------------
// Whose move it is
// ---------------------------------------------------------------------------

/**
 * The five bands the column groups under, in the order a person works them.
 *
 * `never` is the majority and permanently so: it is the absence of a council,
 * not a bad one, and it is drawn hatched rather than empty everywhere.
 */
export type FeatureMove = 'waiting' | 'trouble' | 'working' | 'settled' | 'never';

export const FEATURE_MOVES: readonly FeatureMove[] = [
  'waiting',
  'trouble',
  'working',
  'settled',
  'never',
] as const;

/** The glyph kind for one board row: a live session wins over whatever the
 *  store derived, exactly as the ledger's row does. */
export function featureGlyphKind(feature: BoardFeature, running: boolean): CouncilGlyphKind | null {
  if (running) return 'running';
  if (!feature.council) return 'none';
  return toCouncilState(feature.council.state);
}

/**
 * Is this feature at the human gate? Delegates to the Council page's `decidable`
 * so there is ONE answer in the app; the tier is read off the BOARD row, which
 * is the record the tier toggle writes.
 */
export function featureDecidable(feature: BoardFeature): boolean {
  if (!feature.council) return false;
  return decidable({ state: feature.council.state, tier: feature.tier, kind: 'use_case' });
}

/**
 * Whose move it is. Total over the glyph vocabulary, with an explicit unknown
 * arm: a state this build has never heard of joins the never-councilled band,
 * because "nobody here has a verdict" is the only honest thing to say about it
 * - it is emphatically not a claim that the feature is settled or in trouble.
 */
export function featureMove(kind: CouncilGlyphKind | null, feature: BoardFeature): FeatureMove {
  switch (kind) {
    case 'ready':
      return featureDecidable(feature) ? 'waiting' : 'working';
    case 'fail':
    case 'stalled':
    case 'rejected':
    case 'approved_drifted':
      return 'trouble';
    case 'running':
    case 'incomplete':
      return 'working';
    case 'machine_pass':
    case 'approved':
      return 'settled';
    case 'none':
      return 'never';
    default:
      return 'never';
  }
}

// ---------------------------------------------------------------------------
// The one action
// ---------------------------------------------------------------------------

/**
 * The ledger's CTA table plus the one move this page owns: a `ready` subject
 * that is ALSO major leaves for the Council page's gate. The decision itself is
 * never made here, so the action navigates and nothing else.
 */
export type FeatureCtaKind = CouncilCtaKind | 'open_decision';

/**
 * `councilCta` is the table; this function is the one refinement the Features
 * page adds and it does not fork it. `awaiting` splits: major reaches the gate,
 * standard reaches nobody - so a ready-but-standard row offers NO action at all
 * rather than a button that would land on a gate it cannot pass.
 */
export function featureCta(kind: CouncilGlyphKind | null, feature: BoardFeature): FeatureCtaKind {
  const base = councilCta(kind);
  if (base !== 'awaiting') return base;
  return featureDecidable(feature) ? 'open_decision' : 'none';
}

// ---------------------------------------------------------------------------
// Context roles and what colours a square
// ---------------------------------------------------------------------------

/** Narrow the wire's `role: string` into the closed set. Anything else is
 *  `null` and the caller renders the explicit unknown arm. */
export function toContextRole(raw: string | null | undefined): ContextRole | null {
  if (raw == null) return null;
  return (CONTEXT_ROLES as readonly string[]).includes(raw) ? (raw as ContextRole) : null;
}

/**
 * What a map square is coloured by. A `core` square takes the temperature of
 * whoever claims it; everything else is its own role. `unknown` is a real arm,
 * not a fallback into the first member of the vocabulary.
 */
export type SquareTone =
  | 'gate'
  | 'trouble'
  | 'running'
  | 'settled'
  | 'claimed'
  | 'platform'
  | 'tests'
  | 'unclaimed'
  | 'unknown';

/**
 * Total over `ContextRole` x `FeatureMove | null`, with an explicit unknown arm
 * for a role outside the closed set. A `core` context whose claiming feature
 * cannot be resolved reads `claimed` - it IS claimed, we just have no council
 * temperature for it.
 */
export function squareTone(role: ContextRole | null, claimMove: FeatureMove | null): SquareTone {
  switch (role) {
    case 'core':
      switch (claimMove) {
        case 'waiting': return 'gate';
        case 'trouble': return 'trouble';
        case 'working': return 'running';
        case 'settled': return 'settled';
        case 'never': return 'claimed';
        default: return 'claimed';
      }
    case 'platform':
      return 'platform';
    case 'tests':
      return 'tests';
    case 'unclaimed':
      return 'unclaimed';
    default:
      return 'unknown';
  }
}

/** The fill each tone paints with. Semantic tokens only; `unclaimed` and
 *  `unknown` are hollow, which is what makes empty ground legible as ground. */
export const SQUARE_FILL: Record<SquareTone, string> = {
  gate: 'var(--status-pending)',
  trouble: 'var(--status-error)',
  running: 'var(--primary)',
  settled: 'var(--status-success)',
  claimed: 'color-mix(in srgb, var(--foreground) 42%, transparent)',
  platform: 'var(--status-info)',
  tests: 'color-mix(in srgb, var(--foreground) 22%, transparent)',
  unclaimed: 'transparent',
  unknown: 'transparent',
};

// ---------------------------------------------------------------------------
// The envelope - READ, never recomputed
// ---------------------------------------------------------------------------

/** The two scopes that move a number. `proposed` and `out_of_scope` never do. */
export const IN_SCOPE_SCOPES: readonly string[] = ['must_hold', 'tracked'];

/** The bucket floor: a `must_hold` branch is governed by its own floor, a
 *  `tracked` branch is watched against a flat default. S8 of the fold. */
export function bucketFloor(scenario: Pick<BoardScenario, 'scope' | 'floor'>): number {
  return scenario.scope === 'must_hold' ? scenario.floor : SCENARIO_DEFAULT_FLOOR;
}

/**
 * The worst IN-SCOPE measured scenario, by score. Null when nothing in scope
 * was measured - which is not a zero and is not "everything holds".
 */
export function worstInScope(scenarios: BoardScenario[]): BoardScenario | null {
  let worst: BoardScenario | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const s of scenarios) {
    if (!IN_SCOPE_SCOPES.includes(s.scope)) continue;
    const score = s.latest?.state === 'measured' ? s.latest.score : null;
    if (score == null) continue;
    if (score < worstScore) {
      worstScore = score;
      worst = s;
    }
  }
  return worst;
}

/** Does any in-scope row carry an advisory floor hit? Said ONCE for the panel
 *  rather than repeated on every cell. */
export function hasAdvisory(scenarios: BoardScenario[]): boolean {
  return scenarios.some((s) => s.latest?.advisory === true);
}

// ---------------------------------------------------------------------------
// Sorting the column
// ---------------------------------------------------------------------------

export type FeatureSort = 'move' | 'name' | 'score' | 'span';
export const FEATURE_SORTS: readonly FeatureSort[] = ['move', 'name', 'score', 'span'] as const;

/** One column row, with everything the sort and the grouping need already
 *  resolved - so neither is recomputed per comparison. */
export interface FeatureRow {
  feature: BoardFeature;
  kind: CouncilGlyphKind | null;
  move: FeatureMove;
  running: boolean;
  /** Distinct groups the slice crosses. */
  span: number;
}

const MOVE_RANK: Record<FeatureMove, number> = {
  waiting: 0,
  trouble: 1,
  working: 2,
  settled: 3,
  never: 4,
};

/**
 * Sort rows for the column. `move` is the default and is the page's argument:
 * the band you can act on is at the top. Every other sort is stable-broken by
 * name, so two equal rows never swap between renders.
 *
 * A null overall sorts LAST under `score` rather than as a zero.
 */
export function sortRows(rows: FeatureRow[], sort: FeatureSort): FeatureRow[] {
  const byName = (a: FeatureRow, b: FeatureRow) => a.feature.name.localeCompare(b.feature.name);
  const copy = [...rows];
  switch (sort) {
    case 'name':
      return copy.sort(byName);
    case 'score':
      return copy.sort((a, b) => {
        const av = a.feature.council?.overall;
        const bv = b.feature.council?.overall;
        if (av == null && bv == null) return byName(a, b);
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av || byName(a, b);
      });
    case 'span':
      return copy.sort((a, b) => b.span - a.span || byName(a, b));
    default:
      return copy.sort((a, b) => MOVE_RANK[a.move] - MOVE_RANK[b.move] || byName(a, b));
  }
}
