/**
 * Name search over the canvas islands.
 *
 * Spatial arrows move a roving cursor one island at a time, which is fine for
 * "what is next to this" and useless for "where is project X" on a 50-island
 * map. Canvas accessibility treats a search/jump as the PRIMARY navigation on a
 * large graph, for everyone, not a keyboard-only affordance.
 *
 * Pure so the ranking is testable without a canvas: the palette renders what
 * this returns and the shell pans to what the user picks.
 */

/** The only fields the matcher reads; keeps the fixture shape honest. */
export interface SearchableIsland {
  slug: string;
  name: string;
}

/** How many results the palette shows at once. */
export const JUMP_RESULT_LIMIT = 8;

function fold(s: string): string {
  // Case- and accent-insensitive: someone typing "reves" should find "Révès".
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Islands whose name contains `query`, best match first.
 *
 * Ranking, in order: a prefix match beats a mid-word match; a word-start match
 * beats a mid-word one; then the shorter name (a query is more likely to mean
 * "Ship" than "Shipping pipeline rewrite"); then alphabetical, so the list is
 * stable across renders and the first Enter is predictable.
 *
 * An empty query returns the first `limit` islands alphabetically rather than
 * nothing - opening the palette should show where you can go.
 */
export function matchIslands<T extends SearchableIsland>(
  islands: readonly T[],
  query: string,
  limit: number = JUMP_RESULT_LIMIT,
): T[] {
  const byName = [...islands].sort((a, b) => a.name.localeCompare(b.name));
  const q = fold(query.trim());
  if (!q) return byName.slice(0, limit);

  const scored: { island: T; rank: number }[] = [];
  for (const island of byName) {
    const name = fold(island.name);
    const at = name.indexOf(q);
    if (at < 0) continue;
    const wordStart = at === 0 || /[\s\-_/]/.test(name[at - 1] ?? '');
    scored.push({ island, rank: at === 0 ? 0 : wordStart ? 1 : 2 });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.island.name.length !== b.island.name.length) {
      return a.island.name.length - b.island.name.length;
    }
    return a.island.name.localeCompare(b.island.name);
  });

  return scored.slice(0, limit).map((s) => s.island);
}
