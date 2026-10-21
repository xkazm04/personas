import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en.json';
import cs from '@/i18n/locales/cs.json';
import type { Translations } from '@/i18n/generated/types';
import { CATEGORY_META, CATEGORY_ROLE_GROUPS, SORT_OPTIONS, categoryLabel } from '../searchConstants';

// Czech over English, as the runtime proxy merges a locale section.
const tCs = { ...en, templates: { ...en.templates, search: { ...en.templates.search, ...cs.templates.search } } } as unknown as Translations;
const tEn = en as unknown as Translations;

describe('gallery sort and category labels', () => {
  it('words every sort option, category and role group through the catalog', () => {
    for (const o of SORT_OPTIONS) expect(typeof tEn.templates.search[o.labelKey]).toBe('string');
    for (const m of Object.values(CATEGORY_META)) expect(typeof tEn.templates.search[m.labelKey]).toBe('string');
    for (const g of CATEGORY_ROLE_GROUPS) expect(typeof tEn.templates.search[g.labelKey]).toBe('string');
  });

  it('renders Czech, not English, for sort and category labels', () => {
    for (const o of SORT_OPTIONS.filter((x) => x.labelKey !== 'sort_name_asc' && x.labelKey !== 'sort_name_desc')) {
      expect(tCs.templates.search[o.labelKey]).not.toBe(tEn.templates.search[o.labelKey]);
    }
    expect(categoryLabel(tCs, 'support')).toBe(cs.templates.search.cat_support);
    expect(categoryLabel(tCs, 'support')).not.toBe('Support');
  });

  it('resolves aliases and keeps the raw name for unknown categories', () => {
    expect(categoryLabel(tEn, 'CI-CD')).toBe('DevOps');
    expect(categoryLabel(tEn, 'mystery')).toBe('mystery');
  });
});
