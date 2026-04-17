import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, FileText, Clock, ArrowRight } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { useTranslation } from '@/i18n/useTranslation';
import type { KnowledgeBase, VectorSearchResult } from '@/api/vault/database/vectorKb';
import { kbSearch } from '@/api/vault/database/vectorKb';
import { SearchResultCard } from '../search/SearchResultCard';

interface SearchTabProps {
  kb: KnowledgeBase;
}

export function SearchTab({ kb }: SearchTabProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(10);
  const [results, setResults] = useState<VectorSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setError(null);
    const t0 = performance.now();

    try {
      const res = await kbSearch({
        kbId: kb.id,
        query: trimmed,
        topK: topK,
      });
      if (!mountedRef.current) return;
      setResults(res);
      setLastQuery(trimmed);
      setDurationMs(Math.round(performance.now() - t0));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  }, [query, kb.id, topK]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSearch();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-6 py-4 border-b border-primary/10 shrink-0 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sh.search_placeholder}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-secondary/30 border border-primary/15 rounded-modal text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-violet-500/40 focus-visible:ring-1 focus-visible:ring-violet-500/20 transition-colors"
              autoFocus
            />
          </div>
          <button
            onClick={() => void handleSearch()}
            disabled={!query.trim() || searching}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-modal bg-violet-600/80 hover:bg-violet-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {searching ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" />
            )}
            {sh.search}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
          <label className="flex items-center gap-1.5">
            {sh.results_label}
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="bg-secondary/40 border border-primary/10 rounded-input px-1.5 py-0.5 text-foreground/70 text-xs"
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <span>{sh.press_enter}</span>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-card bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {results === null && !error && (
          <EmptyIllustration
            icon={Search}
            heading={sh.search_kb}
            description={sh.search_kb_hint}
            className="py-20"
          />
        )}

        {results !== null && results.length === 0 && (
          <EmptyIllustration
            icon={FileText}
            heading={sh.no_results}
            description={sh.no_results_hint}
            className="py-20"
          />
        )}

        {results !== null && results.length > 0 && (
          <div className="p-6 space-y-3">
            {/* Stats bar */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground/50 mb-2">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {durationMs}ms
              </span>
              <span>{results.length} result{results.length !== 1 ? 's' : ''} for "{lastQuery}"</span>
            </div>

            {results.map((result, i) => (
              <SearchResultCard key={result.chunkId} result={result} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
