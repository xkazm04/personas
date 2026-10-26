/**
 * The `debt` string channel (src/i18n/DebtText.tsx).
 *
 * `debt` is a SECOND channel parallel to `t`: 539 auto-extracted keys read by
 * key through `debtText()` / `<DebtText k=… />` from ~113 files. Because it
 * bypasses `t.<section>.<key>`, it was invisible to the tooling twice over —
 * the dead-key scanner had no pattern for it (so all 539 keys read as dead, and
 * both value-level gates skip scanner-dead keys, so the section sat 0%
 * translated behind a green board) and no route declared the section (so the
 * chunk was never fetched). Both were fixed 2026-08-09.
 *
 * These tests pin the runtime properties that fix depends on. (The case that
 * proved a translated value resolved went with the other locales on
 * 2026-10-25: the app ships English only.)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { debtText } from '../DebtText';
import { FIRST_PAINT_PARTIAL_SECTIONS, sectionsForRoute } from '../routeSections';
import { EN_PARTIAL_SECTION_STRINGS } from '../generated/enSectionStrings';
import { useI18nStore } from '@/stores/i18nStore';
import enCatalog from '../locales/en.json';

const original = useI18nStore.getState().language;

afterEach(() => {
  useI18nStore.setState({ language: original });
  vi.restoreAllMocks();
});

describe('debt channel', () => {
  it('is a partial-core section: first-paint keys eager, the rest loaded on every route right after', () => {
    // Its 113 call sites span eight feature areas plus the always-mounted
    // sidebar chrome, so there is no route it does not reach. Until 2026-10-25
    // that meant BASE_SECTIONS (all 539 keys eager and awaited before mount);
    // now the sidebar's few keys ship eagerly and the idle background load
    // brings the rest - so no route preload is needed, and none is declared.
    expect(FIRST_PAINT_PARTIAL_SECTIONS).toContain('debt');
    expect(sectionsForRoute('home')).not.toContain('debt');
    const partial = JSON.parse(EN_PARTIAL_SECTION_STRINGS.debt!) as Record<string, string>;
    expect(Object.keys(partial).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(partial)) {
      expect(value).toBe((enCatalog.debt as Record<string, string>)[key]);
    }
  });

  it('falls back to real English prose, never to the raw key', () => {
    useI18nStore.setState({ language: 'en' });
    const key = 'auto_active_project_687de263' as Parameters<typeof debtText>[0];
    expect(debtText(key)).toBe((enCatalog.debt as Record<string, string>)[key]);
    expect(debtText(key)).not.toMatch(/^auto_/);
  });

  it('renders empty (and warns) for a key that is not in the catalog', () => {
    // The old fallback returned the key itself, which put
    // `auto_pause_capability_4b0c7b5f` on screen and into aria-labels. A blank
    // is honest; the raw hash is not.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bogus = 'auto_definitely_not_a_real_key_00000000' as Parameters<typeof debtText>[0];

    expect(debtText(bogus)).toBe('');
    expect(debtText(bogus)).not.toContain('auto_');
    if (import.meta.env.DEV) expect(warn).toHaveBeenCalled();
  });
});
