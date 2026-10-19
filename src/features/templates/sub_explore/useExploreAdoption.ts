/**
 * Explore level 2 could pick a template and then had nowhere to send it: the
 * pick rendered a bottom toast reading "detail/adopt would open here", so the
 * catalog-browse path could not start an adoption at all.
 *
 * The catalog id an Explore row carries IS the seeded review's `test_case_id`
 * (`seedTemplates.ts` writes `test_case_id: template.id`), so resolving a pick
 * to the row the gallery would have opened is one paginated lookup. Recipes
 * resolve through their `sourceTemplateId` — adoption is a template concept,
 * and a recipe with no source template has nothing to adopt.
 *
 * The lookup is a LIKE over `test_case_name` / `instruction`, so the search
 * term must be the name the seed actually wrote: the template's name in the
 * seeded language (`seedTemplates.ts` resolves the per-language overlay).
 * Searching by the picked row's own name missed every recipe (a recipe's
 * title is not its template's name: 0 of 100 linked recipes matched) and
 * every template whose seed row was written in a language other than English.
 */
import { useCallback, useState } from 'react';

import { listDesignReviewsPaginated } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { getLocalizedTemplateCatalog, getTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import { useI18nStore } from '@/stores/i18nStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/** Wide enough that a name shared by several templates still contains the
 *  exact id we are after; the match itself is always by id, never by name. */
const LOOKUP_PAGE = 50;

/**
 * Names a seed row for `templateId` can carry, most likely first: the active
 * language's overlay name, then the canonical English name (a seed written
 * before a language switch), then the name the pick showed. Catalog failure
 * only drops the first two.
 */
async function seedNamesFor(templateId: string, pickedName: string): Promise<string[]> {
  const names: string[] = [];
  try {
    const [localized, canonical] = await Promise.all([
      getLocalizedTemplateCatalog(useI18nStore.getState().language),
      getTemplateCatalog(),
    ]);
    for (const list of [localized, canonical]) {
      const name = list.find((e) => e.id === templateId)?.name;
      if (name) names.push(name);
    }
  } catch (err) {
    silentCatch('useExploreAdoption:seedNamesFor')(err);
  }
  names.push(pickedName);
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}

export function useExploreAdoption() {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [review, setReview] = useState<PersonaDesignReview | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const openAdopt = useCallback(
    async (templateId: string | null, name: string) => {
      if (!templateId) {
        addToast(tx(t.explore.adopt_no_template, { name }), 'warning');
        return;
      }
      setResolvingId(templateId);
      try {
        let match: PersonaDesignReview | null = null;
        for (const search of await seedNamesFor(templateId, name)) {
          const page = await listDesignReviewsPaginated({ search, perPage: LOOKUP_PAGE });
          match = page.items.find((r) => r.test_case_id === templateId) ?? null;
          if (match) break;
        }
        if (match) setReview(match);
        else addToast(tx(t.explore.adopt_not_found, { name }), 'warning');
      } catch (err) {
        silentCatch('useExploreAdoption:listDesignReviewsPaginated')(err);
        addToast(tx(t.explore.adopt_failed, { name }), 'error');
      } finally {
        setResolvingId(null);
      }
    },
    [addToast, t, tx],
  );

  return {
    /** The review the adoption wizard should open on, or null. */
    review,
    /** Catalog id currently being resolved, so the row can show it is busy. */
    resolvingId,
    openAdopt,
    /** Cancel returns to the same domain rather than unmounting the level. */
    closeAdopt: useCallback(() => setReview(null), []),
  };
}
