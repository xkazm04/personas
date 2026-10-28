// The UI ships English only since 2026-10-25 (SHIPPED_UI_LOCALES in
// locales.manifest.ts). Until then this file proved that a switch to Japanese
// had the route's sections resolvable in Japanese by the time it returned; that
// behaviour is switched off with the other locales, and what is pinned now is
// the contract that replaced it: no path - a switch, a direct setLanguage, a
// language persisted by an older build - commits a language the build does not
// ship, the pickers that offered one are gone, and the generated loaders bundle
// English only. Reviving a locale means rewriting this file against it.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { switchLanguage } from '../useTranslation';
import { sectionLoaders } from '../generated/sectionLoaders';
import { EN_CORE_SECTION_STRINGS } from '../generated/enSectionStrings';
import { SHIPPED_UI_LOCALES, UI_LANGUAGE_PICKER_ENABLED, toShippedUiLocale } from '../locales.manifest';
import { useI18nStore } from '@/stores/i18nStore';
import { useSystemStore } from '@/stores/systemStore';

describe('English-only UI', () => {
  beforeEach(() => {
    useI18nStore.setState({ language: 'en' });
    useSystemStore.setState({ sidebarSection: 'overview' });
  });

  afterEach(() => {
    useI18nStore.setState({ language: 'en' });
  });

  it('ships English and nothing else, so no picker is offered', () => {
    expect(SHIPPED_UI_LOCALES).toEqual(['en']);
    expect(UI_LANGUAGE_PICKER_ENABLED).toBe(false);
  });

  it('commits English when asked to switch to a locale the build does not ship', async () => {
    await switchLanguage('ja');
    expect(useI18nStore.getState().language).toBe('en');
  });

  it('commits English when setLanguage is called with an unshipped locale', () => {
    useI18nStore.getState().setLanguage('de');
    expect(useI18nStore.getState().language).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('rehydrates a language persisted by an older build as English', () => {
    const merge = useI18nStore.persist.getOptions().merge!;
    const merged = merge({ language: 'ar' }, useI18nStore.getState());
    expect(merged.language).toBe('en');
    expect(toShippedUiLocale('en')).toBe('en');
  });

  // Latest pick wins: a switch started after another must not be overwritten
  // when the older one settles.
  it('does not let a slower, older switch overwrite a newer pick of English', async () => {
    const older = switchLanguage('cs');
    const newer = switchLanguage('en');
    await Promise.all([older, newer]);
    expect(useI18nStore.getState().language).toBe('en');
  });

  it('is a no-op when the language is already active', async () => {
    await switchLanguage('en');
    expect(useI18nStore.getState().language).toBe('en');
  });

  it('generates lazy loaders for English sections only, none for the eager core', () => {
    const paths = Object.keys(sectionLoaders);
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(p).toMatch(/\/section-locales\/en\/[^/]+\.json$/);
    const core = new Set(Object.keys(EN_CORE_SECTION_STRINGS));
    for (const p of paths) {
      const section = /\/([^/]+)\.json$/.exec(p)![1]!;
      expect(core.has(section), section).toBe(false);
    }
  });
});
