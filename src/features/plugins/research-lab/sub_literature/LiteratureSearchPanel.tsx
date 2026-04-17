import { useEffect, useState, lazy, Suspense, useMemo } from 'react';
import { BookOpen, ExternalLink, Trash2, Database, Search } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { SectionHeader } from '../_shared/SectionHeader';
import { EmptyState, NoActiveProject } from '../_shared/EmptyState';
import { sourceStatusColor, sourceStatusLabel, sourceTypeLabel } from '../_shared/tokens';

const AddSourceForm = lazy(() => import('./AddSourceForm'));
const ArxivSearchModal = lazy(() => import('./ArxivSearchModal'));

export default function LiteratureSearchPanel() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const sources = useSystemStore((s) => s.researchSources);
  const loading = useSystemStore((s) => s.researchSourcesLoading);
  const fetchSources = useSystemStore((s) => s.fetchResearchSources);
  const deleteSource = useSystemStore((s) => s.deleteResearchSource);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);

  const updateSourceStatus = useSystemStore((s) => s.updateSourceStatus);
  const addToast = useToastStore((s) => s.addToast);

  const [showAddForm, setShowAddForm] = useState(false);
  const [showArxiv, setShowArxiv] = useState(false);
  const [filter, setFilter] = useState('');
  const [ingestingId, setIngestingId] = useState<string | null>(null);

  const handleIngest = async (e: React.MouseEvent, sourceId: string) => {
    e.stopPropagation();
    setIngestingId(sourceId);
    try {
      await updateSourceStatus(sourceId, 'ingesting');
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

  const filtered = useMemo(() => {
    if (!filter.trim()) return sources;
    const q = filter.toLowerCase();
    return sources.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      (s.authors ?? '').toLowerCase().includes(q),
    );
  }, [sources, filter]);

  if (!activeProjectId) {
    return (
      <NoActiveProject
        icon={BookOpen}
        message={t.research_lab.select_project_first}
        onGoToProjects={() => setResearchLabTab('projects')}
        goToProjectsLabel={t.research_lab.projects}
      />
    );
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try { await deleteSource(id); } catch (err) { toastCatch("LiteratureSearchPanel:delete")(err); }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto">
      <SectionHeader
        title={t.research_lab.literature}
        actionLabel={t.research_lab.search_sources}
        onAction={() => setShowAddForm(true)}
        extra={
          <>
            <span className="typo-caption text-foreground">
              {filtered.length} / {sources.length} {t.research_lab.sources_count}
            </span>
            <button
              onClick={() => setShowArxiv(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-colors"
              title="Search arXiv"
            >
              <Search className="w-3.5 h-3.5" />
              arXiv
            </button>
          </>
        }
      />

      {sources.length > 2 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t.research_lab.filter_sources_placeholder}
          className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground focus:outline-none focus:border-primary/40"
        />
      )}

      {loading && sources.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="typo-body text-foreground">{t.common.loading}</p>
        </div>
      ) : filtered.length === 0 ? (
        sources.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t.research_lab.no_sources}
            hint={t.research_lab.no_sources_hint}
            actionLabel={t.research_lab.search_sources}
            onAction={() => setShowAddForm(true)}
          />
        ) : (
          <EmptyState icon={BookOpen} title={t.research_lab.no_matching_sources} />
        )
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
                  <h3 className="typo-card-label">{source.title}</h3>
                  {source.authors && (
                    <p className="typo-caption text-foreground mt-0.5">
                      {source.authors}{source.year ? ` (${source.year})` : ''}
                    </p>
                  )}
                  {source.abstractText && (
                    <p className="typo-body text-foreground mt-2 line-clamp-3">{source.abstractText}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary">{sourceTypeLabel(t, source.sourceType)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${sourceStatusColor(source.status)}`}>
                      {sourceStatusLabel(t, source.status)}
                    </span>
                    {source.doi && <span className="typo-micro text-foreground">{source.doi}</span>}
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary/50 hover:text-primary/80"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={source.url}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {source.relevanceScore != null && (
                    <div className="text-right">
                      <span className="typo-caption text-foreground">{t.research_lab.relevance}</span>
                      <p className="typo-data text-primary">{Math.round(source.relevanceScore * 100)}%</p>
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
                    title={t.common.delete}
                    aria-label={t.common.delete}
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

      {showArxiv && activeProjectId && (
        <Suspense fallback={null}>
          <ArxivSearchModal projectId={activeProjectId} onClose={() => setShowArxiv(false)} />
        </Suspense>
      )}
    </div>
  );
}
