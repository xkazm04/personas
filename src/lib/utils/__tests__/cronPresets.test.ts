/**
 * Cron presets must carry keys, not baked-in English.
 *
 * `CRON_PRESETS` shipped sixteen hardcoded English labels ('Every 5 min',
 * 'Twice daily (9 AM & 5 PM)', …) into a 14-locale app, rendered raw by the
 * schedule and trigger pickers, while the sibling cloud-deployment preset list
 * was already translated. This pins the resolved shape: the same list yields
 * different strings for `en` and `de`, which the old value-carrying shape
 * could not do by construction.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CRON_PRESETS, cronPresetLabel } from '../cronPresets';
import { preloadSectionsAsync, getActiveTranslations } from '@/i18n/useTranslation';
import { useI18nStore } from '@/stores/i18nStore';

const original = useI18nStore.getState().language;
afterEach(() => {
  useI18nStore.setState({ language: original });
});

async function labelsFor(language: 'en') {
  useI18nStore.setState({ language });
  await preloadSectionsAsync(language, ['schedules']);
  const t = getActiveTranslations();
  return CRON_PRESETS.map((preset) => cronPresetLabel(t, preset));
}

describe('CRON_PRESETS', () => {
  it('carries an id, never a label', () => {
    for (const preset of CRON_PRESETS) {
      expect(preset).toHaveProperty('id');
      expect(preset).not.toHaveProperty('label');
    }
  });

  it('keeps every id and every cron expression distinct', () => {
    expect(new Set(CRON_PRESETS.map((p) => p.id)).size).toBe(CRON_PRESETS.length);
    expect(new Set(CRON_PRESETS.map((p) => p.cron)).size).toBe(CRON_PRESETS.length);
  });

  // English only since 2026-10-25: the German comparison that proved the
  // labels resolve per language went with the other locales. Every preset
  // must still resolve to a real English string through `t`.
  it('resolves an English label for every preset', async () => {
    const english = await labelsFor('en');
    expect(english[0]).toBe('Every minute');
    for (const [i, label] of english.entries()) {
      expect(typeof label, CRON_PRESETS[i]!.id).toBe('string');
      expect(label, CRON_PRESETS[i]!.id).not.toBe('');
    }
  });
});
