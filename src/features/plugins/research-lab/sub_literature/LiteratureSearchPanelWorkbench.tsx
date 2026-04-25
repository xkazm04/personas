/**
 * LiteratureSearchPanelWorkbench — wildcard variant.
 *
 * Mental model: a researcher's physical workbench with index cards spread on
 * a corkboard. Each source becomes a 5×3 ratio card with title, authors,
 * year-stamped corner, source-type ribbon, and a status edge tint. Cards
 * are slightly skewed for tactile feel; clicking opens the abstract panel.
 *
 * Filter row at top (source type chips + search) sits above the corkboard.
 */
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen, Plus, ExternalLink, Database, Trash2, Search, X,
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

const TYPE_GLYPH: Record<SourceType, string> = {
  arxiv: 'arXiv',
  scholar: 'GS',
  pubmed: 'PM',
  web: 'WEB',
  pdf: 'PDF',
  manual: '✎',
};

export default function LiteratureSearchPanelWorkbench() {
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
  const [query, setQuery] = useState('');
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState<string | null>(null);

  useEffect(() => {
    if (activeProjectId) fetchSources(activeProjectId);
  }, [activeProjectId, fetchSources]);

  const filtered = useMemo(() => {
    let list = sources;
    if (typeFilter) list = list.filter((s) => s.sourceType === typeFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.authors ?? '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [sources, typeFilter, query]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sources.forEach((s) => counts.set(s.sourceType, (counts.get(s.sourceType) ?? 0) + 1));
    return counts;
  }, [sources]);

  const openCard = openCardId ? sources.find((s) => s.id === openCardId) ?? null : null;

  const handleIngest = async (id: string) => {
    setIngesting(id);
    try {
      await updateSourceStatus(id, 'ingesting');
      await updateSourceStatus(id, 'indexed');
      addToast(t.research_lab.source_indexed, 'success');
    } catch (err) {
      await updateSourceStatus(id, 'failed').catch(() => {});
      toastCatch('LiteratureWorkbench:ingest')(err);
    } finally {
      setIngesting(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSource(id);
      if (openCardId === id) setOpenCardId(null);
    } catch (err) {
      toastCatch('LiteratureWorkbench:delete')(err);
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
      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015] px-6 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-card bg-primary/15 border border-primary/20 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="typo-section-title text-foreground">{t.research_lab.literature}</span>
              <span className="text-xs uppercase tracking-[0.2em] text-foreground/60">
                Workbench · {filtered.length} of {sources.length}
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter cards…"
                className="pl-8 pr-3 py-1.5 rounded-input bg-secondary/50 border border-border/30 text-foreground typo-caption placeholder:text-foreground/40 focus:outline-none focus:border-primary/40 w-44"
              />
            </div>
            <button
              onClick={() => setShowArxiv(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              arXiv
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </div>

        {/* Type chips */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <TypeChip
            label="All"
            count={sources.length}
            active={typeFilter === null}
            onClick={() => setTypeFilter(null)}
          />
          {SOURCE_TYPES.map((type) => {
            const c = typeCounts.get(type) ?? 0;
            if (c === 0) return null;
            return (
              <TypeChip
                key={type}
                label={sourceTypeLabel(t, type)}
                count={c}
                active={typeFilter === type}
                onClick={() => setTypeFilter((cur) => (cur === type ? null : type))}
              />
            );
          })}
        </div>
      </div>

      {/* Corkboard */}
      <div className="relative flex-1 min-h-0 overflow-auto">
        <CorkboardBackground />
        <div className="relative px-6 py-8">
          {filtered.length === 0 ? (
            <WorkbenchEmpty
              t={t}
              hasFilter={!!typeFilter || !!query.trim()}
              onAdd={() => setShowAdd(true)}
              onArxiv={() => setShowArxiv(true)}
              onClearFilters={() => { setTypeFilter(null); setQuery(''); }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filtered.map((source, i) => (
                <IndexCard
                  key={source.id}
                  source={source}
                  t={t}
                  index={i}
                  onClick={() => setOpenCardId(source.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reading drawer (opens when card clicked) */}
      {openCard && (
        <ReadingDrawer
          source={openCard}
          t={t}
          ingesting={ingesting === openCard.id}
          onClose={() => setOpenCardId(null)}
          onIngest={() => handleIngest(openCard.id)}
          onDelete={() => handleDelete(openCard.id)}
        />
      )}

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

function TypeChip({
  label, count, active, onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full typo-caption transition-colors ${
        active
          ? 'bg-primary/20 text-primary'
          : 'bg-foreground/[0.04] text-foreground/70 hover:bg-foreground/[0.08]'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function IndexCard({
  source, t, index, onClick,
}: {
  source: ResearchSource;
  t: Translations;
  index: number;
  onClick: () => void;
}) {
  // Slight pseudo-random skew based on id hash for tactile variation.
  const skew = useMemo(() => {
    let h = 0;
    for (let i = 0; i < source.id.length; i++) h = (h << 5) - h + source.id.charCodeAt(i);
    return ((h % 7) - 3) * 0.25; // -0.75deg .. +0.75deg
  }, [source.id]);

  const statusCls = sourceStatusColor(source.status);
  const statusText = statusCls.split(' ').find((c) => c.startsWith('text-')) ?? 'text-primary';

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 12) * 0.018, ease: 'easeOut' }}
      style={{ transform: `rotate(${skew}deg)`, aspectRatio: '5 / 3' }}
      className="relative w-full text-left rounded-card bg-[rgb(252,250,244)] hover:rotate-0 hover:scale-[1.02] hover:shadow-elevation-3 shadow-elevation-1 transition-all duration-200 group overflow-hidden border border-black/5"
    >
      {/* Top edge — status colour band */}
      <span className={`absolute top-0 left-0 right-0 h-1 ${statusText}`} style={{ backgroundColor: 'currentColor' }} />

      {/* Year stamp top-right */}
      {source.year != null && (
        <span
          className="absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-mono tracking-wider rounded-sm border border-black/15 text-black/50"
          style={{ transform: 'rotate(2deg)' }}
        >
          {source.year}
        </span>
      )}

      <div className="absolute inset-0 p-4 flex flex-col">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="px-1.5 py-0.5 text-[9px] font-mono tracking-wider rounded-sm bg-black/[0.04] text-black/65">
            {TYPE_GLYPH[source.sourceType as SourceType] ?? source.sourceType}
          </span>
          {source.relevanceScore != null && (
            <span className="text-[9px] font-mono tracking-wider text-black/45 tabular-nums">
              R{Math.round(source.relevanceScore * 100)}
            </span>
          )}
        </div>
        <p className="text-sm leading-snug font-medium text-black/85 line-clamp-3 mb-2">
          {source.title}
        </p>
        {source.authors && (
          <p className="text-[11px] italic text-black/55 line-clamp-1 mb-auto">
            {source.authors}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-black/[0.06]">
          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${statusCls}`}>
            {sourceStatusLabel(t, source.status)}
          </span>
          {source.doi && (
            <span className="text-[9px] font-mono text-black/40 truncate">
              {source.doi}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function CorkboardBackground() {
  // Subtle warm linen weave + pinhole speckles via SVG patterns.
  return (
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundColor: 'rgb(28 22 16 / 0.55)',
        backgroundImage: `
          radial-gradient(circle at 12% 22%, rgba(255,255,255,0.025) 1px, transparent 2px),
          radial-gradient(circle at 78% 64%, rgba(255,255,255,0.02) 1px, transparent 2px),
          radial-gradient(circle at 35% 80%, rgba(255,255,255,0.022) 1px, transparent 2px),
          repeating-linear-gradient(45deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 4px),
          repeating-linear-gradient(-45deg, rgba(0,0,0,0.05) 0 1px, transparent 1px 4px)
        `,
        mixBlendMode: 'multiply',
      }}
    />
  );
}

function ReadingDrawer({
  source, t, ingesting, onClose, onIngest, onDelete,
}: {
  source: ResearchSource;
  t: Translations;
  ingesting: boolean;
  onClose: () => void;
  onIngest: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="absolute bottom-0 left-0 right-0 max-h-[60vh] bg-background border-t border-border shadow-elevation-4 overflow-y-auto z-10"
    >
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 typo-caption uppercase tracking-wide rounded-full bg-foreground/[0.06] text-foreground/85">
              {sourceTypeLabel(t, source.sourceType)}
            </span>
            <span className={`px-2 py-0.5 typo-caption rounded-full ${sourceStatusColor(source.status)}`}>
              {sourceStatusLabel(t, source.status)}
            </span>
            {source.year && (
              <span className="px-2 py-0.5 typo-caption rounded-full bg-foreground/[0.06] text-foreground/85 tabular-nums">
                {source.year}
              </span>
            )}
            {source.relevanceScore != null && (
              <span className="px-2 py-0.5 typo-caption rounded-full bg-primary/15 text-primary tabular-nums">
                {Math.round(source.relevanceScore * 100)}% relevance
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-interactive hover:bg-foreground/[0.06] text-foreground/65 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <h2 className="typo-section-title text-foreground leading-tight mb-2">{source.title}</h2>
        {source.authors && (
          <p className="typo-body text-foreground/75 mb-4">{source.authors}</p>
        )}
        {source.abstractText && (
          <p className="typo-body text-foreground/85 leading-relaxed mb-4">
            {source.abstractText}
          </p>
        )}
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 typo-caption text-primary hover:underline mb-4"
          >
            {source.url}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
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
    </motion.div>
  );
}

function WorkbenchEmpty({
  t, hasFilter, onAdd, onArxiv, onClearFilters,
}: {
  t: Translations;
  hasFilter: boolean;
  onAdd: () => void;
  onArxiv: () => void;
  onClearFilters: () => void;
}) {
  if (hasFilter) {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="typo-body-lg text-foreground">{t.research_lab.no_matching_sources}</p>
        <button
          onClick={onClearFilters}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption bg-foreground/[0.06] text-foreground/85 hover:bg-foreground/[0.1] transition-colors"
        >
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <div className="text-center py-16 space-y-4">
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
          Add source
        </button>
      </div>
    </div>
  );
}
