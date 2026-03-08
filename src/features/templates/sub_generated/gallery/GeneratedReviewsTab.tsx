import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getConnectorMeta } from '@/features/shared/components/ConnectorMeta';
import { usePersonaStore } from '@/stores/personaStore';
import { useTemplateGallery } from '@/hooks/design/useTemplateGallery';
import { deleteDesignReview, cleanupDuplicateReviews, backfillServiceFlow, backfillRelatedTools } from '@/api/reviews';
import { deriveConnectorReadiness } from '../shared/ConnectorReadiness';
import { computeAdoptionReadiness, readinessTier } from '../shared/adoptionReadiness';
import { TemplateSearchBar } from './TemplateSearchBar';
import { TemplateDetailModal } from './TemplateDetailModal';
import { ADOPT_CONTEXT_KEY } from '../adoption/useAdoptReducer';
import AdoptionWizardModal from '../adoption/AdoptionWizardModal';
import { RebuildModal } from './RebuildModal';
import { useBackgroundRebuild } from '@/hooks/design/useBackgroundRebuild';
import { useBackgroundPreview } from '@/hooks/design/useBackgroundPreview';
import { TemplatePreviewModal } from './TemplatePreviewModal';
import { useModalStack } from './useModalStack';
import { ConnectorCredentialModal } from '@/features/vault/sub_forms/ConnectorCredentialModal';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { highlightMatch } from '@/lib/ui/highlightMatch';
import { getCategoryMeta } from './searchConstants';
import type { Density } from './DensityToggle';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, SuggestedConnector } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

import { RowActionMenu } from './RowActionMenu';
import { deriveArchCategories, userHasCategoryCredential } from './architecturalCategories';
import { CatalogCredentialModal } from './CatalogCredentialModal';
import { ExpandedRowContent } from './ExpandedRowContent';
import { BackgroundBanners } from './BackgroundBanners';
import { TrendingCarousel } from './TrendingCarousel';
import { RecommendedModal } from './RecommendedModal';
import { EmptyState } from './EmptyState';
import { ExploreView } from './ExploreView';

export type ViewMode = 'list' | 'explore';

// ============================================================================
// Main Component
// ============================================================================

type TemplateModal =
  | { type: 'adopt'; review: PersonaDesignReview }
  | { type: 'detail'; review: PersonaDesignReview }
  | { type: 'rebuild'; review: PersonaDesignReview }
  | { type: 'preview'; review: PersonaDesignReview }
  | { type: 'recommended' };

interface Props {
  credentials?: CredentialMetadata[];
  connectorDefinitions?: ConnectorDefinition[];
  onPersonaCreated?: () => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onTotalChange?: (total: number) => void;
}

