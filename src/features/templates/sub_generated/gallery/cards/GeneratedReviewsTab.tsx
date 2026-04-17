import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
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
import { ExploreView } from '../explore/ExploreView';
import { ExploreVariantA } from '../explore/ExploreVariantA';
import { ExploreVariantB } from '../explore/ExploreVariantB';
import { useAdoptionCompletionNotifier } from './useAdoptionCompletionNotifier';
import { TemplateModals } from '../modals/TemplateModals';
import { TemplateVirtualList } from './TemplateVirtualList';
import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { useGalleryActions } from './useGalleryActions';
import { getCachedLightFields, getCachedDesignResult } from './reviewParseCache';
import type { ViewMode, TemplateModal } from './reviewParseCache';
import type { Density } from '../search/filters/DensityToggle';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

export type { ViewMode };

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
  const { t } = useTranslation();
  const templateAdoptActive = useSystemStore((s) => s.templateAdoptActive);
  const adoptionDraft = useSystemStore((s) => s.adoptionDraft);
  const setAdoptionDraft = useSystemStore((s) => s.setAdoptionDraft);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [density, setDensityRaw] = useState<Density>('comfortable');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [exploreVariant, setExploreVariant] = useState<'classic' | 'role' | 'need'>('role');

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

  const actions = useGalleryActions(
    gallery.allItems, gallery.total, gallery.sortBy,
    credentials, connectorDefinitions, gallery.refresh,
    gallery.unfilteredTotal, gallery.coverageFilter, componentFilter,
    difficultyFilter, setupFilter,
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
    } catch { /* intentional: non-critical */ }
  };

  const handleResumeDraft = (draft: import('@/stores/slices/system/uiSlice').AdoptionDraft) => {
    const match = gallery.allItems.find((r: PersonaDesignReview) => r.id === draft.reviewId);
    if (match) { modals.open({ type: 'adopt', review: match }); }
    else { logger.warn('Review not found for resume draft', { reviewId: draft.reviewId }); setAdoptionDraft(null); }
  };

  if (gallery.isLoading && gallery.allItems.length === 0 && gallery.total === 0) {
    return null;
  }

  if (gallery.total === 0 && !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0 && gallery.coverageFilter === 'all' && !gallery.aiSearchActive) {
    return <EmptyState />;
  }

  const noActiveFilters = !gallery.search && gallery.connectorFilter.length === 0 && gallery.categoryFilter.length === 0;
  const showTrending = gallery.trendingTemplates.length > 0 && noActiveFilters;

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
        onDifficultyFilterChange={setDifficultyFilter}
        onSetupFilterChange={setSetupFilter}
      />

      {viewMode === 'list' && showTrending && (
        <TrendingCarousel
          trendingTemplates={gallery.trendingTemplates}
          onSelectTemplate={(t) => {
            setExpandedRow(t.id);
            modals.open({ type: 'detail', review: t });
          }}
        />
      )}

      {viewMode === 'explore' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Explore variant picker */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-primary/10 flex-shrink-0">
            {([['role', t.templates.explore.by_role], ['need', t.templates.explore.by_need], ['classic', t.templates.explore.classic]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setExploreVariant(id)}
                className={`px-3 py-1.5 text-sm rounded-card transition-colors ${
                  exploreVariant === id ? 'bg-primary/10 text-foreground font-medium' : 'text-foreground hover:text-foreground/80 hover:bg-secondary/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <ErrorBoundary name={`Explore ${exploreVariant}`}>
          {exploreVariant === 'role' ? (
            <ExploreVariantA
              availableCategories={gallery.availableCategories}
              allItems={gallery.allItems}
              readyTemplates={gallery.readyTemplates}
              userServiceTypes={credentialServiceTypesArray}
              onSelectCategory={(cat) => { gallery.setCategoryFilter([cat]); setViewMode('list'); }}
              onSelectTemplate={(t) => modals.open({ type: 'detail', review: t })}
            />
          ) : exploreVariant === 'need' ? (
            <ExploreVariantB
              availableCategories={gallery.availableCategories}
              allItems={gallery.allItems}
              readyTemplates={gallery.readyTemplates}
              userServiceTypes={credentialServiceTypesArray}
              onSelectCategory={(cat) => { gallery.setCategoryFilter([cat]); setViewMode('list'); }}
              onSelectTemplate={(t) => modals.open({ type: 'detail', review: t })}
              onSearchFocus={() => setViewMode('list')}
            />
          ) : (
            <ExploreView
              availableCategories={gallery.availableCategories}
              allItems={gallery.allItems}
              readyTemplates={gallery.readyTemplates}
              userServiceTypes={credentialServiceTypesArray}
              onSelectCategory={(cat) => { gallery.setCategoryFilter([cat]); setViewMode('list'); }}
              onSelectTemplate={(t) => modals.open({ type: 'detail', review: t })}
            />
          )}
          </ErrorBoundary>
        </div>
      ) : (
      <div className="flex-1 flex flex-col overflow-hidden">
        <TemplateVirtualList
          displayItems={actions.displayItems}
          density={density}
          expandedRow={expandedRow}
          searchQuery={gallery.search.trim()}
          isAiResult={gallery.aiSearchActive}
          installedConnectorNames={actions.installedConnectorNames}
          credentialServiceTypes={actions.credentialServiceTypes}
          modals={modals}
          onToggleExpand={(id, isExpanded) => setExpandedRow(isExpanded ? null : id)}
          onViewFlows={onViewFlows}
          onDeleteReview={actions.handleDeleteReview}
          onAddCredential={actions.handleAddCredential}
          rebuildReviewId={rebuild.reviewId}
          rebuildPhase={rebuild.phase}
          onResetRebuild={() => rebuild.resetRebuild()}
          previewReviewId={preview.reviewId}
          previewPhase={preview.phase}
          onResetPreview={() => preview.resetPreview()}
          isFetchingMore={gallery.isFetchingMore}
          hasMore={gallery.hasMore}
          isLoading={gallery.isLoading}
          fetchMore={gallery.fetchMore}
        />
      </div>
      )}

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
