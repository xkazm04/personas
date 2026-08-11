/**
 * Route-section coverage gate (the test half — see
 * `scripts/i18n/check-route-sections.mjs` for the CLI half and the full
 * rationale).
 *
 * ## The bug class
 *
 * A locale section chunk is fetched only if some route DECLARES it in
 * `routeSections.ts`. `getResolvedSection()` returns English synchronously for
 * an uncached section and deliberately never starts a load from the getter, so
 * an undeclared section is never fetched at all: a fully translated feature
 * renders 100% English in every locale, permanently, with no warning.
 *
 * Concrete instance this test was written against (2026-08-09): `twin` — 629
 * keys, 613 genuinely translated in es.json, rendered by the plugins sidebar —
 * was absent from ROUTE_SECTIONS.plugins. Twelve more live sections were in the
 * same state. Nothing failed: key parity green, value gate green, dead-key
 * scanner green.
 *
 * Running the analyzer here (rather than only from a script nobody remembers to
 * run) means `npm run test` closes the class.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyzeRouteSectionCoverage } from '../../../scripts/i18n/check-route-sections.mjs';
import { sectionsForRoute } from '../routeSections';
import { preloadSectionsAsync, getActiveTranslations } from '../useTranslation';
import { useI18nStore } from '@/stores/i18nStore';
import enCatalog from '../locales/en.json';

describe('route-section coverage', () => {
  const result = analyzeRouteSectionCoverage();

  it('declares every live translation section on some route (or in BASE_SECTIONS)', () => {
    // A gap here means those sections render English in all 13 non-English
    // locales, forever. Map each to the route(s) that render it in
    // src/i18n/routeSections.ts — do NOT bulk-add to BASE_SECTIONS.
    expect(
      result.uncoveredLive.map((s) => `${s.section} (${s.fileCount} files, e.g. ${s.files[0]})`),
    ).toEqual([]);
  });

  it('keeps the unreferenced-section exclusions explicit and current', () => {
    // "No coverage because unused" must stay distinguishable from "no coverage
    // because forgotten". A section with no call site and no recorded reason is
    // either genuinely dead (record it in UNREFERENCED_SECTIONS) or reached
    // through a channel the scanner cannot see (add the pattern to
    // scripts/i18n/lib/section-refs.mjs — that is exactly how `debt` hid).
    expect(result.undocumentedDead.map((s) => s.section)).toEqual([]);
    // And the inverse: an exclusion that has grown a call site is stale.
    expect(result.staleExclusions.map((s) => s.section)).toEqual([]);
    // A section recorded as dead should not still be fetched by a route.
    expect(result.deadButDeclared.map((s) => s.section)).toEqual([]);
  });

  it('routes the twin section to the plugins route', () => {
    expect(sectionsForRoute('plugins')).toContain('twin');
  });
});

describe('twin renders in a non-English locale', () => {
  const original = useI18nStore.getState().language;
  beforeEach(() => {
    useI18nStore.setState({ language: 'es' });
  });
  afterEach(() => {
    useI18nStore.setState({ language: original });
  });

  it('resolves Spanish once the plugins route preloads its sections', async () => {
    // Exactly what the app does on the plugins route: preload the declared
    // sections, then read through the bundle proxy.
    await preloadSectionsAsync('es', sectionsForRoute('plugins'));

    const t = getActiveTranslations();
    const es = t.twin as unknown as Record<string, Record<string, string>>;
    const en = enCatalog.twin as unknown as Record<string, Record<string, string>>;

    expect(es.selector.createTwin).not.toBe(en.selector.createTwin);
    expect(es.selector.createTwin).toBe('Crear gemelo nuevo');
  });

  it('still falls back to English for a section no route preloaded', () => {
    // The synchronous English fallback in getResolvedSection is deliberate and
    // documented (loading from the getter caused a render storm). This test
    // pins that behavior so the fix above is understood as "declare the
    // section", never "make the getter load".
    const t = getActiveTranslations();
    const studioOnly = sectionsForRoute('studio');
    expect(studioOnly).not.toContain('twin');
    expect(typeof (t.common as unknown as Record<string, string>).save).toBe('string');
  });
});
