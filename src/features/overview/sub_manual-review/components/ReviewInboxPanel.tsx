import { CheckSquare, Square, X, MessageSquare } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { InboxItem } from './ReviewListItem';
import { ConversationThread } from './ReviewDetailPanel';

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
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: Inbox list */}
      <div
        className={`${IS_MOBILE ? 'w-full' : 'w-[340px] 2xl:w-[420px]'} flex-shrink-0 border-r border-primary/10 flex flex-col overflow-hidden`}
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
                  onClick={() => onSelectReview(review.id)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Conversation thread */}
      {IS_MOBILE ? (
        activeReview && (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 flex-shrink-0">
              <button
                onClick={() => onSelectReview(null)}
                className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-foreground/80 truncate">Review Detail</span>
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
        )
      ) : (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
        </div>
      )}
    </div>
  );
}
