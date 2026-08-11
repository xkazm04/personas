import { useState, useMemo, useEffect, useCallback } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('template-gallery');
import { useSystemStore } from "@/stores/systemStore";
import { useTemplateGallery } from '@/hooks/design/template/useTemplateGallery';
import { TemplateSearchBar } from '../search/TemplateSearchBar';
/** localStorage key for persisted adoption context (legacy wizard) */
const ADOPT_CONTEXT_KEY = 'template-adopt-context-v1';
import { useBackgroundRebuild } from '@/hooks/design/core/useBackgroundRebuild';
import { useBackgroundPreview } from '@/hooks/design/core/useBackgroundPreview';
import { useModalStack } from '../modals/useModalStack';
import { BackgroundBanners } from '../explore/BackgroundBanners';
import { TrendingCarousel } from '../explore/TrendingCarousel';
import { EmptyState } from '../explore/EmptyState';
import { useAdoptionCompletionNotifier } from './useAdoptionCompletionNotifier';
import { TemplateModals } from '../modals/TemplateModals';
import { TemplateDetailModal } from '../modals/TemplateDetailModal';
import { TemplateVirtualList } from './TemplateVirtualList';
import { useTemplateCompare } from './useTemplateCompare';
import { CompareTray } from './CompareTray';
import { CompareModal } from '../modals/CompareModal';
import { buildComparison } from './buildComparison';
import { useGalleryActions } from './useGalleryActions';
import { getCachedLightFields, getCachedDesignResult } from './reviewParseCache';
import type { TemplateModal } from './reviewParseCache';
import type { Density } from '../search/filters/DensityToggle';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { silentCatch } from '@/lib/silentCatch';


