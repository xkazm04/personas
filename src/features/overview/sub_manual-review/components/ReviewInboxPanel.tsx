import { useState, useCallback, useRef } from 'react';
import { CheckSquare, Square, X, MessageSquare, PanelRightClose, PanelRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { InboxItem } from './ReviewListItem';
import { ConversationThread } from './ReviewDetailPanel';

type ViewMode = 'default' | 'table';

interface ReviewInboxPanelProps {
  filteredReviews: ManualReviewItem[];
  activeReviewId: string | null;
  activeReview: ManualReviewItem | null;
  selectedIds: Set<string>;
  isProcessing: boolean;
  onSelectReview: (id: string | null) => void;
  onToggleSelect: (id: string) => void;
  onAction: (status: ManualReviewStatus, notes?: string) => Promise<void>;
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
}: ReviewInboxPanelProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth ?? containerRef.current?.querySelector<HTMLElement>('[data-inbox-list]')?.offsetWidth ?? 340;
    const containerWidth = containerRef.current?.offsetWidth ?? 1000;
    const minW = 260;
    const maxW = Math.min(containerWidth * 0.6, 600);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.max(minW, Math.min(maxW, startWidth + delta)));
    };
    const onUp = () => {
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

  const handleReviewClick = (id: string) => {
    onSelectReview(id);
    if (viewMode === 'table') {
      setSlideOverOpen(true);
    }
  };

  const handleCloseSlideOver = () => {
    setSlideOverOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* View mode toggle */}
      {!IS_MOBILE && (
        <div className="flex items-center justify-end px-3 py-1.5 border-b border-primary/[0.06] bg-secondary/10">
          <div className="flex rounded-card border border-primary/15 overflow-hidden">
            <button
              onClick={() => { setViewMode('default'); setSlideOverOpen(false); }}
              className={`flex items-center gap-1 px-2.5 py-1 typo-caption transition-colors ${
                viewMode === 'default'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-foreground hover:text-foreground/70'
              }`}
              title={t.overview.review.split_tooltip}
            >
              <PanelRight className="w-3 h-3" />
              {t.overview.review.split}
            </button>
            <button
              onClick={() => { setViewMode('table'); setSlideOverOpen(false); }}
              className={`flex items-center gap-1 px-2.5 py-1 typo-caption transition-colors ${
                viewMode === 'table'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-foreground hover:text-foreground/70'
              }`}
              title={t.overview.review.table_tooltip}
            >
              <PanelRightClose className="w-3 h-3" />
              {t.overview.review.table}
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* Left: Inbox list */}
        <div
          data-inbox-list
          className={`animate-fade-in flex-shrink-0 border-r border-primary/10 flex flex-col overflow-hidden`}
          style={
            !IS_MOBILE && viewMode === 'default'
              ? { width: sidebarWidth != null ? `${sidebarWidth}px` : 'clamp(340px, 30%, 420px)' }
              : undefined
          }
        >
          <div className="flex-1 overflow-y-auto">
            {filteredReviews.map((review) => (
              <div key={review.id} className="flex items-start">
                {review.status === 'pending' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(review.id);
                    }}
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
                    onClick={() => handleReviewClick(review.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Resize handle */}
        {!IS_MOBILE && viewMode === 'default' && (
          <div
            onPointerDown={handleResizeStart}
            className="w-1 flex-shrink-0 cursor-col-resize group relative z-10 hover:bg-primary/20 active:bg-primary/30 transition-colors"
            title="Drag to resize"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-muted-foreground/20 group-hover:bg-primary/40 transition-colors" />
          </div>
        )}

        {/* Right: Conversation thread (split mode) */}
        {!IS_MOBILE && viewMode === 'default' && (
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
                  <div className="text-center">
                    <MessageSquare className="w-8 h-8 text-foreground mx-auto mb-2" />
                    <p className="typo-body text-foreground">{t.overview.review.select_review}</p>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* Slide-over panel (table mode) */}
        {!IS_MOBILE && viewMode === 'table' && slideOverOpen && activeReview && (
            <div
              key="slide-over"
              className="animate-fade-in absolute right-0 top-0 bottom-0 w-[480px] 2xl:w-[560px] bg-background border-l border-primary/10 shadow-elevation-4 shadow-black/20 flex flex-col z-20"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 flex-shrink-0 bg-secondary/20">
                <span className="typo-caption text-foreground">{t.overview.review.review_detail}</span>
                <button
                  onClick={handleCloseSlideOver}
                  className="p-1.5 rounded-card hover:bg-secondary/50 text-foreground hover:text-muted-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ConversationThread
                  key={activeReview.id}
                  review={activeReview}
                  onAction={onAction}
                  isProcessing={isProcessing}
                />
              </div>
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
