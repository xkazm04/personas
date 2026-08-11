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
 * These tests pin the two runtime properties that fix depends on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { debtText } from '../DebtText';
import { preloadSectionsAsync } from '../useTranslation';
import { sectionsForRoute } from '../routeSections';
import { useI18nStore } from '@/stores/i18nStore';
import enCatalog from '../locales/en.json';

const original = useI18nStore.getState().language;

afterEach(() => {
  useI18nStore.setState({ language: original });
  vi.restoreAllMocks();
});

describe('debt channel', () => {
  it('is declared by BASE_SECTIONS so every route fetches it', () => {
    // Its 113 call sites span eight feature areas plus the always-mounted
    // sidebar chrome, so there is no route it does not reach.
    expect(sectionsForRoute('studio')).toContain('debt');
    expect(sectionsForRoute('home')).toContain('debt');
  });

  it('resolves a translated value once the locale section is loaded', async () => {
    useI18nStore.setState({ language: 'es' });
    await preloadSectionsAsync('es', ['debt']);

    const key = 'auto_active_project_687de263' as Parameters<typeof debtText>[0];
    const value = debtText(key);
    const english = (enCatalog.debt as Record<string, string>)[key];

    expect(value).toBeTruthy();
    expect(value).not.toBe(english);
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