// Re-export for barrel compatibility
export { getCachedLightFields, getCachedDesignResult };

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
  const templateAdoptActive = useSystemStore((s) => s.templateAdoptActive);
  const adoptionDraft = useSystemStore((s) => s.adoptionDraft);
  const setAdoptionDraft = useSystemStore((s) => s.setAdoptionDraft);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [density, setDensityRaw] = useState<Density>('comfortable');
  const compare = useTemplateCompare();
  const [compareOpen, setCompareOpen] = useState(false);

  // Stable refs for the row callbacks. Pairs with React.memo on
  // ComfortableRow so a parent re-render that doesn't touch these deps
  // skips the row subtree. /architect 2026-05-17 list-memo-hygiene.
  const handleToggleExpand = useCallback((id: string, isExpanded: boolean) => {
    setExpandedRow(isExpanded ? null : id);
  }, []);

  const credentialServiceTypesArray = useMemo(
    () => credentials.map((c) => c.service_type),
    [credentials],
  );
  const gallery = useTemplateGallery(credentialServiceTypesArray, density === 'compact' ? 20 : 50);

  useEffect(() => { onTotalChange?.(gallery.total); }, [gallery.total, onTotalChange]);

  // When switching to compact, default to name A-Z sort
  const setDensity = (d: Density) => {
    setDensityRaw(d);
    if (d === 'compact') {
      gallery.setSortBy('name');
      gallery.setSortDir('asc');
    }
  };
  const [componentFilter, setComponentFilter] = useState<string[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<string[]>([]);
  const [setupFilter, setSetupFilter] = useState<string[]>([]);
  const modals = useModalStack<TemplateModal>();

  useAdoptionCompletionNotifier(templateAdoptActive, modals.isOpen('adopt'));

  const rebuild = useBackgroundRebuild(() => gallery.refresh());
  const preview = useBackgroundPreview();

  const handleResetRebuild = useCallback(() => { rebuild.resetRebuild(); }, [rebuild]);
  const handleResetPreview = useCallback(() => { preview.resetPreview(); }, [preview]);

  const actions = useGalleryActions(
    gallery.allItems, gallery.total, gallery.sortBy,
    credentials, connectorDefinitions, gallery.refresh,
    gallery.unfilteredTotal, gallery.coverageFilter, componentFilter,
    difficultyFilter, setupFilter,
  );

  const compareColumns = useMemo(
    () => buildComparison(compare.selected, actions.connectorReadiness),
    [compare.selected, actions.connectorReadiness],
  );

  const handlePersonaCreated = () => {
    modals.close('adopt');
    gallery.refresh();
    onPersonaCreated?.();
  };

  const handleResumeAdoption = () => {
    try {
      const raw = window.localStorage.getItem(ADOPT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { templateName?: string };
        const match = gallery.allItems.find((r: PersonaDesignReview) => r.test_case_name === parsed.templateName);
        if (match) { modals.open({ type: 'adopt', review: match }); return; }
        logger.warn('Template not found for resume adoption', { templateName: parsed.templateName });
      }
    } catch (err) { silentCatch("features/templates/sub_generated/gallery/cards/GeneratedReviewsTab:catch1")(err); }
  };

  const handleResumeDraft = (draft: import('@/stores/slices/system/uiSlice').AdoptionDraft) => {
    const match = gallery.allItems.find((r: PersonaDesignReview) => r.id === draft.reviewId);
    if (match) { modals.open({ type: 'adopt', review: match }); }
    else { logger.warn('Review not found for resume draft', { reviewId: draft.reviewId }); setAdoptionDraft(null); }
  };

  // Loading choreography (docs/design/overview-loading.md, row-level): the
  // rich "nothing in the whole gallery" empty state only fires once the
  // fetch has settled — during a cold fetch we fall through and render the
  // real chrome (search bar, trending frame, list frame) with ghosts inside
  // the still-empty regions instead of blanking the surface.
  if (!gallery.isLoading && gallery.total === 0 && !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0 && gallery.coverageFilter === 'all' && !gallery.aiSearchActive) {
    return <EmptyState />;
  }

  const noActiveFilters = !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0;
  const showTrending = gallery.trendingTemplates.length > 0 && noActiveFilters;
  // Ghost the trending shelf only into its own emptiness — decoupled from
  // the main list's loading state, since trending resolves independently.
  const showTrendingGhost = noActiveFilters && gallery.isLoading && gallery.trendingTemplates.length === 0;

  // A new search/filter/sort context replays the first-viewport row cascade
  // in TemplateVirtualList; a poll/refresh re-delivering the same ids does
  // not (RevealItem's id guard handles that internally).
  const galleryRevealResetKey = [
    gallery.search,
    gallery.connectorFilter.join(','),
    gallery.categoryFilter.join(','),
    gallery.coverageFilter,
    componentFilter.join(','),
    difficultyFilter.join(','),
    setupFilter.join(','),
    gallery.sortBy,
    gallery.sortDir,
    density,
    gallery.aiSearchActive ? 'ai' : 'browse',
  ].join('|');

  return (
    <div className="flex flex-col h-full w-full">
      <BackgroundBanners
        templateAdoptActive={templateAdoptActive}
        adoptModalOpen={modals.isOpen('adopt')}
        onResumeAdoption={handleResumeAdoption}
        adoptionDraft={adoptionDraft}
        onResumeDraft={handleResumeDraft}
        onDiscardDraft={() => setAdoptionDraft(null)}
        rebuildIsActive={rebuild.isActive}
        rebuildModalOpen={modals.isOpen('rebuild')}
        rebuildReviewName={rebuild.reviewName ?? null}
        onResumeRebuild={() => {
          const review = gallery.allItems.find((r: PersonaDesignReview) => r.id === rebuild.reviewId);
          if (review) modals.open({ type: 'rebuild', review });
        }}
        previewIsActive={preview.isActive}
        previewPhase={preview.phase}
        previewModalOpen={modals.isOpen('preview')}
        previewReviewName={preview.reviewName ?? null}
        onResumePreview={() => {
          const review = gallery.allItems.find((r: PersonaDesignReview) => r.id === preview.reviewId);
          if (review) modals.open({ type: 'preview', review });
        }}
        onDismissPreview={() => preview.resetPreview()}
      />

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
        onCleanupDuplicates={actions.handleCleanupDuplicates}
        isCleaningUp={actions.isCleaningUp}
        onBackfillPipeline={actions.handleBackfillPipeline}
        isBackfillingPipeline={actions.isBackfillingPipeline}
        onBackfillTools={actions.handleBackfillTools}
        isBackfillingTools={actions.isBackfillingTools}
        coverageFilter={gallery.coverageFilter}
        onCoverageFilterChange={gallery.setCoverageFilter}
        coverageCounts={actions.coverageCounts}
        componentFilter={componentFilter}
        onComponentFilterChange={setComponentFilter}
        availableComponents={actions.availableComponents}
        density={density}
        onDensityChange={setDensity}
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
        onDifficultyFilterChange={setDifficultyFilter}
        onSetupFilterChange={setSetupFilter}
      />

      {showTrendingGhost ? (
        <TrendingCarouselGhost />
      ) : showTrending ? (
        <TrendingCarousel
          trendingTemplates={gallery.trendingTemplates}
          onSelectTemplate={(t) => {
            setExpandedRow(t.id);
            modals.open({ type: 'detail', review: t });
          }}
          onAdoptTemplate={(t) => modals.open({ type: 'adopt', review: t })}
        />
      ) : null}

      <div className="relative flex-1 flex flex-col overflow-hidden">
        <TemplateVirtualList
          displayItems={actions.displayItems}
          density={density}
          expandedRow={expandedRow}
          searchQuery={gallery.search.trim()}
          isAiResult={gallery.aiSearchActive}
          credentialServiceTypes={actions.credentialServiceTypes}
          connectorReadiness={actions.connectorReadiness}
          modals={modals}
          onToggleExpand={handleToggleExpand}
          onViewFlows={onViewFlows}
          onDeleteReview={actions.handleDeleteReview}
          onAddCredential={actions.handleAddCredential}
          rebuildReviewId={rebuild.reviewId}
          rebuildPhase={rebuild.phase}
          onResetRebuild={handleResetRebuild}
          previewReviewId={preview.reviewId}
          previewPhase={preview.phase}
          onResetPreview={handleResetPreview}
          isFetchingMore={gallery.isFetchingMore}
          hasMore={gallery.hasMore}
          isLoading={gallery.isLoading}
          fetchMore={gallery.fetchMore}
          compareSelectedIds={compare.selectedIds}
          compareAtCapacity={!compare.canAdd}
          onToggleCompare={compare.toggle}
          revealResetKey={galleryRevealResetKey}
        />

        <CompareTray
          selected={compare.selected}
          onRemove={compare.remove}
          onClear={compare.clear}
          onCompare={() => setCompareOpen(true)}
        />

        {/* Detail modal — rendered here so `absolute inset-0` scopes it to the table area */}
        <TemplateDetailModal
          isOpen={modals.isOpen('detail')}
          onClose={() => modals.close('detail')}
          review={modals.find('detail')?.review ?? null}
          onAdopt={(review) => modals.open({ type: 'adopt', review })}
          onDelete={actions.handleDeleteReview}
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
        />

        <CompareModal
          isOpen={compareOpen}
          onClose={() => setCompareOpen(false)}
          columns={compareColumns}
          onAdopt={(id) => {
            const review = compare.selected.find((r) => r.id === id);
            if (!review) return;
            setCompareOpen(false);
            modals.open({ type: 'adopt', review });
          }}
          onTryIt={(id) => {
            const review = compare.selected.find((r) => r.id === id);
            if (!review) return;
            if (preview.reviewId !== review.id || preview.phase === 'completed' || preview.phase === 'failed') {
              preview.resetPreview();
            }
            setCompareOpen(false);
            modals.open({ type: 'preview', review });
          }}
        />
      </div>

      <TemplateModals
        modals={modals}
        credentials={credentials}
        connectorDefinitions={connectorDefinitions}
        onDeleteReview={actions.handleDeleteReview}
        onPersonaCreated={handlePersonaCreated}
        onViewFlows={onViewFlows}
        rebuild={rebuild}
        preview={preview}
        recommendedTemplates={gallery.recommendedTemplates}
        setExpandedRow={setExpandedRow}
        credentialModalTarget={actions.credentialModalTarget}
        onCredentialSave={actions.handleCredentialSave}
        onCredentialModalClose={actions.clearCredentialModal}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrendingCarouselGhost — calm placeholder for the trending shelf's own cold
// fetch (decoupled from the main list's loading state). Mirrors the real
// shelf's frame (`px-4 py-3 border-b`) and card geometry (`w-[200px] p-3`) so
// the swap to real cards moves nothing. Delayed entrance per the shared
// ghost convention — invisible for its first ~120ms so a fast fetch never
// paints one. No `animate-pulse`.
// ---------------------------------------------------------------------------

function TrendingCarouselGhost() {
  return (
    <div className="px-4 py-3 border-b border-primary/10 flex-shrink-0" aria-hidden="true">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-4 h-4 rounded bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '120ms' }} />
        <span className="h-3 w-24 rounded bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '120ms' }} />
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="w-[200px] p-3 rounded-modal bg-primary/[0.03] border border-primary/10 flex-shrink-0 animate-fade-in"
            style={{ animationDelay: `${140 + i * 35}ms` }}
          >
            <span className="block h-3.5 w-3/4 rounded bg-primary/[0.06]" />
            <div className="flex items-center gap-2 mt-2">
              <span className="h-2.5 w-10 rounded bg-primary/[0.06]" />
              <span className="h-5 w-5 rounded-full bg-primary/[0.06]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
