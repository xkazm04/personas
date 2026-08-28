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

async function labelsFor(language: 'en' | 'de') {
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

  it('resolves a label for every preset in every language it is asked for', async () => {
    const english = await labelsFor('en');
    const german = await labelsFor('de');

    expect(english[0]).toBe('Every minute');
    expect(german[0]).toBe('Jede Minute');

    // Every single one moves — a "some of them differ" assertion would still
    // pass if resolution regressed for most of the list.
    for (const [i, label] of english.entries()) {
      expect(label, CRON_PRESETS[i]!.id).not.toBe('');
      expect(german[i], CRON_PRESETS[i]!.id).not.toBe(label);
    }
  });
});
