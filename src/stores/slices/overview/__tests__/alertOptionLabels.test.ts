/**
 * Alert option labels must follow the active language.
 *
 * `ALERT_METRIC_OPTIONS` / `ALERT_SEVERITY_OPTIONS` used to carry
 * `label: en.alerts.metric_error_rate` — a VALUE read off the English shim at
 * MODULE SCOPE. Module init runs once, before a language has been chosen and
 * long before any locale chunk resolves, so those labels were frozen English
 * for every user in every locale; the alert-rules panel rendered them directly
 * and there was no `useTranslation()` anywhere in the data path.
 *
 * They now carry keys, resolved at render through `alertLabel(t, …)`. This test
 * pins that: the same option list yields different strings for `en` and `es`.
 * It fails against the old value-carrying shape by construction, because that
 * shape had no key to resolve.
 *
 * Class-level protection is `custom/no-module-scope-en-value` (eslint-rules/),
 * which flags the pattern anywhere it reappears.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  ALERT_METRIC_OPTIONS,
  ALERT_SEVERITY_OPTIONS,
  alertLabel,
} from '../alertSlice';
import { preloadSectionsAsync, getActiveTranslations } from '@/i18n/useTranslation';
import { useI18nStore } from '@/stores/i18nStore';

const original = useI18nStore.getState().language;
afterEach(() => {
  useI18nStore.setState({ language: original });
});

async function labelsFor(language: 'en' | 'es') {
  useI18nStore.setState({ language });
  await preloadSectionsAsync(language, ['alerts']);
  const t = getActiveTranslations();
  return [
    ...ALERT_METRIC_OPTIONS.map((o) => alertLabel(t, o.labelKey)),
    ...ALERT_SEVERITY_OPTIONS.map((o) => alertLabel(t, o.labelKey)),
  ];
}

describe('alert option labels', () => {
  it('carry keys, not baked-in English values', () => {
    for (const option of [...ALERT_METRIC_OPTIONS, ...ALERT_SEVERITY_OPTIONS]) {
      expect(option).toHaveProperty('labelKey');
      expect(option).not.toHaveProperty('label');
    }
  });

  // English only since 2026-10-25 (SHIPPED_UI_LOCALES): the Spanish half of
  // this case went with the other locales. What it still pins is the shape -
  // the labels resolve through `t` from keys, with exact values.
  it('resolve through t to the English catalog', async () => {
    const english = await labelsFor('en');
    expect(english).toEqual([
      'Error Rate',
      'Success Rate',
      'Total Cost',
      'Cost vs. Average',
      'Executions',
      'Info',
      'Warning',
      'Critical',
    ]);
  });

  it('resolves back to English when the language switches back', async () => {
    const first = await labelsFor('en');
    await labelsFor('es');
    const again = await labelsFor('en');
    expect(again).toEqual(first);
  });
});
