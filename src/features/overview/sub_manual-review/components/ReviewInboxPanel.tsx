import { useState } from 'react';
import { CheckSquare, Square, X, MessageSquare, PanelRightClose, PanelRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [slideOverOpen, setSlideOverOpen] = useState(false);

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
          <div className="flex rounded-lg border border-primary/15 overflow-hidden">
            <button
              onClick={() => { setViewMode('default'); setSlideOverOpen(false); }}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
                viewMode === 'default'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/60 hover:text-foreground/70'
              }`}
              title="Split view with chat"
            >
              <PanelRight className="w-3 h-3" />
              Split
            </button>
            <button
              onClick={() => { setViewMode('table'); setSlideOverOpen(false); }}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
                viewMode === 'table'
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/60 hover:text-foreground/70'
              }`}
              title="Table only"
            >
              <PanelRightClose className="w-3 h-3" />
              Table
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Inbox list */}
        <motion.div
          layout
          className={`flex-shrink-0 border-r border-primary/10 flex flex-col overflow-hidden`}
          animate={{
            width: IS_MOBILE
              ? '100%'
              : viewMode === 'table'
                ? '100%'
                : undefined,
          }}
          style={
            !IS_MOBILE && viewMode === 'default'
              ? { width: 'clamp(340px, 30%, 420px)' }
              : undefined
          }
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
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
                    className="flex-shrink-0 w-8 flex items-center justify-center pt-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
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
        </motion.div>

        {/* Right: Conversation thread (split mode) */}
        <AnimatePresence>
          {!IS_MOBILE && viewMode === 'default' && (
            <motion.div
              key="split-panel"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="flex-1 min-w-0 flex flex-col overflow-hidden"
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
                    <MessageSquare className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground/50">Select a review to view</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Slide-over panel (table mode) */}
        <AnimatePresence>
          {!IS_MOBILE && viewMode === 'table' && slideOverOpen && activeReview && (
            <motion.div
              key="slide-over"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="absolute right-0 top-0 bottom-0 w-[480px] 2xl:w-[560px] bg-background border-l border-primary/10 shadow-2xl shadow-black/20 flex flex-col z-20"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 flex-shrink-0 bg-secondary/20">
                <span className="typo-caption text-foreground/70">Review Detail</span>
                <button
                  onClick={handleCloseSlideOver}
                  className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile: Full-screen overlay */}
        {IS_MOBILE && activeReview && (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 flex-shrink-0">
              <button
                onClick={() => onSelectReview(null)}
                className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="typo-heading text-foreground/80 truncate">Review Detail</span>
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
