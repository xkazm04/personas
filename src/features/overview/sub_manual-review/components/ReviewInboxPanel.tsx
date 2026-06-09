import { useState, useCallback, useMemo, useRef } from 'react';
import { CheckSquare, Square, X, MessageSquare, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { createRafCoalescer } from '@/lib/utils/interaction/rafCoalescer';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { InboxItem } from './ReviewListItem';
import { ConversationThread } from './ReviewDetailPanel';
import { useProgressiveReveal, useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { debtText } from '@/i18n/DebtText';


interface ReviewInboxPanelProps {
  filteredReviews: ManualReviewItem[];
  activeReviewId: string | null;
  activeReview: ManualReviewItem | null;
  selectedIds: Set<string>;
  isProcessing: boolean;
  onSelectReview: (id: string | null) => void;
  onToggleSelect: (id: string) => void;
  onAction: (status: ManualReviewStatus, notes?: string) => Promise<void>;
  /** L2 lazy-load — callback ref for the keyset sentinel at the list end. */
  sentinelRef?: (el: HTMLElement | null) => void;
  /** Whether more keyset pages remain (renders the sentinel when true). */
  hasMore?: boolean;
  /** Whether the next page is currently loading (shows a spinner). */
  loadingMore?: boolean;
  /** Changes to restart the progressive reveal (e.g. the active filter). */
  revealKey?: string;
}

export function ReviewInboxPanel({
  filteredReviews,
  activeReviewId,
  activeReview,
  selectedIds,
  isProcessing,
  onSelectReview,
  onToggleSelect,
  onAction,
  sentinelRef,
  hasMore,
  loadingMore,
  revealKey,
}: ReviewInboxPanelProps) {
  const { t } = useTranslation();
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Progressive reveal — spread inbox rows over ~2s after the panel lands
  // instead of mounting the whole page at once. Resets when the filter
  // (revealKey) changes; chases appended keyset pages.
  const reveal = useProgressiveReveal(filteredReviews.length, {
    resetKey: revealKey ?? `${filteredReviews.length}`,
    initialCount: 18,
  });
  const revealedReviews = useMemo(
    () => filteredReviews.slice(0, reveal.count),
    [filteredReviews, reveal.count],
  );
  const reviewEnter = useRevealTracker(revealKey ?? `${filteredReviews.length}`);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth ?? containerRef.current?.querySelector<HTMLElement>('[data-inbox-list]')?.offsetWidth ?? 340;
    const containerWidth = containerRef.current?.offsetWidth ?? 1000;
    const minW = 260;
    const maxW = Math.min(containerWidth * 0.6, 600);

    const resizeFrame = createRafCoalescer((clientX: number) => {
      const delta = clientX - startX;
      setSidebarWidth(Math.max(minW, Math.min(maxW, startWidth + delta)));
    });
    const onMove = (ev: PointerEvent) => {
      resizeFrame.schedule(ev.clientX);
    };
    const onUp = () => {
      resizeFrame.cancel();
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [sidebarWidth]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* Left: Inbox list */}
        <div
          data-inbox-list
          className={`animate-fade-in flex-shrink-0 border-r border-primary/10 flex flex-col overflow-hidden`}
          style={
            !IS_MOBILE
              ? { width: sidebarWidth != null ? `${sidebarWidth}px` : 'clamp(340px, 30%, 420px)' }
              : undefined
          }
        >
          {reveal.isRevealing && (
            <div aria-hidden="true" className="flex items-center justify-end gap-1 px-3 py-1 typo-caption text-foreground border-b border-primary/[0.06] flex-shrink-0">
              <AnimatedCounter value={reveal.count} mode="roll" /><span>/</span><Numeric>{filteredReviews.length}</Numeric>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {revealedReviews.map((review, reviewIndex) => (
              <RevealItem key={review.id} revealId={review.id} order={reviewIndex - reveal.newSince} hasEntered={reviewEnter.hasEntered} markEntered={reviewEnter.markEntered} className="flex items-start">
                {review.status === 'pending' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(review.id);
                    }}
                    role="checkbox"
                    aria-checked={selectedIds.has(review.id)}
                    aria-label="Select review"
                    className="flex-shrink-0 w-8 flex items-center justify-center pt-3.5 text-foreground hover:text-muted-foreground transition-colors"
                  >
                    {selectedIds.has(review.id) ? (
                      <CheckSquare className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                <div className={`flex-1 min-w-0 ${review.status !== 'pending' ? 'pl-8' : ''}`}>
                  <InboxItem
                    review={review}
                    isActive={review.id === activeReviewId}
                    onClick={() => onSelectReview(review.id)}
                  />
                </div>
              </RevealItem>
            ))}
            {/* L2 — keyset sentinel: scrolling near it pulls the next page.
                Held until the current page finishes revealing so we don't
                fetch the next page mid-reveal. */}
            {hasMore && !reveal.isRevealing && (
              <div ref={sentinelRef} className="py-3 flex items-center justify-center">
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-foreground/40" />}
              </div>
            )}
          </div>
        </div>

        {/* Resize handle */}
        {!IS_MOBILE && (
          <div
            onPointerDown={handleResizeStart}
            className="w-1 flex-shrink-0 cursor-col-resize group relative z-10 hover:bg-primary/20 active:bg-primary/30 transition-colors"
            title={debtText("auto_drag_to_resize_01f90cde")}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-muted-foreground/20 group-hover:bg-primary/40 transition-colors" />
          </div>
        )}

        {/* Right: Conversation thread (split mode) */}
        {!IS_MOBILE && (
            <div
              key="split-panel"
              className="animate-fade-slide-in flex-1 min-w-0 flex flex-col overflow-hidden"
            >
              {activeReview ? (
                <ConversationThread
                  key={activeReview.id}
                  review={activeReview}
                  onAction={onAction}
                  isProcessing={isProcessing}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <EmptyState
                    icon={MessageSquare}
                    title={t.overview.review.select_review}
                  />
                </div>
              )}
            </div>
          )}

        {/* Mobile: Full-screen overlay */}
        {IS_MOBILE && activeReview && (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 flex-shrink-0">
              <button
                onClick={() => onSelectReview(null)}
                className="p-2 rounded-card hover:bg-secondary/50 text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="typo-heading text-foreground truncate">{t.overview.review.review_detail}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ConversationThread
                key={activeReview.id}
                review={activeReview}
                onAction={onAction}
                isProcessing={isProcessing}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
