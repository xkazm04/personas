import { describe, it, expect } from 'vitest';
import {
  parseTriggerConfig,
  getTriggerCategory,
  getTriggerCategoryMeta,
  getTriggerCategories,
  getTriggerTypeOptions,
  TRIGGER_CATEGORY_I18N,
  TRIGGER_CATEGORIES,
  TRIGGER_KINDS,
  isLoopbackUrl,
  getTriggerTypeLabel,
} from '../platform/triggerConstants';
import { en } from '@/i18n/en';

describe('parseTriggerConfig — raw config coercion', () => {
  // Regression guard: `JSON.parse('null')` returns null, and the previous
  // implementation returned it unchanged, so the immediately following
  // `typeof raw.type` threw. Pins the fixed expression (a config object is
  // always returned) and forbids the old one (a throw).
  it('does not throw when the stored config is the JSON literal null', () => {
    expect(() => parseTriggerConfig('schedule', 'null')).not.toThrow();
    expect(parseTriggerConfig('schedule', 'null')).toEqual({
      type: 'schedule',
      cron: undefined,
      interval_seconds: undefined,
      timezone: undefined,
      max_backfill: undefined,
      event_type: undefined,
    });
  });

  it('treats scalars and arrays as an empty config rather than a shape', () => {
    expect(() => parseTriggerConfig('webhook', '5')).not.toThrow();
    expect(() => parseTriggerConfig('webhook', '"nope"')).not.toThrow();
    expect(() => parseTriggerConfig('webhook', '[1,2]')).not.toThrow();
    expect(parseTriggerConfig('webhook', '[1,2]')).toEqual({
      type: 'webhook',
      webhook_secret: undefined,
      event_type: undefined,
    });
  });

  it('still reads a well-formed config', () => {
    expect(parseTriggerConfig('webhook', '{"webhook_secret":"s3cret"}')).toMatchObject({
      type: 'webhook',
      webhook_secret: 's3cret',
    });
  });

  it('falls back to manual for an unknown trigger type', () => {
    expect(parseTriggerConfig('not_a_kind', null)).toEqual({
      type: 'manual',
      event_type: undefined,
    });
  });
});

describe('trigger category taxonomy', () => {
  // Guards the totality hole: every storable kind must resolve to a real
  // category, and only `manual` may resolve to the degenerate one.
  it('assigns every trigger kind a category other than the manual fallback', () => {
    for (const kind of TRIGGER_KINDS) {
      const category = getTriggerCategory(kind);
      if (kind === 'manual') {
        expect(category).toBe('manual');
      } else {
        expect(category).not.toBe('manual');
        expect(getTriggerCategoryMeta(kind)).toBeDefined();
      }
    }
  });
});

describe('trigger i18n key tables', () => {
  // Regression guard: the exported dotted-key table and the keys
  // `getTriggerCategories` actually reads used to be two hand-written copies of
  // the same mapping. The exported table is now derived, so they cannot drift.
  it('exports one dotted key per rendered category', () => {
    expect(Object.keys(TRIGGER_CATEGORY_I18N).sort()).toEqual(
      TRIGGER_CATEGORIES.map((c) => c.id).sort(),
    );
    for (const entry of Object.values(TRIGGER_CATEGORY_I18N)) {
      expect(entry.label.startsWith('triggers.')).toBe(true);
      expect(entry.desc.startsWith('triggers.')).toBe(true);
    }
  });

  // Cross-table parity: every key these tables name must exist in the English
  // catalog, or the UI silently renders the English fallback copy forever.
  it('names only keys that exist in the triggers section', () => {
    const triggers = en.triggers as unknown as Record<string, unknown>;
    for (const entry of Object.values(TRIGGER_CATEGORY_I18N)) {
      expect(triggers[entry.label.replace('triggers.', '')]).toBeTypeOf('string');
      expect(triggers[entry.desc.replace('triggers.', '')]).toBeTypeOf('string');
    }
    for (const kind of TRIGGER_KINDS) {
      expect(triggers[`type_${kind}`]).toBeTypeOf('string');
      expect(triggers[`desc_${kind}`]).toBeTypeOf('string');
    }
  });

  it('resolves translated copy for every kind and category', () => {
    const options = getTriggerTypeOptions();
    expect(options).toHaveLength(TRIGGER_KINDS.length);
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
    for (const category of getTriggerCategories()) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });
});

describe('getTriggerTypeLabel — one vocabulary, one language', () => {
  // Regression guard. The label map was built from `TRIGGER_TYPE_OPTIONS`, the
  // English fallback copy, so a non-English user got translated trigger names in
  // the add-trigger menu (`getTriggerTypeOptions`) and English ones in the status
  // summary. Both must now read the same `triggers.type_*` keys.
  it('reads the supplied catalog, not the English fallback copy', () => {
    const translated = {
      ...en,
      triggers: Object.fromEntries(
        TRIGGER_KINDS.map((kind) => [`type_${kind}`, `xx-${kind}`]),
      ),
    } as unknown as typeof en; // invariant: only `triggers.type_*` is read below.

    for (const kind of TRIGGER_KINDS) {
      expect(getTriggerTypeLabel(kind, translated)).toBe(`xx-${kind}`);
    }
  });

  it('agrees with getTriggerTypeOptions for every kind', () => {
    const byType = new Map(getTriggerTypeOptions(en).map((o) => [o.type, o.label]));
    for (const kind of TRIGGER_KINDS) {
      expect(getTriggerTypeLabel(kind, en)).toBe(byType.get(kind));
    }
  });

  it('still Title-Cases an unrecognised stored trigger type', () => {
    expect(getTriggerTypeLabel('not_a_kind', en)).toBe('Not a kind');
  });
});

describe('isLoopbackUrl — dev-affordance gate', () => {
  // Regression guard. This was `WEBHOOK_BASE_URL.includes('localhost')`, a
  // substring test on an operator-configurable URL, so a production host that
  // merely contained the word read as dev mode and lit the dev-only banner.
  it('rejects production hosts that merely contain the substring', () => {
    expect(isLoopbackUrl('https://localhost.example.com/hooks')).toBe(false);
    expect(isLoopbackUrl('https://hooks.example.com/localhost')).toBe(false);
    expect(isLoopbackUrl('https://example.com/?to=localhost')).toBe(false);
    expect(isLoopbackUrl('https://not-localhost.io')).toBe(false);
  });

  it('accepts the real loopback names, with any port or scheme', () => {
    expect(isLoopbackUrl('http://localhost:9420')).toBe(true);
    expect(isLoopbackUrl('https://LOCALHOST/webhook')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:9420')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:9420')).toBe(true);
  });

  it('treats an unparseable base URL as non-local (dev affordance stays off)', () => {
    expect(isLoopbackUrl('')).toBe(false);
    expect(isLoopbackUrl('localhost:9420')).toBe(false);
  });
});
