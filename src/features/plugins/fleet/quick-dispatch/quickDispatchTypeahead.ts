import { fuzzyScore } from '@/features/shared/chrome/commandPaletteUtils';
import type { DevProject } from '@/api/devTools/devTools';

/**
 * Pure typeahead logic for the Quick Dispatch composer — extracted from the
 * overlay so the token grammar and ranking are unit-testable without React.
 *
 * Grammar (mirrors the Composer/SlashPalette idiom, but chip-collapsing like
 * SearchChipInput): the LAST whitespace-delimited token of the draft opens a
 * typeahead when it starts with `@` (project) or `/` (skill). Mid-token
 * symbols (`user@host`, `src/foo`) deliberately do NOT trigger — the sigil
 * must begin the token.
 */

export const QUICK_DISPATCH_MAX_SUGGESTIONS = 8;

export interface ActiveToken {
  kind: 'project' | 'skill';
  /** Text after the sigil — the filter query. */
  query: string;
  /** Index of the sigil character in the draft (for stripping). */
  start: number;
}

const TOKEN_RE = /(^|\s)([@/])(\S*)$/;

/** The typeahead token at the end of the draft, or null when none is active. */
export function activeTypeaheadToken(value: string): ActiveToken | null {
  const m = TOKEN_RE.exec(value);
  if (!m) return null;
  return {
    kind: m[2] === '@' ? 'project' : 'skill',
    query: m[3] ?? '',
    start: m.index + (m[1]?.length ?? 0),
  };
}

/** The draft with the active typeahead token (and its trailing space) removed. */
export function stripActiveToken(value: string): string {
  const tok = activeTypeaheadToken(value);
  return tok ? value.slice(0, tok.start).replace(/\s+$/, '') : value;
}

/**
 * Rank projects for the `@` typeahead: fuzzyScore over the name, with the
 * root path as a discounted secondary signal (matching `scoreItem` in the
 * command palette). Empty query lists everything in registry order.
 */
export function filterQuickDispatchProjects(
  projects: readonly DevProject[],
  query: string,
  max: number = QUICK_DISPATCH_MAX_SUGGESTIONS,
): DevProject[] {
  const q = query.trim();
  if (!q) return projects.slice(0, max);
  return projects
    .map((p) => ({
      p,
      score: Math.max(fuzzyScore(q, p.name), fuzzyScore(q, p.root_path) * 0.7),
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((e) => e.p);
}

/**
 * Rank skills for the `/` typeahead: fuzzyScore over the skill name, with the
 * description as a discounted secondary signal.
 *
 * Generic over the skill shape rather than bound to `SkillEntry`, because the
 * ranking only ever reads `name` and `description`. The second consumer is
 * Curator's request composer, whose skills come off her own door as
 * `CuratorSkill`; widening this signature is what stops that surface growing a
 * SECOND ranker that drifts from this one. `SkillEntry` callers keep their
 * exact return type through the type parameter.
 */
export function filterQuickDispatchSkills<
  T extends { name: string; description?: string | null },
>(
  skills: readonly T[],
  query: string,
  max: number = QUICK_DISPATCH_MAX_SUGGESTIONS,
): T[] {
  const q = query.trim();
  if (!q) return skills.slice(0, max);
  return skills
    .map((s) => ({
      s,
      score: Math.max(
        fuzzyScore(q, s.name),
        s.description ? fuzzyScore(q, s.description) * 0.7 : 0,
      ),
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((e) => e.s);
}

/**
 * The dispatch door's `operationIntent` — the first non-empty line of the
 * requirement, clamped to the server's 300-char intent bound.
 */
export function dispatchIntentOf(requirement: string, max = 300): string {
  const line =
    requirement
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return line.length <= max ? line : line.slice(0, max);
}