export default function GeneratedReviewsTab({
  credentials = [],
  connectorDefinitions = [],
  onPersonaCreated,
  onViewFlows,
  onTotalChange,
}: Props) {
  const templateAdoptActive = usePersonaStore((s) => s.templateAdoptActive);
  const adoptionDraft = usePersonaStore((s) => s.adoptionDraft);
  const setAdoptionDraft = usePersonaStore((s) => s.setAdoptionDraft);
  const credentialServiceTypesArray = useMemo(
    () => credentials.map((c) => c.service_type),
    [credentials],
  );
  const gallery = useTemplateGallery(credentialServiceTypesArray);

  // Report total count to parent
  useEffect(() => {
    onTotalChange?.(gallery.total);
  }, [gallery.total, onTotalChange]);

  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [density, setDensity] = useState<Density>('comfortable');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const modals = useModalStack<TemplateModal>();
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isBackfillingPipeline, setIsBackfillingPipeline] = useState(false);
  const [isBackfillingTools, setIsBackfillingTools] = useState(false);

  // Background rebuild state
  const rebuild = useBackgroundRebuild(() => gallery.refresh());

  // Background preview state
  const preview = useBackgroundPreview();

  const installedConnectorNames = useMemo(
    () => new Set(connectorDefinitions.map((c) => c.name)),
    [connectorDefinitions],
  );
  const credentialServiceTypes = useMemo(
    () => new Set(credentials.map((c) => c.service_type)),
    [credentials],
  );

  // ── Readiness scoring & sorting ──────────────────────────────────
  const isReadinessSort = gallery.sortBy === 'readiness';

  /** Readiness score cache for current items — always computed. */
  const readinessScores = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of gallery.allItems) {
      map.set(item.id, computeAdoptionReadiness(item, installedConnectorNames, credentialServiceTypes));
    }
    return map;
  }, [gallery.allItems, installedConnectorNames, credentialServiceTypes]);

  /** Coverage counts for filter badges */
  const coverageCounts = useMemo(() => {
    let ready = 0;
    let partial = 0;
    for (const [, score] of readinessScores) {
      if (score === 100) ready++;
      else if (score > 0) partial++;
    }
    return { all: gallery.total, ready, partial };
  }, [readinessScores, gallery.total]);

  /** Items sorted by readiness score (descending), breaking ties by adoption count. */
  const displayItems = useMemo(() => {
    if (!isReadinessSort) return gallery.allItems;
    return [...gallery.allItems].sort((a, b) => {
      const sa = readinessScores.get(a.id) ?? 0;
      const sb = readinessScores.get(b.id) ?? 0;
      if (sb !== sa) return sb - sa;
      return b.adoption_count - a.adoption_count;
    });
  }, [isReadinessSort, gallery.allItems, readinessScores]);

  // -- Connector credential modal state --
  const [credentialModalTarget, setCredentialModalTarget] = useState<{
    connectorName: string;
    suggestedConnector: SuggestedConnector | null;
    connectorDefinition: ConnectorDefinition | null;
  } | null>(null);

  const handleConnectorCredentialClick = useCallback(
    (connectorName: string, suggestedConnector: SuggestedConnector | null, connDef: ConnectorDefinition | null) => {
      setCredentialModalTarget({ connectorName, suggestedConnector, connectorDefinition: connDef });
    },
    [],
  );

  const handleCredentialSave = useCallback(
    async (values: Record<string, string>) => {
      if (!credentialModalTarget) return;
      const meta = getConnectorMeta(credentialModalTarget.connectorName);
      await usePersonaStore.getState().createCredential({
        name: `${meta.label} credential`,
        service_type: credentialModalTarget.connectorName,
        data: values,
      });
      setCredentialModalTarget(null);
    },
    [credentialModalTarget],
  );

  const handleDeleteReview = async (id: string) => {
    try {
      await deleteDesignReview(id);
      gallery.refresh();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  const handleCleanupDuplicates = async () => {
    setIsCleaningUp(true);
    try {
      await cleanupDuplicateReviews();
      gallery.refresh();
    } catch (err) {
      console.error('Failed to cleanup duplicates:', err);
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleBackfillPipeline = async () => {
    setIsBackfillingPipeline(true);
    try {
      await backfillServiceFlow();
      gallery.refresh();
    } catch (err) {
      console.error('Failed to backfill service flow:', err);
    } finally {
      setIsBackfillingPipeline(false);
    }
  };

  const handleBackfillTools = async () => {
    setIsBackfillingTools(true);
    try {
      await backfillRelatedTools();
      gallery.refresh();
    } catch (err) {
      console.error('Failed to backfill related tools:', err);
    } finally {
      setIsBackfillingTools(false);
    }
  };

  const handlePersonaCreated = () => {
    modals.close('adopt');
    gallery.refresh();
    onPersonaCreated?.();
  };

  // Re-open the wizard to show background progress
  const handleResumeAdoption = () => {
    try {
      const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { templateName?: string };
        const match = gallery.allItems.find((r) => r.test_case_name === parsed.templateName);
        if (match) {
          modals.open({ type: 'adopt', review: match });
          return;
        }
        console.warn(
          `[ResumeAdoption] Template "${parsed.templateName}" not found in current gallery items. ` +
          'The adoption may still be running in the background.',
        );
      }
    } catch { /* intentional: non-critical — JSON parse fallback */ }
  };

  // Resume from a saved draft — find the review and re-open the modal
  const handleResumeDraft = (draft: import('@/stores/slices/uiSlice').AdoptionDraft) => {
    const match = gallery.allItems.find((r) => r.id === draft.reviewId);
    if (match) {
      modals.open({ type: 'adopt', review: match });
    } else {
      console.warn(`[ResumeDraft] Review "${draft.reviewId}" not found — draft may be stale.`);
      setAdoptionDraft(null);
    }
  };

  const handleDiscardDraft = () => {
    setAdoptionDraft(null);
  };

  // ── Virtual list ────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const estimateRowSize = density === 'compact' ? 40 : 72;

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimateRowSize,
    overscan: 10,
    getItemKey: (index) => displayItems[index]?.id ?? index,
  });

  // Re-measure all rows when density changes
  useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  // Auto-fetch more when scrolling near the bottom
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= displayItems.length - 10 && gallery.hasMore && !gallery.isFetchingMore && !gallery.isLoading) {
      gallery.fetchMore();
    }
  }, [virtualizer.getVirtualItems(), displayItems.length, gallery.hasMore, gallery.isFetchingMore, gallery.isLoading, gallery.fetchMore]);

  // Loading state
  if (gallery.isLoading && gallery.allItems.length === 0 && gallery.total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/80 text-sm">
        Loading templates...
      </div>
    );
  }

  // Empty state
  if (gallery.total === 0 && !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0 && gallery.coverageFilter === 'all' && !gallery.aiSearchActive) {
    return (
      <EmptyState />
    );
  }

  const noActiveFilters = !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0;
  const showTrending = gallery.trendingTemplates.length > 0 && noActiveFilters;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Background banners */}
      <BackgroundBanners
        templateAdoptActive={templateAdoptActive}
        adoptModalOpen={modals.isOpen('adopt')}
        onResumeAdoption={handleResumeAdoption}
        adoptionDraft={adoptionDraft}
        onResumeDraft={handleResumeDraft}
        onDiscardDraft={handleDiscardDraft}
        rebuildIsActive={rebuild.isActive}
        rebuildModalOpen={modals.isOpen('rebuild')}
        rebuildReviewName={rebuild.reviewName ?? null}
        onResumeRebuild={() => {
          const review = gallery.allItems.find((r) => r.id === rebuild.reviewId);
          if (review) modals.open({ type: 'rebuild', review });
        }}
        previewIsActive={preview.isActive}
        previewModalOpen={modals.isOpen('preview')}
        previewReviewName={preview.reviewName ?? null}
        onResumePreview={() => {
          const review = gallery.allItems.find((r) => r.id === preview.reviewId);
          if (review) modals.open({ type: 'preview', review });
        }}
      />

      {/* Search/Filter/Sort Bar */}
      <TemplateSearchBar
        search={gallery.search}
        onSearchChange={gallery.setSearch}
        sortBy={gallery.sortBy}
        onSortByChange={gallery.setSortBy}
        sortDir={gallery.sortDir}
        onSortDirChange={gallery.setSortDir}
        connectorFilter={gallery.connectorFilter}
        onConnectorFilterChange={gallery.setConnectorFilter}
        categoryFilter={gallery.categoryFilter}
        onCategoryFilterChange={gallery.setCategoryFilter}
        availableConnectors={gallery.availableConnectors}
        availableCategories={gallery.availableCategories}
        total={gallery.total}
        loadedCount={gallery.allItems.length}
        onCleanupDuplicates={handleCleanupDuplicates}
        isCleaningUp={isCleaningUp}
        onBackfillPipeline={handleBackfillPipeline}
        isBackfillingPipeline={isBackfillingPipeline}
        onBackfillTools={handleBackfillTools}
        isBackfillingTools={isBackfillingTools}
        coverageFilter={gallery.coverageFilter}
        onCoverageFilterChange={gallery.setCoverageFilter}
        coverageCounts={coverageCounts}
        density={density}
        onDensityChange={setDensity}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        aiSearchMode={gallery.aiSearchMode}
        onAiSearchToggle={() => {
          gallery.setAiSearchMode(!gallery.aiSearchMode);
          if (gallery.aiSearchMode) gallery.clearAiSearch();
        }}
        aiSearchLoading={gallery.aiSearchLoading}
        aiSearchRationale={gallery.aiSearchRationale}
        aiSearchActive={gallery.aiSearchActive}
        onAiSearchSubmit={(q) => gallery.triggerAiSearch(q)}
        aiCliLog={gallery.aiCliLog}
        hasRecommendations={gallery.recommendedTemplates.length > 0}
        onOpenRecommended={() => modals.open({ type: 'recommended' })}
      />

      {/* Trending Carousel (list mode only) */}
      {viewMode === 'list' && showTrending && (
        <TrendingCarousel
          trendingTemplates={gallery.trendingTemplates}
          onSelectTemplate={(t) => {
            setExpandedRow(t.id);
            modals.open({ type: 'detail', review: t });
          }}
        />
      )}

      {/* Content area — explore vs list */}
      {viewMode === 'explore' ? (
        <ExploreView
          availableCategories={gallery.availableCategories}
          allItems={gallery.allItems}
          readyTemplates={gallery.readyTemplates}
          onSelectCategory={(cat) => {
            gallery.setCategoryFilter([cat]);
            setViewMode('list');
          }}
          onSelectTemplate={(t) => modals.open({ type: 'detail', review: t })}
        />
      ) : (
      <div className="flex-1 flex flex-col overflow-hidden">
        {displayItems.length > 0 ? (
          <>
            {/* Sticky header */}
            <div className="flex items-center border-b border-primary/10 bg-secondary/80 flex-shrink-0" style={{ backgroundColor: 'hsl(var(--background))' }}>
              {density === 'comfortable' && <div className="w-14 px-6 py-3" />}
              <div className="flex-1 text-left text-sm font-medium text-muted-foreground/70 px-4 py-2">Template Name</div>
              {density === 'comfortable' && (
                <div className="w-28 text-center text-sm font-medium text-muted-foreground/70 px-4 py-2">Adoptions</div>
              )}
              {density === 'comfortable' && <div className="w-12 px-3 py-2" />}
            </div>

            {/* Scrollable virtual list */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto"
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const review = displayItems[virtualRow.index];
                  if (!review) return null;

                  const isExpanded = density === 'comfortable' && expandedRow === review.id;
                  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
                  const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
                  const flowCount = parseJsonSafe<unknown[]>(review.use_case_flows, []).length;

                  const readinessStatuses = designResult?.suggested_connectors
                    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
                    : [];

                  const allConnectorsReady = connectors.length > 0 && connectors.every((c) => {
                    const status = readinessStatuses.find((s) => s.connector_name === c);
                    return status?.health === 'ready';
                  });

                  const readinessScore = readinessScores.get(review.id) ?? 0;

                  const categoryMeta = review.category ? getCategoryMeta(review.category) : null;
                  const CategoryIcon = categoryMeta?.icon ?? null;
                  const searchQuery = gallery.search.trim();
                  const isAiResult = gallery.aiSearchActive;

                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {density === 'compact' ? (
                        /* ── Compact row ── */
                        <div
                          onClick={() => modals.open({ type: 'detail', review })}
                          className="group flex items-center border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors px-4 py-1.5"
                          data-testid={`template-row-${review.id}`}
                        >
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground/80 truncate">
                              {highlightMatch(review.test_case_name, searchQuery)}
                            </span>
                            {isAiResult && (
                              <span className="px-1.5 py-0.5 text-sm rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
                                <Sparkles className="w-2.5 h-2.5 inline -mt-px mr-0.5" />AI
                              </span>
                            )}
                            {categoryMeta && CategoryIcon && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded-full bg-violet-500/8 border border-violet-500/15 text-muted-foreground/60 flex-shrink-0"
                              >
                                <CategoryIcon className="w-2.5 h-2.5" style={{ color: categoryMeta.color }} />
                                {categoryMeta.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                            <span
                              className={`inline-flex items-center gap-1 text-sm font-mono ${
                                readinessScore === 100
                                  ? 'text-emerald-400/80'
                                  : readinessScore > 0
                                    ? 'text-amber-400/70'
                                    : 'text-muted-foreground/40'
                              }`}
                              title={`${readinessScore}% ready`}
                            >
                              {readinessScore === 100 ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <ShieldCheck className="w-3 h-3" />
                              )}
                              {readinessScore}%
                            </span>
                            {review.adoption_count > 0 && (
                              <span className="inline-flex items-center gap-1 text-sm font-mono text-emerald-400/70">
                                <Download className="w-2.5 h-2.5" />
                                {review.adoption_count}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* ── Comfortable row ── */
                        <>
                          <div
                            onClick={() => setExpandedRow(isExpanded ? null : review.id)}
                            className="group flex items-center border-b border-primary/5 hover:bg-secondary/30 cursor-pointer transition-colors"
                            data-testid={`template-row-${review.id}`}
                          >
                            <div className="w-14 px-6 py-4 flex-shrink-0">
                              {isExpanded ? (
                                <ChevronDown className="w-4.5 h-4.5 text-muted-foreground/80" />
                              ) : (
                                <ChevronRight className="w-4.5 h-4.5 text-muted-foreground/80" />
                              )}
                            </div>
                            <div className="flex-1 px-4 py-4 min-w-0">
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base font-semibold text-foreground/80">
                                      {highlightMatch(review.test_case_name, searchQuery)}
                                    </span>
                                    {isAiResult && (
                                      <span className="px-1.5 py-0.5 text-sm rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 flex-shrink-0">
                                        <Sparkles className="w-2.5 h-2.5 inline -mt-px mr-0.5" />AI
                                      </span>
                                    )}
                                    {review.adoption_count > 0 && (
                                      <span
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/15"
                                        title={`Adopted ${review.adoption_count} time${review.adoption_count !== 1 ? 's' : ''}`}
                                      >
                                        <Download className="w-2.5 h-2.5" />
                                        {review.adoption_count}
                                      </span>
                                    )}
                                    <span
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded border flex-shrink-0 ${readinessTier(readinessScore).bgClass}`}
                                      title={`${readinessScore}% of connectors ready`}
                                    >
                                      {readinessScore === 100 ? (
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                      ) : (
                                        <ShieldCheck className="w-2.5 h-2.5" />
                                      )}
                                      {readinessScore}% ready
                                    </span>
                                    {flowCount > 0 && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onViewFlows(review);
                                        }}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded bg-violet-500/10 text-violet-400/70 border border-violet-500/15 hover:bg-violet-500/20 transition-colors flex-shrink-0"
                                        title="View flows"
                                      >
                                        <Workflow className="w-2.5 h-2.5" />
                                        {flowCount} flow{flowCount !== 1 ? 's' : ''}
                                      </button>
                                    )}
                                  </div>
                                  {/* Second line: instruction */}
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-sm text-muted-foreground/60 truncate flex-1 min-w-0">
                                      {review.instruction.length > 80
                                        ? review.instruction.slice(0, 80) + '...'
                                        : review.instruction}
                                    </span>
                                  </div>
                                </div>
                                {/* Architectural category icons */}
                                {connectors.length > 0 && (
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {deriveArchCategories(connectors).map((cat) => {
                                      const hasIt = userHasCategoryCredential(cat.key, credentialServiceTypes);
                                      const CatIcon = cat.icon;
                                      return (
                                        <div
                                          key={cat.key}
                                          className="relative flex-shrink-0"
                                          title={`${cat.label}${hasIt ? ' (ready)' : ''}`}
                                        >
                                          <div
                                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                              hasIt ? '' : 'grayscale opacity-60'
                                            }`}
                                            style={{ backgroundColor: `${cat.color}18` }}
                                          >
                                            <CatIcon className="w-4 h-4" style={{ color: cat.color }} />
                                          </div>
                                          <span
                                            className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                                              hasIt
                                                ? 'bg-emerald-500'
                                                : 'bg-amber-500/60 border border-dashed border-amber-500/30'
                                            }`}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="w-28 px-4 py-4 flex-shrink-0">
                              <div className="flex justify-center">
                                {review.adoption_count > 0 ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                                    <Download className="w-3.5 h-3.5" />
                                    {review.adoption_count}
                                  </span>
                                ) : (
                                  <span className="text-sm text-muted-foreground/40">--</span>
                                )}
                              </div>
                            </div>
                            <div className="w-12 px-3 py-4 flex-shrink-0">
                              <div className="flex items-center justify-end">
                                <RowActionMenu
                                  reviewId={review.id}
                                  onDelete={handleDeleteReview}
                                  onViewDetails={() => modals.open({ type: 'detail', review })}
                                  onRebuild={() => {
                                    if (rebuild.reviewId !== review.id || rebuild.phase === 'completed' || rebuild.phase === 'failed') {
                                      rebuild.resetRebuild();
                                    }
                                    modals.open({ type: 'rebuild', review });
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          {/* Expanded content — CSS-only fade-in, no framer-motion */}
                          {isExpanded && (
                            <div className="border-b border-primary/10 bg-secondary/20 animate-expand-in">
                              <ExpandedRowContent
                                review={review}
                                designResult={designResult}
                                allConnectorsReady={allConnectorsReady}
                                readinessStatuses={readinessStatuses}
                                credentialServiceTypes={credentialServiceTypes}
                                onAdopt={() => modals.open({ type: 'adopt', review })}
                                onTryIt={() => {
                                  if (preview.reviewId !== review.id || preview.phase === 'completed' || preview.phase === 'failed') {
                                    preview.resetPreview();
                                  }
                                  modals.open({ type: 'preview', review });
                                }}
                                onAddCredential={(name) => {
                                  const sugConn = designResult?.suggested_connectors?.find((sc) => sc.name === name) ?? null;
                                  const connDef = connectorDefinitions.find((d) => d.name === name) ?? null;
                                  handleConnectorCredentialClick(name, sugConn, connDef);
                                }}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Loading more indicator */}
              {gallery.isFetchingMore && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
                  <span className="ml-2 text-sm text-muted-foreground/50">Loading more...</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center flex-1 min-h-[200px] text-sm text-muted-foreground/60 w-full">
            No templates match your search
          </div>
        )}
      </div>
      )}

      {/* Detail Modal */}
      <TemplateDetailModal
        isOpen={modals.isOpen('detail')}
        onClose={() => modals.close('detail')}
        review={modals.find('detail')?.review ?? null}
        onAdopt={(review) => modals.open({ type: 'adopt', review })}
        onDelete={handleDeleteReview}
        onViewFlows={(review) => {
          modals.close('detail');
          onViewFlows(review);
        }}
        onTryIt={(review) => {
          if (preview.reviewId !== review.id || preview.phase === 'completed' || preview.phase === 'failed') {
            preview.resetPreview();
          }
          modals.close('detail');
          modals.open({ type: 'preview', review });
        }}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onAddCredential={handleConnectorCredentialClick}
      />

      {/* Adoption Wizard Modal */}
      <AdoptionWizardModal
        isOpen={modals.isOpen('adopt')}
        onClose={() => modals.close('adopt')}
        review={modals.find('adopt')?.review ?? null}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onPersonaCreated={handlePersonaCreated}
      />

      {/* Rebuild Modal */}
      {modals.isOpen('rebuild') && (
        <RebuildModal
          isOpen
          onClose={() => modals.close('rebuild')}
          review={modals.find('rebuild')!.review}
          phase={rebuild.phase}
          lines={rebuild.lines}
          error={rebuild.error}
          onStartRebuild={(dir) => {
            const r = modals.find('rebuild')!.review;
            rebuild.startRebuild(r.id, r.test_case_name, dir);
          }}
          onCancel={() => rebuild.cancelCurrentRebuild()}
        />
      )}

      {/* Template Preview Modal */}
      <TemplatePreviewModal
        isOpen={modals.isOpen('preview')}
        onClose={() => modals.close('preview')}
        review={modals.find('preview')?.review ?? null}
        phase={preview.phase}
        lines={preview.lines}
        error={preview.error}
        hasStarted={preview.hasStarted}
        onStartPreview={(rId, rName, draftJson) => preview.startPreview(rId, rName, draftJson)}
        onRetryPreview={(draftJson) => preview.retryPreview(draftJson)}
      />

      {/* Recommended Modal */}
      <RecommendedModal
        isOpen={modals.isOpen('recommended')}
        onClose={() => modals.close('recommended')}
        recommendedTemplates={gallery.recommendedTemplates}
        onSelectTemplate={(t) => {
          modals.close('recommended');
          setExpandedRow(t.id);
          modals.open({ type: 'detail', review: t });
        }}
      />

      {/* Connector Credential Modal */}
      {credentialModalTarget && credentialModalTarget.connectorDefinition ? (
        <CatalogCredentialModal
          connectorDefinition={credentialModalTarget.connectorDefinition}
          onSave={handleCredentialSave}
          onClose={() => setCredentialModalTarget(null)}
        />
      ) : credentialModalTarget ? (
        <ConnectorCredentialModal
          connector={
            credentialModalTarget.suggestedConnector ?? {
              name: credentialModalTarget.connectorName,
            }
          }
          connectorDefinition={undefined}
          existingCredential={undefined}
          onSave={handleCredentialSave}
          onClose={() => setCredentialModalTarget(null)}
        />
      ) : null}
    </div>
  );
}
