import type { Translations } from '@/i18n/en';
import type { RecipeCategory } from '../types';

/** i18n display labels for the 9-bucket recipe taxonomy. Shared by the
 *  browse filter, the results table, and the detail header so the same
 *  category never renders three different ways. */
export function getCategoryLabels(t: Translations): Record<RecipeCategory, string> {
  return {
    monitoring: t.recipes_catalog.category_monitoring,
    reporting: t.recipes_catalog.category_reporting,
    automation: t.recipes_catalog.category_automation,
    communication: t.recipes_catalog.category_communication,
    'data-sync': t.recipes_catalog.category_data_sync,
    analysis: t.recipes_catalog.category_analysis,
    development: t.recipes_catalog.category_development,
    content: t.recipes_catalog.category_content,
    productivity: t.recipes_catalog.category_productivity,
  };
}

export function categoryLabel(t: Translations, category: RecipeCategory): string {
  return getCategoryLabels(t)[category] ?? category;
}
