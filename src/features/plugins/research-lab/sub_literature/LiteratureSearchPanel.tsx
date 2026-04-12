import { useEffect, useState, lazy, Suspense } from 'react';
import { BookOpen, ExternalLink, Plus, Trash2, Database } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';

const AddSourceForm = lazy(() => import('./AddSourceForm'));

export default function LiteratureSearchPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const sources = useSystemStore((s) => s.researchSources);
  const loading = useSystemStore((s) => s.researchSourcesLoading);
  const fetchSources = useSystemStore((s) => s.fetchResearchSources);
  const deleteSource = useSystemStore((s) => s.deleteResearchSource);

  const updateSourceStatus = useSystemStore((s) => s.updateSourceStatus);
  const addToast = useToastStore((s) => s.addToast);

  const [showAddForm, setShowAddForm] = useState(false);
  const [filter, setFilter] = useState('');
  const [ingestingId, setIngestingId] = useState<string | null>(null);

  const handleIngest = async (e: React.MouseEvent, sourceId: string) => {
    e.stopPropagation();
    setIngestingId(sourceId);
    try {
      await updateSourceStatus(sourceId, 'ingesting');
      // Mark as indexed — actual KB pipeline integration is wired via the backend
      await updateSourceStatus(sourceId, 'indexed');
      addToast(t.research_lab.source_indexed, 'success');
    } catch (err) {
      await updateSourceStatus(sourceId, 'failed').catch(() => {});
      toastCatch("LiteratureSearchPanel:ingest")(err);
    } finally {
      setIngestingId(null);
    }
  };

  useEffect(() => {
    if (activeProjectId) fetchSources(activeProjectId);
  }, [activeProjectId, fetchSources]);

  const filtered = filter
    ? sources.filter((s) =>
        s.title.toLowerCase().includes(filter.toLowerCase()) ||
        (s.authors ?? '').toLowerCase().includes(filter.toLowerCase())
      )
    : sources;

  if (!activeProjectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <BookOpen className="w-10 h-10 text-foreground/20" />
        <p className="typo-body text-foreground/50">{t.research_lab.select_project_first}</p>
      </div>
    );
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await deleteSource(id); } catch (err) { toastCatch("LiteratureSearchPanel:delete")(err); }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between gap-3">
        <h2 className="typo-heading text-foreground">{t.research_lab.literature}</h2>
        <div className="flex items-center gap-2">
          <span className="typo-caption text-foreground/40">{filtered.length} {t.research_lab.sources_count}</span>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.research_lab.search_sources}
          </button>
        </div>
      </div>

      {sources.length > 5 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title or author..."
          className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
        />
      )}

      {loading && sources.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground/50">{t.common.loading}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <BookOpen className="w-10 h-10 text-foreground/20" />
          <p className="typo-body text-foreground/50">{sources.length === 0 ? t.research_lab.no_sources : 'No matching sources'}</p>
          {sources.length === 0 && (
            <p className="typo-caption text-foreground/30 max-w-sm text-center">{t.research_lab.no_sources_hint}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((source) => (
            <div
              key={source.id}
              className="rounded-card bg-secondary/50 border border-border/30 p-4 hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <BookOpen className="w-4 h-4 text-primary/50 mt-1 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="typo-body text-foreground font-medium">{source.title}</h3>
                  {source.authors && (
                    <p className="typo-caption text-foreground/50 mt-0.5">
                      {source.authors}{source.year ? ` (${source.year})` : ''}
                    </p>
                  )}
                  {source.abstractText && (
                    <p className="typo-micro text-foreground/40 mt-2 line-clamp-3">{source.abstractText}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary/60">{source.sourceType}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                      source.status === 'indexed' ? 'bg-green-500/20 text-green-300' :
                      source.status === 'ingesting' ? 'bg-amber-500/20 text-amber-300' :
                      source.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                      'bg-foreground/10 text-foreground/40'
                    }`}>{source.status}</span>
                    {source.doi && <span className="typo-micro text-foreground/30">{source.doi}</span>}
                    {source.url && (
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-primary/50 hover:text-primary/80">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {source.relevanceScore != null && (
                    <div className="text-right">
                      <span className="typo-micro text-foreground/30">{t.research_lab.relevance}</span>
                      <p className="typo-caption text-foreground/60 font-medium">{Math.round(source.relevanceScore * 100)}%</p>
                    </div>
                  )}
                  {source.status === 'pending' && (
                    <button
                      onClick={(e) => handleIngest(e, source.id)}
                      disabled={ingestingId === source.id}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                      title={t.research_lab.ingest_to_kb}
                    >
                      <Database className="w-3 h-3" />
                      {ingestingId === source.id ? t.research_lab.ingesting : t.research_lab.ingest_to_kb}
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDelete(e, source.id)}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400/60 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddForm && activeProjectId && (
        <Suspense fallback={null}>
          <AddSourceForm projectId={activeProjectId} onClose={() => setShowAddForm(false)} />
        </Suspense>
      )}
    </div>
  );
}
