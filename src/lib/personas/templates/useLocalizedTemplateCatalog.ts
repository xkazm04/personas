import { useEffect, useState } from 'react';
import { useI18nStore } from '@/stores/i18nStore';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { getLocalizedTemplateCatalog } from './templateCatalog';

/**
 * React hook that returns the template catalog localized to the active UI
 * language. Automatically re-fetches + re-renders when the language
 * changes. The result is cached per language inside templateCatalog, so
 * toggling languages only pays the merge cost once per language.
 *
 * Returns an empty array on first render while the catalog is loading —
 * same behavior as the existing `getTemplateCatalog()` consumers.
 */
export function useLocalizedTemplateCatalog(): TemplateCatalogEntry[] {
  const language = useI18nStore((s) => s.language);
  const [catalog, setCatalog] = useState<TemplateCatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getLocalizedTemplateCatalog(language).then((entries) => {
      if (!cancelled) setCatalog(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return catalog;
}
