import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, FileText, Clock, ArrowRight, ChevronDown } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { useTranslation } from '@/i18n/useTranslation';
import type { KnowledgeBase, VectorSearchResult } from '@/api/vault/database/vectorKb';
import { kbSearch, kbListDocuments } from '@/api/vault/database/vectorKb';
import { silentCatch } from '@/lib/silentCatch';
import { trackInteraction } from '@/lib/analytics';
import { createLatestWins } from '@/stores/util/latestWins';
import { SearchResultCard } from '../search/SearchResultCard';
import { KbErrorNotice } from '../KbErrorNotice';

/** A compact dropdown over the shared `Listbox` (a raw native select element is a census
 *  violation: raw-select). Trigger shows the current label; options are
 *  `role="option"` buttons the Listbox drives from the keyboard. */
function CompactListbox<T extends string | number>({ ariaLabel, value, options, onChange, className = '', testId }: {
  ariaLabel: string;
  testId?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? String(value);
  return (
    <Listbox
      ariaLabel={ariaLabel}
      itemCount={options.length}
      onSelectFocused={(i) => { const o = options[i]; if (o) onChange(o.value); }}
      className={className}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          data-testid={testId}
          className="flex max-w-48 items-center gap-1 truncate bg-secondary/40 border border-primary/10 rounded-input px-1.5 py-0.5 text-foreground typo-caption"
        >
          <span className="truncate">{current}</span>
          <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {options.map((o) => (
            <button
              type="button"
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); close(); }}
              className={`flex w-full items-center px-3 py-1.5 text-left typo-caption transition-colors hover:bg-secondary/50 ${o.value === value ? 'text-primary' : 'text-foreground'}`}
            >
              {o.label}
            </button>
          ))}
        </>
      )}
    </Listbox>
  );
}

interface SearchTabProps {
  kb: KnowledgeBase;
}

