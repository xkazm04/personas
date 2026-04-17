import { useEffect, useRef, useState } from 'react';
import { Search, ExternalLink, Check, Loader2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { searchArxiv, type ArxivResult } from './arxivClient';

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function ArxivSearchModal({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createSource = useSystemStore((s) => s.createResearchSource);
  const updateSourceStatus = useSystemStore((s) => s.updateSourceStatus);
  const addToast = useToastStore((s) => s.addToast);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArxivResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runSearch = async () => {
    if (!query.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setSelected(new Set());
    try {
      const rows = await searchArxiv({ query: query.trim(), maxResults: 20, signal: ctrl.signal });
      setResults(rows);
      if (rows.length === 0) addToast('No results', 'success');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      toastCatch("ArxivSearchModal:search")(err);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === results.length) setSelected(new Set());
    else setSelected(new Set(results.map((r) => r.id)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const picks = results.filter((r) => selected.has(r.id));
    if (picks.length === 0) return;

    setAdding(true);
    let added = 0;
    try {
      for (const r of picks) {
        try {
          const created = await createSource({
            projectId,
            sourceType: 'arxiv',
            title: r.title,
            authors: r.authors || undefined,
            year: r.year ?? undefined,
            abstractText: r.summary || undefined,
            url: r.url || undefined,
            doi: r.doi || undefined,
          });
          // Auto-mark as indexed — we have the full abstract + metadata from arXiv.
          if (r.summary) {
            await updateSourceStatus(created.id, 'indexed').catch(() => {});
          }
          added += 1;
        } catch (err) {
          toastCatch("ArxivSearchModal:addOne")(err);
        }
      }
      addToast(`Added ${added} sources`, 'success');
      onClose();
    } finally {
      setAdding(false);
    }
  };

  return (
    <ResearchLabFormModal
      title="arXiv search"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={`Add ${selected.size || ''}`.trim()}
      submitDisabled={selected.size === 0}
      saving={adding}
    >
      <div className="flex items-stretch gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-card bg-secondary/50 border border-border/30 focus-within:border-primary/40">
          <Search className="w-4 h-4 text-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="e.g. transformer reasoning chain-of-thought"
            className="flex-1 bg-transparent text-foreground typo-body outline-none placeholder:text-foreground"
            autoFocus
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2 rounded-card typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {t.common.search_ellipsis.replace('…', '') || 'Search'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="typo-caption text-foreground">{results.length} results</p>
          <button
            type="button"
            onClick={selectAll}
            className="typo-caption text-primary hover:text-primary"
          >
            {selected.size === results.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      )}

      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
        {results.map((r) => {
          const isSelected = selected.has(r.id);
          return (
            <label
              key={r.id}
              className={`flex items-start gap-3 p-3 rounded-card border cursor-pointer transition-colors ${
                isSelected ? 'bg-primary/8 border-primary/40' : 'bg-secondary/40 border-border/30 hover:border-primary/30'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(r.id)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="typo-card-label">{r.title}</p>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />}
                </div>
                <p className="typo-caption text-foreground mt-1">
                  {r.authors || 'Anon.'}{r.year ? ` · ${r.year}` : ''}
                  {r.doi ? ` · doi:${r.doi}` : ''}
                </p>
                {r.summary && (
                  <p className="typo-body text-foreground mt-1 line-clamp-3">{r.summary}</p>
                )}
                <div className="mt-1 flex items-center gap-3">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 typo-micro text-primary hover:text-primary"
                  >
                    <ExternalLink className="w-3 h-3" /> arXiv
                  </a>
                  {r.pdfUrl && (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 typo-micro text-primary hover:text-primary"
                    >
                      <ExternalLink className="w-3 h-3" /> PDF
                    </a>
                  )}
                </div>
              </div>
            </label>
          );
        })}

        {!loading && results.length === 0 && query === '' && (
          <p className="typo-caption text-foreground text-center py-8">
            Type a query and press Enter to search arXiv.
          </p>
        )}
      </div>
    </ResearchLabFormModal>
  );
}
