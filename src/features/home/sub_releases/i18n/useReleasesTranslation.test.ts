/**
 * Structural parity guard for the "What's New" content pipeline.
 *
 * `releases.json` owns the item ids; `en.json` owns their strings; the adapter
 * joins the two. When the join was hand-listed it drifted — release 0.0.2 item
 * 21 shipped in both sources but not in the map, so the card rendered the
 * literal `[0.0.2.21]`. The adapter now derives the map, and this test keeps the
 * two sources themselves from drifting apart in either direction.
 */
import { describe, it, expect } from 'vitest';

import { releasesConfig } from '@/data/releases';
import en from '@/i18n/locales/en.json';

const whatsNew = en.releases.whats_new as unknown as Record<string, string>;

const slug = (version: string) => version.replace(/\./g, '_');

/** Item ids en.json has strings for, per release version. */
function translatedItemIds(version: string): string[] {
  const re = new RegExp(`^release_${slug(version)}_item_(.+)_title$`);
  return Object.keys(whatsNew)
    .map((k) => re.exec(k)?.[1])
    .filter((id): id is string => id !== undefined);
}

describe('what\'s-new content parity', () => {
  const described = releasesConfig.releases.filter(
    (r) => whatsNew[`release_${slug(r.version)}_label`] !== undefined,
  );

  it('describes every release listed in releases.json', () => {
    expect(described.map((r) => r.version)).toEqual(
      releasesConfig.releases.map((r) => r.version),
    );
  });

  it.each(described.map((r) => r.version))(
    'release %s: every structural item id has a translated title',
    (version) => {
      const release = releasesConfig.releases.find((r) => r.version === version)!;
      const translated = new Set(translatedItemIds(version));
      const missing = release.items.map((i) => i.id).filter((id) => !translated.has(id));
      expect(missing).toEqual([]);
    },
  );

  it.each(described.map((r) => r.version))(
    'release %s: no translated item id is orphaned',
    (version) => {
      const release = releasesConfig.releases.find((r) => r.version === version)!;
      const structural = new Set(release.items.map((i) => i.id));
      const orphaned = translatedItemIds(version).filter((id) => !structural.has(id));
      expect(orphaned).toEqual([]);
    },
  );

  it.each(described.map((r) => r.version))(
    'release %s: every translated title has a matching description',
    (version) => {
      const missing = translatedItemIds(version).filter(
        (id) => whatsNew[`release_${slug(version)}_item_${id}_description`] === undefined,
      );
      expect(missing).toEqual([]);
    },
  );
});
