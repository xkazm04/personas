import { useRef, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollRestoration } from '@/hooks/utility/interaction/useScrollRestoration';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { SearchEmptyState } from '../explore/EmptyState';
import { CompactRow } from './CompactRow';
import { ComfortableRow } from './ComfortableRow';
import type { Density } from '../search/filters/DensityToggle';
import type { TemplateModal } from './reviewParseCache';
import type { ModalStackActions } from '../modals/useModalStack';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { ConnectorReadinessMap } from '../../shared/useConnectorReadiness';

/**
 * Rows in the first viewport that play the one-shot entrance cascade when a
 * fresh result set lands (35ms stagger via RevealItem, id-guarded so
 * polling/refresh/scrolling never replay it). Rows beyond this render
 * plainly, and so does anything appended via `fetchMore` past this cap.
 */
const CASCADE_ROWS = 14;

interface TemplateVirtualListProps {
  displayItems: PersonaDesignReview[];
  density: Density;
  expandedRow: string | null;
  searchQuery: string;
  isAiResult: boolean;
  credentialServiceTypes: Set<string>;
  /** Authoritative per-connector verdicts, resolved once for the whole gallery. */
  connectorReadiness: ConnectorReadinessMap;
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
  compareSelectedIds: Set<string>;
  compareAtCapacity: boolean;
  onToggleCompare: (review: PersonaDesignReview) => void;
  /** Search/filter context — replays the first-viewport cascade when it changes; a poll/refresh that re-delivers the same ids does not. */
  revealResetKey: string;
}

export function TemplateVirtualList({
  displayItems,
  density,
  expandedRow,
  searchQuery,
  isAiResult,
  credentialServiceTypes,
  connectorReadiness,
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
  compareSelectedIds,
  compareAtCapacity,
  onToggleCompare,
  revealResetKey,
}: TemplateVirtualListProps) {
  const { t } = useTranslation();
  const enter = useRevealTracker(revealResetKey);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Remember the gallery scroll offset across route/tab switches; AI-search
  // results are a distinct context from the browse list, so they start at top.
  const setScrollContainerRef = useScrollRestoration(
    `templates/gallery|ai=${isAiResult ? '1' : '0'}`,
    scrollContainerRef,
  );
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

  // Sticky header — static chrome. Renders identically above ghost rows,
  // the settled-empty state, and real rows so no swap ever moves it.
  const header = (
    <div className="flex items-center border-b border-primary/10 bg-secondary/80 flex-shrink-0" style={{ backgroundColor: 'hsl(var(--background))' }}>
      {density === 'comfortable' && <div className="w-20 px-4 py-3" />}
      <div className="flex-1 text-left typo-body font-medium text-foreground px-4 py-2">{t.templates.list.template_name}</div>
      <div className={`typo-body font-medium text-foreground px-4 py-2 flex-shrink-0 ${density === 'compact' ? 'w-32 text-center' : 'w-auto text-right'}`}>
        {t.templates.list.components}
      </div>
      {density === 'comfortable' && (
        <div className="w-28 text-center typo-body font-medium text-foreground px-4 py-2">{t.templates.list.adoptions}</div>
      )}
      {density === 'comfortable' && <div className="w-12 px-3 py-2" />}
    </div>
  );

  if (displayItems.length === 0) {
    // Nothing to show. While a fetch is in flight this is cold emptiness —
    // ghost rows under the real header (delayed ≥120ms so a fast fetch never
    // paints one). Once settled with genuinely nothing, the real empty state.
    return (
      <>
        {header}
        {isLoading ? <GalleryGhostRows density={density} /> : <SearchEmptyState />}
      </>
    );
  }

  return (
    <>
      {header}

      {/* Scrollable virtual list */}
      <div
        ref={setScrollContainerRef}
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
                <RevealItem
                  revealId={review.id}
                  order={virtualRow.index}
                  hasEntered={(id) => virtualRow.index >= CASCADE_ROWS || enter.hasEntered(id)}
                  markEntered={enter.markEntered}
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
                      credentialServiceTypes={credentialServiceTypes}
                      connectorReadiness={connectorReadiness}
                      modals={modals}
                      onToggleExpand={onToggleExpand}
                      onViewFlows={onViewFlows}
                      onDeleteReview={onDeleteReview}
                      onAddCredential={onAddCredential}
                      rebuildReviewId={rebuildReviewId}
                      rebuildPhase={rebuildPhase}
                      onResetRebuild={onResetRebuild}
                      previewReviewId={previewReviewId}
                      previewPhase={previewPhase}
                      onResetPreview={onResetPreview}
                      isCompareSelected={compareSelectedIds.has(review.id)}
                      compareDisabled={compareAtCapacity && !compareSelectedIds.has(review.id)}
                      onToggleCompare={onToggleCompare}
                    />
                  )}
                </RevealItem>
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

// ---------------------------------------------------------------------------
// GalleryGhostRows — calm, geometry-matched ghost rows for the ONLY moment
// the row region has nothing to show (a fetch with a cold store / empty
// filter context). Each ghost enters via `animate-fade-in` (150ms,
// fill-mode: both) behind a staggered animation-delay starting at 120ms —
// `both` holds opacity 0 through the delay, so a fetch that resolves quickly
// never paints a single ghost. Real rows replace ghosts the frame data
// arrives, playing the same cascade in the same geometry. No `animate-pulse`.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghosts read as rows, not a barcode. */
const GHOST_NAME_WIDTHS = ['w-48', 'w-40', 'w-56', 'w-36', 'w-44'];
const GHOST_ROW_COUNT = 8;

function GalleryGhostRows({ density }: { density: Density }) {
  const rowHeight = density === 'compact' ? 40 : 72;
  return (
    <div className="flex-1 overflow-hidden" aria-hidden="true">
      {Array.from({ length: GHOST_ROW_COUNT }).map((_, i) => {
        const nameW = GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return density === 'compact' ? (
          <div
            key={i}
            className="flex items-center gap-2 border-b border-primary/5 px-4 animate-fade-in"
            style={{ height: rowHeight, animationDelay: delay }}
          >
            <span className={`h-3 ${nameW} max-w-full ${GHOST_BAR}`} />
            <span className="h-3 w-14 rounded-full bg-primary/[0.06] ml-auto flex-shrink-0" />
          </div>
        ) : (
          <div
            key={i}
            className="flex items-center border-b border-primary/5 animate-fade-in"
            style={{ height: rowHeight, animationDelay: delay }}
          >
            <div className="w-20 px-4 flex-shrink-0 flex items-center">
              <span className="w-4.5 h-4.5 rounded bg-primary/[0.06]" />
            </div>
            <div className="flex-1 px-4 min-w-0 space-y-1.5">
              <span className={`block h-3.5 ${nameW} max-w-full ${GHOST_BAR}`} />
              <span className="block h-3 w-3/5 max-w-full rounded bg-primary/[0.04]" />
              <span className="block h-2.5 w-24 rounded-full bg-primary/[0.04]" />
            </div>
            <div className="w-28 px-4 flex-shrink-0 flex justify-center">
              <span className="h-5 w-10 rounded-full bg-primary/[0.06]" />
            </div>
            <div className="w-12 px-3 flex-shrink-0" />
          </div>
        );
      })}
    </div>
  );
}
