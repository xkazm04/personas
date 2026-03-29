import { useState, useCallback, useRef } from 'react';
import { smartSearchTemplates } from '@/api/overview/intelligence/smartSearch';
import { getDesignReview } from '@/api/overview/reviews';
import { silentCatchNull } from "@/lib/silentCatch";
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { createLogger } from '@/lib/log';

const logger = createLogger('ai-search');

export interface UseAiSearchReturn {
  aiSearchMode: boolean;
  setAiSearchMode: (m: boolean) => void;
  aiSearchLoading: boolean;
  aiSearchRationale: string;
  aiSearchActive: boolean;
  triggerAiSearch: (query: string) => void;
  clearAiSearch: () => void;
  aiCliLog: string[];
}

/**
 * AI-powered semantic search overlay for entity lists.
 *
 * When active, `onResults` is called with the AI-ranked items, allowing the
 * parent to override the normal paginated result set.
 */
export function useAiSearch(
  onResults: (items: PersonaDesignReview[], total: number) => void,
): UseAiSearchReturn {
  const [aiSearchMode, setAiSearchMode] = useState(false);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiSearchRationale, setAiSearchRationale] = useState('');
  const [aiSearchActive, setAiSearchActive] = useState(false);
  const [aiCliLog, setAiCliLog] = useState<string[]>([]);

  const aiSearchIdRef = useRef(0);

  const triggerAiSearch = useCallback((query: string) => {
    if (!query.trim() || query.trim().length < 5) return;

    const searchId = ++aiSearchIdRef.current;
    setAiSearchLoading(true);
    setAiSearchRationale('');
    setAiCliLog([]);

    (async () => {
      try {
        const result = await smartSearchTemplates(query.trim());
        if (searchId !== aiSearchIdRef.current) return;

        if (result.cliLog?.length) {
          setAiCliLog(result.cliLog);
        }

        if (result.rankedIds.length === 0) {
          setAiSearchRationale(result.rationale || 'No matching templates found.');
          onResults([], 0);
          setAiSearchActive(true);
          setAiSearchLoading(false);
          return;
        }

        const reviews = await Promise.all(
          result.rankedIds.map((id) =>
            getDesignReview(id).catch(silentCatchNull("aiSearch:getDesignReview")),
          ),
        );

        if (searchId !== aiSearchIdRef.current) return;

        const ordered = reviews.filter((r): r is PersonaDesignReview => r !== null);
        onResults(ordered, ordered.length);
        setAiSearchActive(true);

        // Surface partial coverage info when not all templates were searched
        let rationale = result.rationale;
        if (result.totalTemplates > 0 && result.templatesSearched < result.totalTemplates) {
          rationale += ` (searched ${result.templatesSearched} of ${result.totalTemplates} templates)`;
        }
        setAiSearchRationale(rationale);
      } catch (err: unknown) {
        if (searchId !== aiSearchIdRef.current) return;
        logger.warn('AI search failed, falling back to keyword search', { err: err instanceof Error ? err.message : String(err) });
        const errMsg = err instanceof Error ? err.message : String(err);
        setAiSearchRationale(`AI search failed: ${errMsg}`);
        setAiSearchActive(false);
      } finally {
        if (searchId === aiSearchIdRef.current) {
          setAiSearchLoading(false);
        }
      }
    })();
  }, [onResults]);

  const clearAiSearch = useCallback(() => {
    aiSearchIdRef.current++;
    setAiSearchActive(false);
    setAiSearchRationale('');
    setAiSearchLoading(false);
    setAiCliLog([]);
  }, []);

  return {
    aiSearchMode,
    setAiSearchMode,
    aiSearchLoading,
    aiSearchRationale,
    aiSearchActive,
    triggerAiSearch,
    clearAiSearch,
    aiCliLog,
  };
}
