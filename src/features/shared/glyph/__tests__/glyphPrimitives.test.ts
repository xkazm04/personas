import { describe, it, expect } from 'vitest';
import { humanizeCron } from '../cron';
import { en } from '@/i18n/en';
import deCatalog from '@/i18n/locales/de.json';
import arCatalog from '@/i18n/locales/ar.json';
import jaCatalog from '@/i18n/locales/ja.json';
import ruCatalog from '@/i18n/locales/ru.json';
import zhCatalog from '@/i18n/locales/zh.json';

/** Locale catalogs imported as raw JSON. The shape assertion below is safe by
 *  construction: `check:i18n:strict` proves every locale has exactly the key
 *  set `en.json` declares, and `gen-types.mjs` derives `Translations` from
 *  that same file — so a locale JSON either matches the type or the coverage
 *  gate is already red. */
const ALL_CATALOGS = {
  en,
  de: deCatalog as unknown as typeof en,
  ar: arCatalog as unknown as typeof en,
  ja: jaCatalog as unknown as typeof en,
  ru: ruCatalog as unknown as typeof en,
  zh: zhCatalog as unknown as typeof en,
};
import { stackOffset } from '../helpers';
import { parseChannels, channelIcon, channelTint } from '../channels';
import { TRIGGER_ICONS, triggerIcon, triggerDetail } from '../triggers';
import { TRIGGER_KINDS } from '@/lib/utils/platform/triggerConstants';

describe('humanizeCron', () => {
  it('humanizes the single-valued shapes it claims to know', () => {
    expect(humanizeCron(en, '*/5 * * * *')).toBe('Every 5 min');
    expect(humanizeCron(en, '0 */6 * * *')).toBe('Every 6h');
    expect(humanizeCron(en, '0 9 * * *')).toBe('Daily · 09:00');
    expect(humanizeCron(en, '0 8 * * 1-5')).toBe('Weekdays · 08:00');
    expect(humanizeCron(en, '30 7 * * 0,6')).toBe('Weekends · 07:30');
    expect(humanizeCron(en, '0 9 * * 1')).toBe('Mon · 09:00');
    expect(humanizeCron(en, '0 9 * * 1-3')).toBe('Mon/Tue/Wed · 09:00');
  });

  it('falls through to the raw cron rather than misrepresenting a schedule', () => {
    // Not a 5-field cron.
    expect(humanizeCron(en, '0 9 * *')).toBe('0 9 * *');
    // Monthly — day-of-month is pinned, no phrasing for it.
    expect(humanizeCron(en, '0 0 1 * *')).toBe('0 0 1 * *');
  });

  it('never collapses a multi-run time field to one clock time', () => {
    // Regression: `parseInt("0,30")` is 0, so a minute list used to render as
    // "Daily · 09:00" and silently drop the 09:30 run.
    expect(humanizeCron(en, '0,30 9 * * *')).toBe('0,30 9 * * *');
    expect(humanizeCron(en, '0-15 9 * * *')).toBe('0-15 9 * * *');
    expect(humanizeCron(en, '*/10 9 * * *')).toBe('*/10 9 * * *');
    // The hour side of the same rule (already guarded — pinned here so it stays).
    expect(humanizeCron(en, '0 9,17 * * *')).toBe('0 9,17 * * *');
    expect(humanizeCron(en, '0 9-17 * * *')).toBe('0 9-17 * * *');
  });

  // The whole reason this function takes `t`. It used to return hardcoded
  // English — 'Weekdays · 08:00', 'Every 5 min', Sun/Mon/…/Sat — into all 14
  // locales, invisible to `custom/no-hardcoded-jsx-text` because a returned
  // string is not JSX text. Driven against a real catalog, not a stub, so a
  // key deleted from `de.json` fails here rather than silently falling back.
  it('renders its prose in the caller locale, not English', () => {
    const de = deCatalog as unknown as typeof en;
    expect(humanizeCron(de, '*/5 * * * *')).toBe('Alle 5 Min.');
    expect(humanizeCron(de, '0 */6 * * *')).toBe('Alle 6 Std.');
    expect(humanizeCron(de, '0 9 * * *')).toBe('Täglich · 09:00');
    expect(humanizeCron(de, '0 8 * * 1-5')).toBe('Wochentags · 08:00');
    expect(humanizeCron(de, '30 7 * * 0,6')).toBe('Am Wochenende · 07:30');
    expect(humanizeCron(de, '0 9 * * 1')).toBe('Mo · 09:00');
    expect(humanizeCron(de, '0 9 * * 1-3')).toBe('Mo/Di/Mi · 09:00');
    // A raw cron is a machine token — it must NOT be translated.
    expect(humanizeCron(de, '0 0 1 * *')).toBe('0 0 1 * *');
  });

  it('names all seven days in every locale', () => {
    for (const [locale, catalog] of Object.entries(ALL_CATALOGS)) {
      const names = catalog.templates.chronology.cron_day_names.split(',');
      expect(names, `${locale} cron_day_names`).toHaveLength(7);
      for (const name of names) {
        expect(name.trim().length, `${locale} has an empty day name`).toBeGreaterThan(0);
      }
    }
  });
});

