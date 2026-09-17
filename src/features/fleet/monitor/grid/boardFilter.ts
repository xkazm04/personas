// boardFilter — what the Activity board is allowed to hide.
//
// The retired Project-columns view painted ONLY actionable personas: it was a
// queue, and an idle persona had no row in it. Its successor paints the whole
// roster, so the one predicate that made it a queue — `actionWeight > 0` — has
// been computed on every card and used by nothing since the columns view was
// deleted.
//
// This module is that predicate and nothing else. It lives beside
// `fleetGridModel` rather than inside it because the model answers "what state
// is this card in" (which every Monitor surface shares) while this answers
// "should the board show it right now" (which only the board decides).
//
// COUNT CARRIES PREDICATE. The header's tally stays a read on the FULL roster —
// it is the key to the fleet, not to the viewport — so a pill that says
// `attention 6` is a promise that filtering to attention yields exactly six
// tiles. Anything that narrows the board must narrow it through here, so the
// promise has one implementation.

import type { PersonaCardModel } from '../monitorModel';
import { actionWeight } from './fleetGridModel';

export interface BoardFilter {
  /** Hide every card with nothing pending on the operator (`actionWeight === 0`). */
  actionableOnly: boolean;
}

/** The board's default: show everything. */
export const NO_BOARD_FILTER: BoardFilter = { actionableOnly: false };

/** True when the filter would hide anything at all. */
export function isBoardFilterActive(filter: BoardFilter): boolean {
  return filter.actionableOnly;
}

/** Does one card survive the filter? */
export function cardPasses(card: PersonaCardModel, filter: BoardFilter): boolean {
  if (filter.actionableOnly && actionWeight(card) === 0) return false;
  return true;
}

/**
 * Narrow a roster. Returns the same array reference when nothing is filtered,
 * so an inactive filter costs the board no re-grouping.
 */
export function filterCards(
  cards: PersonaCardModel[],
  filter: BoardFilter,
): PersonaCardModel[] {
  if (!isBoardFilterActive(filter)) return cards;
  return cards.filter((c) => cardPasses(c, filter));
}
