/**
 * LiteratureSearchPanelAtelier — 3-pane variant for sources.
 *
 * Layout: header band → [source-type rail | hero source w/ abstract | recent thread].
 * Selecting a source on the right swaps the centre. Source-type rail filters
 * the visible chronology.
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Plus, ExternalLink, Database, Trash2, Quote, ArrowRight, Sparkles,
  AlertCircle, Search,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import type { Translations } from '@/i18n/en';
import type { ResearchSource } from '@/api/researchLab/researchLab';
import {
  sourceStatusColor, sourceStatusLabel, sourceTypeLabel,
  type SourceType, SOURCE_TYPES,
} from '../_shared/tokens';
import { NoActiveProject } from '../_shared/EmptyState';

const AddSourceForm = lazy(() => import('./AddSourceForm'));
const ArxivSearchModal = lazy(() => import('./ArxivSearchModal'));

export default function LiteratureSearchPanelAtelier() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeResearchProjectId);
  const sources = useSystemStore((s) => s.researchSources);
  const fetchSources = useSystemStore((s) => s.fetchResearchSources);
  const deleteSource = useSystemStore((s) => s.deleteResearchSource);
  const updateSourceStatus = useSystemStore((s) => s.updateSourceStatus);
  const setResearchLabTab = useSystemStore((s) => s.setResearchLabTab);
  const addToast = useToastStore((s) => s.addToast);

  const [showAdd, setShowAdd] = useState(false);
  const [showArxiv, setShowArxiv] = useState(false);
  const [typeFilter, setTypeFilter] = useState<SourceType | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState<string | null>(null);

  useEffect(() => {
    if (activeProjectId) fetchSources(activeProjectId);
  }, [activeProjectId, fetchSources]);

  const ordered = useMemo(
    () => [...sources].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [sources],
  );

  const visible = useMemo(() => {
    if (!typeFilter) return ordered;
    return ordered.filter((s) => s.sourceType === typeFilter);
  }, [ordered, typeFilter]);

  const heroSource = useMemo(() => {
    if (heroId) return ordered.find((s) => s.id === heroId) ?? visible[0];
    return visible[0];
  }, [heroId, visible, ordered]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sources.forEach((s) => counts.set(s.sourceType, (counts.get(s.sourceType) ?? 0) + 1));
    return counts;
  }, [sources]);

  const indexedCount = sources.filter((s) => s.status === 'indexed').length;
  const pendingCount = sources.filter((s) => s.status === 'pending').length;

  const handleIngest = async (id: string) => {
    setIngesting(id);
    try {
      await updateSourceStatus(id, 'ingesting');
      await updateSourceStatus(id, 'indexed');
      addToast(t.research_lab.source_indexed, 'success');
    } catch (err) {
      await updateSourceStatus(id, 'failed').catch(() => {});
      toastCatch('LiteratureAtelier:ingest')(err);
    } finally {
      setIngesting(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSource(id);
      if (heroId === id) setHeroId(null);
    } catch (err) {
      toastCatch('LiteratureAtelier:delete')(err);
    }
  };

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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      <AtelierHeader
        t={t}
        title={t.research_lab.literature}
        subtitle={`Atelier · ${indexedCount} indexed · ${pendingCount} pending`}
        onAdd={() => setShowAdd(true)}
        onArxiv={() => setShowArxiv(true)}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <SourceTypeRail
          t={t}
          counts={typeCounts}
          totalSources={sources.length}
          selected={typeFilter}
          onSelect={setTypeFilter}
        />

        <main className="flex-1 min-w-0 relative overflow-hidden">
          <BackgroundGrid />
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-10 py-10">
              <AnimatePresence mode="wait">
                {heroSource ? (
                  <motion.div
                    key={heroSource.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                  >
                    <SourceHero
                      source={heroSource}
                      t={t}
                      ingesting={ingesting === heroSource.id}
                      onIngest={() => handleIngest(heroSource.id)}
                      onDelete={() => handleDelete(heroSource.id)}
                    />
                  </motion.div>
                ) : (
                  <AtelierEmpty
                    t={t}
                    onAdd={() => setShowAdd(true)}
                    onArxiv={() => setShowArxiv(true)}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </main>

        <ChronologyThread
          t={t}
          sources={visible}
          activeId={heroSource?.id ?? null}
          onSelect={setHeroId}
        />
      </div>

      {showAdd && activeProjectId && (
        <Suspense fallback={null}>
          <AddSourceForm projectId={activeProjectId} onClose={() => setShowAdd(false)} />
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

// ---------------------------------------------------------------------------

function AtelierHeader({
  t, title, subtitle, onAdd, onArxiv,
}: {
  t: Translations;
  title: string;
  subtitle: string;
  onAdd: () => void;
  onArxiv: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015]">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="typo-section-title text-foreground truncate">{title}</span>
            <span className="text-xs uppercase tracking-[0.2em] text-foreground/60 truncate">
              {subtitle}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={onArxiv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          arXiv
        </button>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.search_sources}
        </button>
      </div>
    </div>
  );
}

function SourceTypeRail({
  t, counts, totalSources, selected, onSelect,
}: {
  t: Translations;
  counts: Map<string, number>;
  totalSources: number;
  selected: SourceType | null;
  onSelect: (type: SourceType | null) => void;
}) {
  return (
    <aside className="hidden lg:flex w-56 flex-shrink-0 flex-col border-r border-border/40 px-3 py-6 gap-1 overflow-y-auto">
      <p className="text-xs uppercase tracking-[0.2em] text-foreground/55 px-2 mb-2">
        Source types
      </p>
      <RailItem label="All sources" count={totalSources} selected={selected === null} onClick={() => onSelect(null)} />
      {SOURCE_TYPES.map((type) => {
        const count = counts.get(type) ?? 0;
        if (count === 0) return null;
        return (
          <RailItem
            key={type}
            label={sourceTypeLabel(t, type)}
            count={count}
            selected={selected === type}
            onClick={() => onSelect(type)}
          />
        );
      })}
    </aside>
  );
}

function RailItem({
  label, count, selected, onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-interactive transition-colors text-left ${
        selected ? 'bg-primary/15 text-primary' : 'text-foreground/85 hover:bg-foreground/[0.04]'
      }`}
    >
      <span className="typo-caption truncate">{label}</span>
      <span className="typo-caption tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function SourceHero({
  source, t, ingesting, onIngest, onDelete,
}: {
  source: ResearchSource;
  t: Translations;
  ingesting: boolean;
  onIngest: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-7">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2.5 py-1 typo-caption uppercase tracking-wide rounded-full bg-foreground/[0.06] text-foreground/85">
          {sourceTypeLabel(t, source.sourceType)}
        </span>
        <span className={`px-2.5 py-1 typo-caption rounded-full ${sourceStatusColor(source.status)}`}>
          {sourceStatusLabel(t, source.status)}
        </span>
        {source.relevanceScore != null && (
          <span className="px-2.5 py-1 typo-caption rounded-full bg-primary/15 text-primary tabular-nums">
            {Math.round(source.relevanceScore * 100)}% relevance
          </span>
        )}
        {source.year && (
          <span className="px-2.5 py-1 typo-caption rounded-full bg-foreground/[0.06] text-foreground/85 tabular-nums">
            {source.year}
          </span>
        )}
      </div>

      <h1 className="typo-hero text-foreground leading-tight">
        {source.title}
      </h1>

      {source.authors && (
        <p className="typo-body-lg text-foreground/85">
          {source.authors}
        </p>
      )}

      {source.abstractText && (
        <div className="relative pl-5 border-l-2 border-primary/40">
          <Quote className="absolute -left-3 top-0 w-4 h-4 text-primary/60 bg-background" />
          <p className="typo-body text-foreground leading-relaxed">
            {source.abstractText}
          </p>
        </div>
      )}

      {(source.doi || source.url) && (
        <div className="rounded-card border border-border/40 bg-foreground/[0.02] p-4 space-y-2">
          {source.doi && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 w-10">DOI</span>
              <span className="typo-body text-foreground font-mono">{source.doi}</span>
            </div>
          )}
          {source.url && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 w-10">URL</span>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="typo-body text-primary hover:underline truncate flex items-center gap-1"
              >
                {source.url}
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
        <span className="typo-caption text-foreground/55">
          Added {new Date(source.createdAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-2">
          {source.status === 'pending' && (
            <button
              onClick={onIngest}
              disabled={ingesting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              <Database className="w-3.5 h-3.5" />
              {ingesting ? t.research_lab.ingesting : t.research_lab.ingest_to_kb}
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-status-error/10 text-status-error hover:bg-status-error/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.common.delete}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChronologyThread({
  t, sources, activeId, onSelect,
}: {
  t: Translations;
  sources: ResearchSource[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const visible = sources.slice(0, 12);
  return (
    <aside className="hidden xl:flex w-72 flex-shrink-0 flex-col border-l border-border/40 px-4 py-6 gap-3 overflow-y-auto">
      <p className="text-xs uppercase tracking-[0.2em] text-foreground/55 mb-1">Recent</p>
      {visible.length === 0 && (
        <div className="flex items-center gap-2 typo-caption text-foreground/55">
          <AlertCircle className="w-3.5 h-3.5" />
          No sources match.
        </div>
      )}
      <div className="relative space-y-2">
        {visible.length > 0 && (
          <div aria-hidden className="absolute left-2 top-2 bottom-2 w-px bg-border/50" />
        )}
        {visible.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div key={s.id} className="relative pl-6">
              <span
                className={`absolute left-[5px] top-3 w-2 h-2 rounded-full transition-colors ${
                  isActive ? 'bg-primary ring-2 ring-primary/30' : 'bg-foreground/30'
                }`}
              />
              <button
                onClick={() => onSelect(s.id)}
                className={`w-full text-left rounded-card border p-2.5 transition-colors ${
                  isActive
                    ? 'border-primary/40 bg-primary/[0.06]'
                    : 'border-border/40 bg-foreground/[0.02] hover:border-primary/25 hover:bg-foreground/[0.04]'
                }`}
              >
                <p className="typo-card-label text-foreground line-clamp-2">{s.title}</p>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${sourceStatusColor(s.status)}`}>
                    {sourceStatusLabel(t, s.status)}
                  </span>
                  <span className="typo-caption text-foreground/55 truncate">
                    {sourceTypeLabel(t, s.sourceType)}{s.year ? ` · ${s.year}` : ''}
                  </span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function BackgroundGrid() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="atelier-grid-lit" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="atelier-glow-lit" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.5" />
          <stop offset="100%" stopColor="rgb(var(--color-primary))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#atelier-grid-lit)" className="text-foreground" />
      <rect width="100%" height="100%" fill="url(#atelier-glow-lit)" />
    </svg>
  );
}

function AtelierEmpty({
  t, onAdd, onArxiv,
}: {
  t: Translations;
  onAdd: () => void;
  onArxiv: () => void;
}) {
  return (
    <div className="text-center space-y-4 py-12">
      <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
        <BookOpen className="w-6 h-6 text-primary" />
      </div>
      <p className="typo-body-lg text-foreground">{t.research_lab.no_sources}</p>
      <p className="typo-body text-foreground/70 max-w-md mx-auto">{t.research_lab.no_sources_hint}</p>
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={onArxiv}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive typo-caption bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          arXiv
        </button>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t.research_lab.search_sources}
          <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </button>
      </div>
    </div>
  );
}
