/**
 * Soundings dimension names are keys, not the registry's English `label`.
 * DIM_REGISTRY[key].label reached ReadingCard / ChartHeader / the frame labels
 * untranslated in all 13 non-English locales; the rendered name now comes from
 * `t.mastermind.dim_label_<key>` through `dimLabel`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_ORDER, DIM_REGISTRY } from '../lib/dimRegistry';
import { getActiveTranslations, preloadSectionsAsync } from '@/i18n/useTranslation';
import { useI18nStore } from '@/stores/i18nStore';

const original = useI18nStore.getState().language;
afterEach(() => useI18nStore.setState({ language: original }));

const labelOf = (key: string): string =>
  (getActiveTranslations().mastermind as unknown as Record<string, string>)[`dim_label_${key}`];

describe('soundings dimension labels', () => {
  it('has an English key for every registry dimension, equal to the registry label', async () => {
    useI18nStore.setState({ language: 'en' });
    await preloadSectionsAsync('en', ['mastermind']);
    for (const key of DIM_ORDER) expect(labelOf(key)).toBe(DIM_REGISTRY[key].label);
  });

  it('renders German names for the dimensions that have one', async () => {
    useI18nStore.setState({ language: 'de' });
    await preloadSectionsAsync('de', ['mastermind']);
    const differing = DIM_ORDER.filter((k) => labelOf(k) !== DIM_REGISTRY[k].label);
    expect(differing.length).toBeGreaterThanOrEqual(6);
  });
});
