import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseTriggerConfig,
  getTriggerCategory,
  getTriggerCategoryMeta,
  getTriggerCategories,
  getTriggerTypeOptions,
  getRateLimitWindowOptions,
  getTriggerTemplates,
  TRIGGER_CATEGORY_I18N,
  TRIGGER_CATEGORIES,
  TRIGGER_TEMPLATES,
  TRIGGER_KINDS,
  isLoopbackUrl,
  getTriggerTypeLabel,
} from '../platform/triggerConstants';
import { en } from '@/i18n/en';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

// `triggers` is a code-split, non-core English section (see
// src/i18n/useTranslation.ts's module header) — it isn't in en.ts's eager
// core because no PRODUCTION call site ever exercises the `(t = en)` default
// these functions carry (every real caller passes a live `t`); only this
// suite calls them with `en` directly. Await the chunk once, up front,
// rather than growing the production-eager core for a test-only path.
beforeAll(async () => {
  await preloadSectionsAsync('en', ['triggers']);
});

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

/**
 * The two halves of this module's vocabulary - a frozen English constant and a
 * `get*(t)` accessor for the same words - and the rule about which half a
 * component may render.
 *
 * Every one of the trigger pickers used to import the frozen half, so 31
 * already-translated `triggers.*` keys rendered nowhere and a Spanish user
 * chose between "Watch" and "Listen". The accessors were sitting in the same
 * file the whole time.
 */
describe('translated accessors vs the frozen English constants', () => {
  // `es.json` is the whole-bundle catalogue for one locale, shaped by the same
  // generator as `en`; the accessors only ever index `.triggers`, so the part
  // this test exercises is structurally identical. Read from disk rather than
  // imported so the assertion is about the shipped catalogue.
  const es = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/i18n/locales/es.json'), 'utf-8'),
  ) as Translations;

  it('renders category copy from the catalogue, not the frozen label', () => {
    const translated = getTriggerCategories(es);
    for (const [i, cat] of translated.entries()) {
      const frozen = TRIGGER_CATEGORIES[i]!;
      expect(cat.id).toBe(frozen.id);
      expect(cat.types).toEqual(frozen.types);
      // The non-copy fields are what the frozen constant is still FOR.
      expect(cat.color).toBe(frozen.color);
      expect(cat.label, `category ${cat.id}`).not.toBe(frozen.label);
      expect(cat.description, `category ${cat.id}`).not.toBe(frozen.description);
    }
  });

  it('renders type copy from the catalogue, not the frozen label', () => {
    const translated = getTriggerTypeOptions(es);
    expect(translated).toHaveLength(TRIGGER_KINDS.length);
    const english = getTriggerTypeOptions(en);
    const differing = translated.filter((o, i) => o.label !== english[i]!.label);
    // Not every kind's name necessarily differs across languages (a proper noun
    // like "Webhook" travels), so the assertion is that the catalogue is
    // genuinely being read, not that all ten words change.
    expect(differing.length).toBeGreaterThan(TRIGGER_KINDS.length / 2);
  });

  it('renders rate-limit windows and templates from the catalogue', () => {
    expect(getRateLimitWindowOptions(es).map((o) => o.label))
      .not.toEqual(getRateLimitWindowOptions(en).map((o) => o.label));
    expect(getTriggerTemplates(es).map((tpl) => tpl.label))
      .not.toEqual(getTriggerTemplates(en).map((tpl) => tpl.label));
  });

  it('keeps the templates addressable by id and type while translating the copy', () => {
    // TriggerAddForm resolves the applied template by id against the frozen
    // constant, so translation must not disturb identity or config.
    const translated = getTriggerTemplates(es);
    expect(translated.map((tpl) => tpl.id)).toEqual(TRIGGER_TEMPLATES.map((tpl) => tpl.id));
    expect(translated.map((tpl) => tpl.triggerType))
      .toEqual(TRIGGER_TEMPLATES.map((tpl) => tpl.triggerType));
    expect(translated.map((tpl) => tpl.config)).toEqual(TRIGGER_TEMPLATES.map((tpl) => tpl.config));
  });

  /**
   * The regression guard proper. A component that IMPORTS one of these
   * identifiers is rendering the English fallback copy - which is exactly the
   * state this module was in, in four render sites at once, while the
   * translations existed and were complete.
   *
   * Structural, not a substring test over the whole file: the first version of
   * this check was `expect(source).not.toContain(name)` and it failed on three
   * of the four files the moment they were fixed, because the comments
   * explaining the fix name the constants they replaced. A guard that a
   * correct file cannot satisfy is not a guard.
   */
  const TRIGGER_CONSTANTS_IMPORT =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@\/lib\/utils\/platform\/triggerConstants'/;

  const RENDER_SITES: readonly {
    file: string;
    forbidden: readonly string[];
    required: readonly string[];
  }[] = [
    {
      file: 'src/features/triggers/sub_triggers/TriggerCategorySelector.tsx',
      forbidden: ['TRIGGER_CATEGORIES'],
      required: ['getTriggerCategories'],
    },
    {
      file: 'src/features/triggers/sub_triggers/TriggerTypeSelector.tsx',
      forbidden: ['TRIGGER_CATEGORIES', 'TRIGGER_TYPE_OPTIONS'],
      required: ['getTriggerCategories', 'getTriggerTypeOptions'],
    },
    {
      file: 'src/features/triggers/sub_triggers/TriggerQuickTemplates.tsx',
      forbidden: ['TRIGGER_TEMPLATES'],
      required: ['getTriggerTemplates'],
    },
    {
      file: 'src/features/triggers/sub_triggers/RateLimitControls.tsx',
      forbidden: ['RATE_LIMIT_WINDOW_OPTIONS'],
      required: ['getRateLimitWindowOptions'],
    },
  ];

  it.each(RENDER_SITES)(
    '$file imports the translated accessors, not the frozen vocabulary',
    ({ file, forbidden, required }) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf-8');
      const match = TRIGGER_CONSTANTS_IMPORT.exec(source);
      // Guards the guard: a renamed, moved or restructured component would
      // otherwise pass by presenting nothing to inspect.
      expect(match, `${file}: no import from triggerConstants to inspect`).not.toBeNull();
      const imported = match![1]!.split(',').map((name) => name.trim().split(/\s+/)[0]!);
      expect(source, `${file} renders copy without useTranslation`).toContain('useTranslation');

      for (const name of forbidden) {
        expect(imported, `${file} imports ${name}, the English fallback copy`)
          .not.toContain(name);
      }
      for (const name of required) {
        expect(imported, `${file} should read ${name}`).toContain(name);
      }
    },
  );
});
