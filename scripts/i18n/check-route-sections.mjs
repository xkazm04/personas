#!/usr/bin/env node
/**
 * Route-section coverage gate.
 *
 * ## The bug class this closes
 *
 * Non-English translations ship as one lazy chunk per top-level section. A
 * chunk is fetched only when a route DECLARES the section in
 * `src/i18n/routeSections.ts`. `getResolvedSection()` returns English
 * synchronously for an uncached section and deliberately does not start a load
 * from the getter, so a section that no route declares is never fetched at all:
 * a fully translated feature renders 100% English, in every locale, forever,
 * with zero signal.
 *
 * Nothing else catches it. Key parity is green (the keys exist in every
 * locale), the value gate is green (the values ARE translated), the dead-key
 * scanner is green (the keys ARE referenced from source). The dev warning in
 * routeSections.ts only fires for a completely unmapped SidebarSection, which
 * is a different failure.
 *
 * Found in the wild 2026-08-09: `twin` (629 keys, 613 genuinely translated in
 * es.json, rendered by the plugins sidebar) was absent from
 * ROUTE_SECTIONS.plugins. 12 more live sections were in the same state.
 *
 * ## What this asserts
 *
 * For every top-level section in `src/i18n/locales/en.json`, exactly one of:
 *
 *   a) it is REFERENCED from source AND covered by BASE_SECTIONS or at least
 *      one ROUTE_SECTIONS entry;                                    → ok
 *   b) it is NOT referenced from source AND listed in
 *      UNREFERENCED_SECTIONS below with a dated reason.             → ok
 *
 * Anything else fails. That includes the inverse cases, which matter just as
 * much: a section listed as unreferenced that the scanner now finds live (the
 * exclusion went stale), and a section neither referenced nor documented
 * (either it is dead and should be recorded, or the scanner is missing a
 * channel — see lib/section-refs.mjs).
 *
 * Usage:
 *   node scripts/i18n/check-route-sections.mjs           # gate (exit 1 on gap)
 *   node scripts/i18n/check-route-sections.mjs --json    # machine readable
 *   node scripts/i18n/check-route-sections.mjs --warn    # report, always exit 0
 *
 * Also enforced from `src/i18n/__tests__/routeSectionCoverage.test.ts` so
 * `npm run test` catches it without a separate npm script.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSectionReferences, parseRouteSections } from './lib/section-refs.mjs';

/**
 * Sections with NO call site anywhere in `src/`, recorded deliberately so that
 * "no route coverage because it is unused" stays distinguishable from "no route
 * coverage because somebody forgot".
 *
 * Adding an entry is a claim that the section is dead. Verify with:
 *   node scripts/i18n/check-route-sections.mjs --json
 * and grep the section name across src/ before you believe it. If a section
 * here later grows a call site, this gate fails and the entry must be removed
 * (and the section given route coverage) — that is the point.
 *
 * Candidates for retirement, not just exclusion: every entry here is dead
 * weight in all 14 locales.
 */
const UNREFERENCED_SECTIONS = {
  deliberation:
    '2026-08-09 — 51 keys, zero call sites. Team-deliberation UI was rebuilt as ' +
    'features/fleet/monitor/channels/* and features/teams/sub_deliberations/*, which ' +
    'carry their own strings; this catalog was never repointed. Retire candidate.',
  planner:
    '2026-08-09 — 67 keys, zero call sites. A standalone Planner page (nav_label, ' +
    'page_title, steps_heading, …) that no longer exists; the surviving planner UI is ' +
    'teams/sub_factory/l2/ship/ShipPlannerTab.tsx, which reads t.ship.*. Retire candidate.',
};

const ROOT = resolve(process.cwd());
const EN_JSON = resolve(ROOT, 'src/i18n/locales/en.json');
const ROUTE_SECTIONS_TS = resolve(ROOT, 'src/i18n/routeSections.ts');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const warnOnly = argv.includes('--warn');

/**
 * Run the analysis. Exported so the vitest gate shares exactly this logic
 * rather than a drifting copy.
 */
