import type { ReviewMessageAddedPayload } from '@/lib/eventRegistry';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from './createSingletonListener';

/**
 * Subscribes to the Tauri 'review-message-added' channel.
 *
 * `add_review_message` (src-tauri/src/commands/design/reviews.rs) has emitted
 * this on every write since the command was written, and nothing in the app
 * listened: the thread only ever changed when the local `handleSend` appended
 * its own optimistic row. A message written by anything else — a persona reply,
 * a second window, a cloud-poll import — never appeared until the panel was
 * closed and reopened.
 *
 * Fans out every message on the channel; the subscriber filters by `review_id`,
 * because one singleton serves whichever review is open.
 */
export const useReviewMessageAddedListener =
  createSingletonListener<ReviewMessageAddedPayload>(EventName.REVIEW_MESSAGE_ADDED);
