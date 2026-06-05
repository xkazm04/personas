/**
 * Pure session-summary builder.
 *
 * Takes the raw per-key visit counts accumulated during a session and diffs
 * them against the full navigation catalog to produce the visited/ignored
 * breakdown. Kept side-effect-free so it is directly unit-testable
 * (`summary.test.ts`) without a DOM or Sentry.
 */
import { SECTIONS, TAB_DIMENSIONS } from './navCatalog';
import type { SessionSummary } from './sink';

/** Count-map key for a section visit (bare section name). */
export function sectionCountKey(section: string): string {
  return section;
}

/**
 * Count-map key for a tab visit. Dimension-keyed (`<dimKey>:<value>`) so two
 * dimensions in the same section that share a value never merge counts.
 */
export function tabCountKey(dimKey: string, value: string): string {
  return `${dimKey}:${value}`;
}

function visited(counts: Record<string, number>, key: string): boolean {
  return (counts[key] ?? 0) > 0;
}

/** Diff the accumulated counts against the full catalog. */
export function buildSessionSummary(counts: Record<string, number>): SessionSummary {
  const sectionsVisited: string[] = [];
  const sectionsIgnored: string[] = [];
  for (const section of SECTIONS) {
    (visited(counts, sectionCountKey(section)) ? sectionsVisited : sectionsIgnored).push(section);
  }

  const tabsVisited: string[] = [];
  const tabsIgnored: string[] = [];
  for (const dim of TAB_DIMENSIONS) {
    for (const value of dim.values) {
      const key = tabCountKey(dim.key, value);
      (visited(counts, key) ? tabsVisited : tabsIgnored).push(key);
    }
  }

  const totalVisits = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return {
    counts,
    totalVisits,
    sectionsVisited,
    sectionsIgnored,
    sectionsTotal: SECTIONS.length,
    tabsVisited,
    tabsIgnored,
    tabsTotal: tabsVisited.length + tabsIgnored.length,
  };
}