export function analyzeRouteSectionCoverage(root = ROOT) {
  const en = JSON.parse(readFileSync(resolve(root, 'src/i18n/locales/en.json'), 'utf8'));
  const sections = Object.keys(en);
  const { base, routes, covered } = parseRouteSections(
    readFileSync(resolve(root, 'src/i18n/routeSections.ts'), 'utf8'),
  );
  const refs = scanSectionReferences({
    root,
    srcDir: resolve(root, 'src'),
    sections,
  });

  /** Live section with no route/base declaration — renders English forever. */
  const uncoveredLive = [];
  /** Neither referenced nor documented as dead. */
  const undocumentedDead = [];
  /** Documented as dead but the scanner found call sites. */
  const staleExclusions = [];
  /** Documented dead AND still declared by a route — pointless chunk fetch. */
  const deadButDeclared = [];

  for (const section of sections) {
    const files = refs.get(section) ?? [];
    const isLive = files.length > 0;
    const isCovered = covered.has(section);
    const excuse = UNREFERENCED_SECTIONS[section];

    if (isLive && excuse) {
      staleExclusions.push({ section, files: files.slice(0, 5), fileCount: files.length });
    }
    if (isLive && !isCovered) {
      uncoveredLive.push({ section, files: files.slice(0, 5), fileCount: files.length });
    }
    if (!isLive && !excuse) {
      undocumentedDead.push({ section });
    }
    if (!isLive && excuse && isCovered) {
      deadButDeclared.push({ section });
    }
  }

  return {
    sectionCount: sections.length,
    coveredCount: covered.size,
    base,
    routes,
    liveSections: [...refs.keys()],
    uncoveredLive,
    undocumentedDead,
    staleExclusions,
    deadButDeclared,
    excluded: Object.keys(UNREFERENCED_SECTIONS),
    ok:
      uncoveredLive.length === 0 &&
      undocumentedDead.length === 0 &&
      staleExclusions.length === 0 &&
      deadButDeclared.length === 0,
  };
}

/** Best-effort route suggestion from the referencing file paths. */
export function suggestRoutes(files) {
  const out = new Set();
  for (const f of files) {
    if (/^src\/features\/(home|simple-mode)\//.test(f)) out.add('home');
    else if (/^src\/features\/overview\//.test(f)) out.add('overview');
    else if (/^src\/features\/teams\//.test(f)) out.add('teams');
    else if (/^src\/features\/(agents|personas)\//.test(f)) out.add('personas');
    else if (/^src\/features\/(triggers|recipes)\//.test(f)) out.add('events');
    else if (/^src\/features\/vault\//.test(f)) out.add('credentials');
    else if (/^src\/features\/templates\//.test(f)) out.add('design-reviews');
    else if (/^src\/features\/plugins\//.test(f)) out.add('plugins');
    else if (/^src\/features\/settings\//.test(f)) out.add('settings');
    else out.add('(app-wide → BASE_SECTIONS)');
  }
  return [...out];
}

const isMain =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  const result = analyzeRouteSectionCoverage();

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok || warnOnly ? 0 : 1);
  }

  console.log(
    `i18n route-section coverage — ${result.sectionCount} sections, ` +
      `${result.liveSections.length} referenced, ${result.coveredCount} declared by a route/base\n`,
  );

  if (result.uncoveredLive.length) {
    console.log(`FAIL: ${result.uncoveredLive.length} LIVE section(s) no route declares.`);
    console.log('      Their locale chunks are never fetched — these render English in every locale.\n');
    for (const { section, files, fileCount } of result.uncoveredLive) {
      console.log(`  ${section}  (${fileCount} referencing file${fileCount === 1 ? '' : 's'})`);
      console.log(`      suggest: ${suggestRoutes(files).join(', ')}`);
      for (const f of files) console.log(`      - ${f}`);
    }
    console.log('\n  Fix: add each section to the ROUTE_SECTIONS entry (or entries) that render it');
    console.log('  in src/i18n/routeSections.ts. Use BASE_SECTIONS only for genuinely app-wide chrome.\n');
  }

  if (result.staleExclusions.length) {
    console.log(`FAIL: ${result.staleExclusions.length} section(s) listed in UNREFERENCED_SECTIONS are live again:`);
    for (const { section, files } of result.staleExclusions) {
      console.log(`  ${section} — e.g. ${files[0]}`);
    }
    console.log('  Fix: remove the entry from UNREFERENCED_SECTIONS and give the section route coverage.\n');
  }

  if (result.undocumentedDead.length) {
    console.log(`FAIL: ${result.undocumentedDead.length} section(s) with no call site and no recorded reason:`);
    for (const { section } of result.undocumentedDead) console.log(`  ${section}`);
    console.log('  Fix: either it is genuinely dead — add it to UNREFERENCED_SECTIONS in this file');
    console.log('  with a dated reason — or the scanner cannot see its channel, in which case add');
    console.log('  the pattern to scripts/i18n/lib/section-refs.mjs (this is how `debt` hid).\n');
  }

  if (result.deadButDeclared.length) {
    console.log(`FAIL: ${result.deadButDeclared.length} section(s) recorded as dead but still declared by a route:`);
    for (const { section } of result.deadButDeclared) console.log(`  ${section}`);
    console.log('  Fix: drop them from routeSections.ts — the chunk is fetched and never read.\n');
  }

  if (result.ok) {
    console.log('OK — every referenced section is declared by a route or by BASE_SECTIONS.');
    if (result.excluded.length) {
      console.log(`\nExplicitly excluded (no call site, recorded as dead):`);
      for (const s of result.excluded) console.log(`  ${s}`);
    }
  }

  process.exit(result.ok || warnOnly ? 0 : 1);
}
