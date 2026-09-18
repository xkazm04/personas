// A committed language switch used to paint English for one or more frames:
// `setLanguage` flipped the store immediately and the section preload ran from
// a post-render effect, so `getResolvedSection` returned the English chunk for
// every section of the current route that had not landed yet. A mixed bundle
// presented as ready is the failure mode the i18n rule calls worse than no
// translation at all.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { switchLanguage, getActiveTranslations } from '../useTranslation';
import { useI18nStore } from '@/stores/i18nStore';
import { useSystemStore } from '@/stores/systemStore';
import ja from '../locales/ja.json';
import en from '../locales/en.json';

type Section = Record<string, Record<string, unknown>>;

/** A leaf that exists in both bundles and differs between them. */
function divergentLeaf(section: string): { path: string[]; ja: string } | null {
  const jaSection = (ja as unknown as Record<string, Section>)[section];
  const enSection = (en as unknown as Record<string, Section>)[section];
  if (!jaSection || !enSection) return null;
  for (const group of Object.keys(jaSection)) {
    const jg = jaSection[group] as unknown;
    const eg = enSection[group] as unknown;
    if (typeof jg === 'string' && typeof eg === 'string' && jg !== eg) {
      return { path: [group], ja: jg };
    }
    if (!jg || !eg || typeof jg !== 'object' || typeof eg !== 'object') continue;
    const jgo = jg as Record<string, unknown>;
    const ego = eg as Record<string, unknown>;
    for (const key of Object.keys(jgo)) {
      const jv = jgo[key];
      const ev = ego[key];
      if (typeof jv === 'string' && typeof ev === 'string' && jv !== ev) {
        return { path: [group, key], ja: jv };
      }
    }
  }
  return null;
}

/** Walk a resolved section by the path `divergentLeaf` produced. */
function readPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const step of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[step];
  }
  return cur;
}

describe('switchLanguage', () => {
  beforeEach(() => {
    useI18nStore.setState({ language: 'en' });
    useSystemStore.setState({ sidebarSection: 'overview' });
  });

  afterEach(() => {
    useI18nStore.setState({ language: 'en' });
  });

  it('has the route section resolvable in the new locale by the time it returns', async () => {
    const leaf = divergentLeaf('overview');
    expect(leaf).not.toBeNull();

    await switchLanguage('ja');

    expect(useI18nStore.getState().language).toBe('ja');
    const t = getActiveTranslations() as unknown as Record<string, unknown>;
    expect(readPath(t.overview, leaf!.path)).toBe(leaf!.ja);
  });

  it('does not depend on a hover prefetch having run first', async () => {
    // Nothing touched `useLanguagePrefetch` in this test: a cold switch is the
    // case the effect-based preload could never cover.
    const leaf = divergentLeaf('common');
    expect(leaf).not.toBeNull();

    await switchLanguage('ja');

    const t = getActiveTranslations() as unknown as Record<string, unknown>;
    expect(readPath(t.common, leaf!.path)).toBe(leaf!.ja);
  });

  it('is a no-op when the language is already active', async () => {
    useI18nStore.setState({ language: 'ja' });
    await switchLanguage('ja');
    expect(useI18nStore.getState().language).toBe('ja');
  });
});