export function SearchTab({ kb }: SearchTabProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(10);
  const [results, setResults] = useState<VectorSearchResult[] | null>(null);
  const [floorFiltered, setFloorFiltered] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  // `kb_search` has always accepted `filterSource` (a prefix match on the
  // chunk's source path) and the UI passed three of five parameters, so the
  // most common follow-up on a corpus past a few dozen files — "search only
  // this document" — was built, typed, shipped and unreachable.
  const [sources, setSources] = useState<Array<{ path: string; title: string }>>([]);
  const [source, setSource] = useState('');
  const mountedRef = useRef(true);
  // Only the most recently issued query may paint. Enter-to-search is not gated
  // on `searching`, so two requests can be in flight and the slower one would
  // otherwise overwrite the fresher results with staler ones.
  const latestWins = useRef(createLatestWins()).current;

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Only documents with a source path can be scoped: the backend matches on
  // that prefix, so pasted text (no path) is deliberately not offered.
  useEffect(() => {
    kbListDocuments(kb.id)
      .then((docs) => {
        if (!mountedRef.current) return;
        const byPath = new Map<string, string>();
        for (const d of docs) {
          if (d.sourcePath && !byPath.has(d.sourcePath)) byPath.set(d.sourcePath, d.title);
        }
        setSources([...byPath].map(([path, title]) => ({ path, title })));
      })
      .catch(silentCatch('kb search source list'));
  }, [kb.id]);

  const runSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    const seq = latestWins.next();
    setSearching(true);
    setError(null);
    const t0 = performance.now();

    try {
      const res = await kbSearch({
        kbId: kb.id,
        query: trimmed,
        topK: topK,
        filterSource: source || undefined,
      });
      if (!mountedRef.current || !latestWins.isCurrent(seq)) return;
      const elapsed = Math.round(performance.now() - t0);
      setResults(res.results);
      setFloorFiltered(res.floorFiltered);
      setLastQuery(trimmed);
      setDurationMs(elapsed);
      // The surface already computes the two numbers that answer "is retrieval
      // any good here?" and used to throw both away on the next query. Counts
      // only — never the query text, which is user content.
      trackInteraction(
        'vector_kb',
        'search',
        `results=${res.results.length};floor=${res.floorFiltered};ms=${elapsed};topK=${topK}`,
      );
    } catch (err) {
      if (!mountedRef.current || !latestWins.isCurrent(seq)) return;
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      if (mountedRef.current && latestWins.isCurrent(seq)) setSearching(false);
    }
  }, [kb.id, topK, source, latestWins]);

  const handleSearch = useCallback(() => runSearch(query), [runSearch, query]);

  // A filter control has to see the whole set on change. Changing "Results: 10"
  // to 50 next to a rendered list used to do nothing at all — no refetch, and no
  // hint that the control was armed for some later search. It re-runs the LAST
  // executed query (not whatever is currently typed in the box, which the user
  // has not asked for yet). Refs keep `lastQuery` out of the dep array: it
  // changes on every search, and depending on it would make this loop.
  const runSearchRef = useRef(runSearch);
  runSearchRef.current = runSearch;
  const lastQueryRef = useRef<string | null>(null);
  lastQueryRef.current = lastQuery;
  const filtersSettledRef = useRef(false);
  useEffect(() => {
    if (!filtersSettledRef.current) { filtersSettledRef.current = true; return; }
    const previous = lastQueryRef.current;
    if (previous) void runSearchRef.current(previous);
  }, [topK, source]);

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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sh.search_placeholder}
              className="w-full pl-10 pr-4 py-2.5 typo-body bg-secondary/30 border border-primary/15 rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/40 focus-visible:ring-1 focus-visible:ring-violet-500/20 transition-colors"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={!query.trim() || searching}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 typo-body font-medium rounded-modal bg-violet-600/80 hover:bg-violet-600 text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {searching ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" />
            )}
            {sh.search}
          </button>
        </div>

        <div className="flex items-center gap-3 typo-caption text-foreground">
          <label className="flex items-center gap-1.5">
            {sh.results_label}
            <CompactListbox
              ariaLabel={sh.results_label}
              testId="kb-search-topk"
              value={topK}
              options={[5, 10, 20, 50].map((n) => ({ value: n, label: String(n) }))}
              onChange={setTopK}
            />
          </label>
          {sources.length > 0 && (
            <label className="flex items-center gap-1.5 min-w-0">
              {sh.search_source_label}
              <CompactListbox
                ariaLabel={sh.search_source_label}
                testId="kb-search-source"
                value={source}
                options={[{ value: '', label: sh.search_source_all }, ...sources.map((s) => ({ value: s.path, label: s.title }))]}
                onChange={setSource}
              />
            </label>
          )}
          <span>{sh.press_enter}</span>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && <KbErrorNotice raw={error} className="mx-6 mt-4" />}

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
            description={floorFiltered > 0
              ? tx(sh.no_results_floor_hint, { count: floorFiltered })
              : sh.no_results_hint}
            className="py-20"
          />
        )}

        {results !== null && results.length > 0 && (
          <div className="p-6 space-y-3">
            {/* Stats bar */}
            <div className="flex items-center gap-3 typo-caption text-foreground mb-2">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {durationMs}ms
              </span>
              {/*
                The count carries a predicate. A full page is the TOP n of an
                unknown-sized match set, not the whole of it — "10 results"
                taught the user that ten is all there is. A short page is the
                honest "all n". (The candidate total the backend actually knows
                is not on KbSearchResponse; saying "top" claims only what the
                surface can see.)
              */}
              <span>{tx(
                results.length >= topK
                  ? sh.search_results_capped
                  : results.length === 1 ? sh.search_results_one : sh.search_results_other,
                { count: results.length, query: lastQuery ?? '' },
              )}</span>
              {floorFiltered > 0 && (
                <span>{tx(sh.search_floor_filtered, { count: floorFiltered })}</span>
              )}
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
