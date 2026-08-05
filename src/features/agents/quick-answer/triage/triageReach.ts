/**
 * triageReach.ts — how far adopting a practice actually reaches.
 *
 * Adopting a workspace practice is not a note-to-self: `decide_knowledge`
 * (src-tauri/db/src/repos/dev_workspaces.rs) fans the practice out to EVERY
 * member project of the workspace as an adoption cell — `proposed` where the
 * practice can apply to that repo's stack, `na` where it cannot. A reviewer
 * adopting from a deck therefore commits N repos to something, and until now
 * the card never said what N was.
 *
 * This module is the frontend's honest copy of that arithmetic. Two rules kept
 * it from becoming a second, subtly different truth:
 *
 *  1. **The filter set is `languages` + `frameworks` only.** `layers` and
 *     `conditions` are display metadata — the backend never gates on them, so
 *     neither does this. (`libraryModel.viewFromRow` parses `layers` and
 *     `frameworks` and drops `languages` entirely, which is why the raw
 *     `applicability` string is the input here rather than the view model.)
 *  2. **No filters means it applies everywhere**, and so does unparseable JSON.
 *     Mirrors `applicability_matches`: a missing filter is not a deny.
 *
 * React-free and store-free on purpose.
 */

/** Parsed shape of `WorkspaceKnowledge.applicability` (stored as JSON text). */
export interface ParsedApplicability {
  layers: string[];
  languages: string[];
  frameworks: string[];
  conditions: string[];
}

const EMPTY: ParsedApplicability = { layers: [], languages: [], frameworks: [], conditions: [] };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Parse the stored JSON. Never throws — a bad blob reads as "no constraints". */
export function parseApplicability(raw: string | null | undefined): ParsedApplicability {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    return {
      layers: strings(parsed.layers),
      languages: strings(parsed.languages),
      frameworks: strings(parsed.frameworks),
      conditions: strings(parsed.conditions),
    };
  } catch {
    // Deliberately silent: an unparseable blob is treated as unconstrained,
    // exactly as the backend treats it, and the reviewer sees "any stack".
    return EMPTY;
  }
}

/**
 * The gating terms, lowercased and trimmed — the ONLY part of a parse that the
 * match actually reads.
 *
 * Split out so a caller with N projects can pay for the `JSON.parse` once
 * rather than once per project (see {@link adoptReach}).
 */
function filtersOf(parsed: ParsedApplicability): string[] {
  return [...parsed.languages, ...parsed.frameworks]
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
}

/** No filters means it applies everywhere — mirrors `applicability_matches`. */
function matchesFilters(filters: readonly string[], techStack: string | null | undefined): boolean {
  if (filters.length === 0) return true;
  const stack = (techStack ?? '').toLowerCase();
  return filters.some((f) => stack.includes(f));
}

/**
 * Whether a practice can apply to a project with this tech stack.
 *
 * Substring matching on a lowercased stack string, because `dev_projects.tech_stack`
 * is free text ("React + TypeScript + Tauri") rather than a normalised list.
 * Same compromise the backend makes; keep the two in step.
 */
export function applicabilityMatches(
  raw: string | null | undefined,
  techStack: string | null | undefined,
): boolean {
  return matchesFilters(filtersOf(parseApplicability(raw)), techStack);
}

/** What an adopt would touch: how many member repos, and how many of them qualify. */
export interface AdoptReach {
  /** Member projects in the workspace. */
  members: number;
  /** Of those, how many the practice can apply to (the real blast radius). */
  applicable: number;
}

/**
 * ONE parse per practice, not one per member project.
 *
 * This used to call `applicabilityMatches` — and therefore `JSON.parse` — inside
 * a `.filter` over the workspace's member stacks, so a rebuild cost
 * P practices × M members parses of the same handful of blobs. The deck rebuilds
 * its whole queue on a 30-second poll, so that was a recurring cost paid for
 * data that had not changed.
 */
export function adoptReach(
  raw: string | null | undefined,
  memberTechStacks: readonly (string | null | undefined)[],
): AdoptReach {
  const filters = filtersOf(parseApplicability(raw));
  let applicable = 0;
  for (const stack of memberTechStacks) {
    if (matchesFilters(filters, stack)) applicable += 1;
  }
  return { members: memberTechStacks.length, applicable };
}
