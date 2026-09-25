// One derived view of the board, built once per board + running set.
//
// Every surface on the page reads from here rather than walking `board.features`
// itself: the band's counts, the column's grouping, the map's colouring and the
// actionable lists are all THE SAME traversal, so they cannot disagree about
// which feature claims which context.
import type { Translations } from '@/i18n/en';
import type { BoardContext } from '@/lib/bindings/BoardContext';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import type { BoardGroup } from '@/lib/bindings/BoardGroup';
import type { FeatureBoard } from '@/lib/bindings/FeatureBoard';

import {
  featureGlyphKind,
  featureMove,
  toContextRole,
  type FeatureMove,
  type FeatureRow,
} from './featureRules';

export type TFeatures = Translations['features'];

/** Three features on one context is the threshold at which a change there stops
 *  being local. Below it a shared context is normal; at it, it is a finding. */
export const LOAD_BEARING_AT = 3;

export interface ContextCell {
  context: BoardContext;
  /** Narrowed; null means the wire said something outside the closed set. */
  role: ReturnType<typeof toContextRole>;
  /** The features that claim it, resolved to board rows. */
  claimants: BoardFeature[];
  /** Whose move the FIRST claimant is on, which is what tints a core square. */
  claimMove: FeatureMove | null;
}

export interface GroupPlot {
  group: BoardGroup;
  cells: ContextCell[];
}

export interface FeaturesModel {
  rows: FeatureRow[];
  rowById: Map<string, FeatureRow>;
  plots: GroupPlot[];
  cellById: Map<string, ContextCell>;
  /** Move -> how many features are on it. Every move has an entry, zero included. */
  moveCounts: Record<FeatureMove, number>;
  /** Contexts no feature claims, and that are not tests and not platform. */
  unclaimed: ContextCell[];
  /** Groups not one core context belongs to. */
  untouched: BoardGroup[];
  /** Contexts three or more features go through. */
  loadBearing: ContextCell[];
}

const ZERO_MOVES: Record<FeatureMove, number> = {
  waiting: 0,
  trouble: 0,
  working: 0,
  settled: 0,
  never: 0,
};

/**
 * Build the whole page's model.
 *
 * @param runningSlugs feature slugs with a live council session. The overlay is
 *   never stored, so it arrives separately and wins over the derived state.
 */
export function buildFeaturesModel(board: FeatureBoard, runningSlugs: ReadonlySet<string>): FeaturesModel {
  const rows: FeatureRow[] = board.features.map((feature) => {
    const running = runningSlugs.has(feature.slug);
    const kind = featureGlyphKind(feature, running);
    return {
      feature,
      kind,
      running,
      move: featureMove(kind, feature),
      span: new Set(feature.groupIds).size,
    };
  });

  const rowById = new Map(rows.map((r) => [r.feature.id, r]));
  const featureBySlug = new Map(board.features.map((f) => [f.slug, f]));
  const moveById = new Map(rows.map((r) => [r.feature.id, r.move]));

  const moveCounts: Record<FeatureMove, number> = { ...ZERO_MOVES };
  for (const row of rows) moveCounts[row.move] += 1;

  const cellById = new Map<string, ContextCell>();
  const cellsByGroup = new Map<string, ContextCell[]>();
  const unclaimed: ContextCell[] = [];
  const loadBearing: ContextCell[] = [];

  for (const context of board.contexts) {
    const claimants = context.featureSlugs
      .map((slug) => featureBySlug.get(slug))
      .filter((f): f is BoardFeature => f != null);
    const first = claimants[0];
    const cell: ContextCell = {
      context,
      role: toContextRole(context.role),
      claimants,
      claimMove: first ? moveById.get(first.id) ?? null : null,
    };
    cellById.set(context.id, cell);
    const key = context.groupId ?? '';
    const bucket = cellsByGroup.get(key);
    if (bucket) bucket.push(cell);
    else cellsByGroup.set(key, [cell]);
    if (cell.role === 'unclaimed') unclaimed.push(cell);
    if (claimants.length >= LOAD_BEARING_AT) loadBearing.push(cell);
  }

  const plots: GroupPlot[] = board.groups.map((group) => ({
    group,
    cells: cellsByGroup.get(group.id) ?? [],
  }));

  loadBearing.sort((a, b) => b.claimants.length - a.claimants.length || a.context.name.localeCompare(b.context.name));
  unclaimed.sort((a, b) => a.context.name.localeCompare(b.context.name));

  return {
    rows,
    rowById,
    plots,
    cellById,
    moveCounts,
    unclaimed,
    untouched: board.groups.filter((g) => g.untouched),
    loadBearing,
  };
}

/** The translated name of whose move it is. A switch, so a new move is a
 *  compile error rather than an `undefined` on screen. */
export function moveLabel(move: FeatureMove, t: TFeatures): string {
  switch (move) {
    case 'waiting': return t.move_waiting;
    case 'trouble': return t.move_trouble;
    case 'working': return t.move_working;
    case 'settled': return t.move_settled;
    default: return t.move_never;
  }
}

/** The translated name of a context role, with an explicit unknown arm. */
export function roleLabel(role: ReturnType<typeof toContextRole>, t: TFeatures): string {
  switch (role) {
    case 'core': return t.role_core;
    case 'platform': return t.role_platform;
    case 'tests': return t.role_tests;
    case 'unclaimed': return t.role_unclaimed;
    default: return t.role_unknown;
  }
}

/** The translated name of a feature's kind, with an explicit unknown arm. */
export function kindLabel(kind: string, t: TFeatures): string {
  switch (kind) {
    case 'user_flow': return t.kind_user_flow;
    case 'capability': return t.kind_capability;
    case 'integration': return t.kind_integration;
    case 'ops': return t.kind_ops;
    default: return t.kind_unknown;
  }
}

/** The translated name of a scenario scope, with an explicit unknown arm. */
export function scopeLabel(scope: string, t: TFeatures): string {
  switch (scope) {
    case 'must_hold': return t.scope_must_hold;
    case 'tracked': return t.scope_tracked;
    case 'out_of_scope': return t.scope_out_of_scope;
    case 'proposed': return t.scope_proposed;
    default: return t.scope_unknown;
  }
}

/** The translated name of a proof rung, with an explicit unknown arm. */
export function proofLabel(proof: string | null, t: TFeatures): string {
  switch (proof) {
    case 'observed': return t.proof_observed;
    case 'replayed': return t.proof_replayed;
    case 'simulated': return t.proof_simulated;
    case 'claimed': return t.proof_claimed;
    default: return t.proof_unknown;
  }
}
