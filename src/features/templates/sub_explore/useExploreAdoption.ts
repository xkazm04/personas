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
 */
import { useCallback, useState } from 'react';

import { listDesignReviewsPaginated } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/** Wide enough that a name shared by several templates still contains the
 *  exact id we are after; the match itself is always by id, never by name. */
const LOOKUP_PAGE = 50;

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
        const page = await listDesignReviewsPaginated({ search: name, perPage: LOOKUP_PAGE });
        const match = page.items.find((r) => r.test_case_id === templateId) ?? null;
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
