import { useRef, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SearchEmptyState } from '../explore/EmptyState';
import { CompactRow } from './CompactRow';
import { ComfortableRow } from './ComfortableRow';
import type { Density } from '../search/filters/DensityToggle';
import type { TemplateModal } from './reviewParseCache';
import type { ModalStackActions } from '../modals/useModalStack';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface TemplateVirtualListProps {
  displayItems: PersonaDesignReview[];
  density: Density;
  expandedRow: string | null;
  searchQuery: string;
  isAiResult: boolean;
  installedConnectorNames: Set<string>;
  credentialServiceTypes: Set<string>;
  modals: ModalStackActions<TemplateModal>;
  onToggleExpand: (id: string, isExpanded: boolean) => void;
  onViewFlows: (review: PersonaDesignReview) => void;
  onDeleteReview: (id: string) => Promise<void>;
  onAddCredential: (name: string, review: PersonaDesignReview) => void;
  rebuildReviewId: string | null;
  rebuildPhase: string;
  onResetRebuild: () => void;
  previewReviewId: string | null;
  previewPhase: string;
  onResetPreview: () => void;
  isFetchingMore: boolean;
  hasMore: boolean;
  isLoading: boolean;
  fetchMore: () => void;
}

export function TemplateVirtualList({
  displayItems,
  density,
  expandedRow,
  searchQuery,
  isAiResult,
  installedConnectorNames,
  credentialServiceTypes,
  modals,
  onToggleExpand,
  onViewFlows,
  onDeleteReview,
  onAddCredential,
  rebuildReviewId,
  rebuildPhase,
  onResetRebuild,
  previewReviewId,
  previewPhase,
  onResetPreview,
  isFetchingMore,
  hasMore,
  isLoading,
  fetchMore,
}: TemplateVirtualListProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const estimateRowSize = density === 'compact' ? 40 : 72;

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimateRowSize,
    overscan: 10,
    getItemKey: (index) => displayItems[index]?.id ?? index,
  });

  useEffect(() => { virtualizer.measure(); }, [density, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (lastVisibleIndex < 0) return;
    if (lastVisibleIndex >= displayItems.length - 10 && hasMore && !isFetchingMore && !isLoading) {
      fetchMore();
    }
  }, [lastVisibleIndex, displayItems.length, hasMore, isFetchingMore, isLoading, fetchMore]);

  if (displayItems.length === 0) {
    return <SearchEmptyState />;
  }

  return (
    <>
      {/* Sticky header */}
      <div className="flex items-center border-b border-primary/10 bg-secondary/80 flex-shrink-0" style={{ backgroundColor: 'hsl(var(--background))' }}>
        {density === 'comfortable' && <div className="w-14 px-6 py-3" />}
        <div className="flex-1 text-left typo-body font-medium text-foreground px-4 py-2">{t.templates.list.template_name}</div>
        <div className={`typo-body font-medium text-foreground px-4 py-2 flex-shrink-0 ${density === 'compact' ? 'w-32 text-center' : 'w-auto text-right'}`}>
          {t.templates.list.components}
        </div>
        {density === 'comfortable' && (
          <div className="w-28 text-center typo-body font-medium text-foreground px-4 py-2">{t.templates.list.adoptions}</div>
        )}
        {density === 'comfortable' && <div className="w-12 px-3 py-2" />}
      </div>

      {/* Scrollable virtual list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {virtualItems.map((virtualRow) => {
            const review = displayItems[virtualRow.index];
            if (!review) return null;
            const isExpanded = density === 'comfortable' && expandedRow === review.id;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
              >
                {density === 'compact' ? (
                  <CompactRow
                    review={review}
                    searchQuery={searchQuery}
                    isAiResult={isAiResult}
                    modals={modals}
                    credentialServiceTypes={credentialServiceTypes}
                  />
                ) : (
                  <ComfortableRow
                    review={review}
                    isExpanded={isExpanded}
                    searchQuery={searchQuery}
                    isAiResult={isAiResult}
                    installedConnectorNames={installedConnectorNames}
                    credentialServiceTypes={credentialServiceTypes}
                    modals={modals}
                    onToggleExpand={(id) => onToggleExpand(id, isExpanded)}
                    onViewFlows={onViewFlows}
                    onDeleteReview={onDeleteReview}
                    onAddCredential={onAddCredential}
                    rebuildReviewId={rebuildReviewId}
                    rebuildPhase={rebuildPhase}
                    onResetRebuild={onResetRebuild}
                    previewReviewId={previewReviewId}
                    previewPhase={previewPhase}
                    onResetPreview={onResetPreview}
                  />
                )}
              </div>
            );
          })}
        </div>

        {isFetchingMore && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-primary/20 border-t-primary/60 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </>
  );
}