describe('stackOffset', () => {
  it('alternates above/below from the centre anchor', () => {
    expect([0, 1, 2, 3, 4, 5].map(stackOffset)).toEqual([0, -1, 1, -2, 2, -3]);
  });
});

describe('parseChannels', () => {
  it('splits a concatenated summary into typed descriptors', () => {
    expect(parseChannels('slack: team · email: daily digest')).toEqual([
      { type: 'slack', description: 'team' },
      { type: 'email', description: 'daily digest' },
    ]);
  });

  it('keeps colons inside the description', () => {
    expect(parseChannels('webhook: POST https://x/y: hook')).toEqual([
      { type: 'webhook', description: 'POST https://x/y: hook' },
    ]);
  });

  it('is empty for absent input and drops typeless segments', () => {
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels('')).toEqual([]);
    expect(parseChannels(' · slack: team')).toEqual([{ type: 'slack', description: 'team' }]);
  });

  it('resolves icon and tint case-insensitively with a fallback', () => {
    expect(channelIcon('SLACK')).toBe(channelIcon('slack'));
    expect(channelTint('Telegram')).toBe('#229ED9');
    expect(channelTint('carrier-pigeon')).toBe('#60a5fa');
  });
});

describe('trigger vocabulary', () => {
  // Derived from TRIGGER_KINDS (the generated `TriggerKind` binding the SQL
  // CHECK and the Rust door validator also derive from), NOT from the icon
  // map's own keys — a test that reads the implementation's list can never
  // notice the list is short.
  it('gives every storable trigger kind a dedicated icon', () => {
    const generic = triggerIcon('__not_a_trigger_kind__');
    for (const kind of TRIGGER_KINDS) {
      expect(TRIGGER_ICONS[kind], `no icon for trigger kind "${kind}"`).toBeDefined();
      expect(triggerIcon(kind), `"${kind}" falls back to the generic icon`).not.toBe(generic);
    }
  });

  it('keeps the legacy `event` alias pointing at the `event_listener` icon', () => {
    expect(triggerIcon('event')).toBe(triggerIcon('event_listener'));
  });
});

describe('triggerDetail', () => {
  it('humanizes a schedule trigger cron', () => {
    expect(triggerDetail(en, { trigger_type: 'schedule', config: { cron: '0 9 * * *' } }))
      .toBe('Daily · 09:00');
  });

  it('falls back to the description when there is no cron', () => {
    expect(triggerDetail(en, { trigger_type: 'webhook', description: 'on push' })).toBe('on push');
    expect(triggerDetail(en, { trigger_type: 'schedule', config: {}, description: 'ad hoc' }))
      .toBe('ad hoc');
    expect(triggerDetail(en, { trigger_type: 'manual' })).toBe('');
  });
});
