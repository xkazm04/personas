import { useCallback, useEffect, useState } from 'react';
import { useI18nStore } from '@/stores/i18nStore';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import {
  getLocalizedTemplateCatalog,
  getLocalizedTemplateCatalogStatus,
  invalidateTemplateCatalog,
  type CatalogLoadResult,
  type CatalogLoadStatus,
} from './templateCatalog';

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

/** Load-phase for {@link useLocalizedTemplateCatalogStatus}. */
export type TemplateCatalogPhase = 'loading' | CatalogLoadStatus;

export interface UseLocalizedTemplateCatalogStatus extends CatalogLoadResult {
  phase: TemplateCatalogPhase;
  /** Error from the last load attempt, if any. */
  error: Error | null;
  /** Clear caches and re-run the load. */
  retry: () => void;
}

/**
 * Variant of {@link useLocalizedTemplateCatalog} that exposes the
 * discriminated load result (ok | partial | failed | empty) plus a retry
 * affordance, so gallery code can distinguish a legitimately empty catalog
 * from one where every template failed verification.
 */
export function useLocalizedTemplateCatalogStatus(): UseLocalizedTemplateCatalogStatus {
  const language = useI18nStore((s) => s.language);
  const [phase, setPhase] = useState<TemplateCatalogPhase>('loading');
  const [result, setResult] = useState<CatalogLoadResult>({
    status: 'empty',
    templates: [],
    skipped: [],
  });
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    getLocalizedTemplateCatalogStatus(language)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setPhase(r.status);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setPhase('failed');
        setResult({ status: 'failed', templates: [], skipped: [] });
      });
    return () => { cancelled = true; };
  }, [language, nonce]);

  const retry = useCallback(() => {
    invalidateTemplateCatalog();
    setNonce((n) => n + 1);
  }, []);

  return { ...result, phase, error, retry };
}
