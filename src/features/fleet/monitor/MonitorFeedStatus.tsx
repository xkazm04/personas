// MonitorFeedStatus — the Activity board's honesty strip.
//
// The board fuses three reads (pending reviews, unread messages, persona
// health) and every one of them used to fail into silence: a `logger.error` or
// a `logger.warn`, and then a fleet of idle-grey tiles that reads as "your
// fleet is calm". A `list_manual_reviews` that has been failing for ten minutes
// looked exactly like an empty queue, and a held team step is precisely the
// thing that must not disappear quietly.
//
// This is the state, not a replacement: the board keeps rendering whatever it
// last knew (loading law 1 — a failed fetch never hides rows already there) and
// this strip sits above it saying which half is missing and how old the picture
// is. It renders nothing at all when every feed is healthy, so a working
// Monitor is unchanged.

import { useTranslation } from '@/i18n/useTranslation';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

export interface MonitorFeedStatusProps {
  reviewsError: string | null;
  messagesError: string | null;
  healthError: string | null;
  /** Oldest successful read across the rendered feeds, epoch ms. */
  lastRefreshed: number | null;
}

export function MonitorFeedStatus({
  reviewsError,
  messagesError,
  healthError,
  lastRefreshed,
}: MonitorFeedStatusProps) {
  const { t } = useTranslation();

  // One sentence per failed feed, so the strip names what is missing rather
  // than saying "something went wrong" over a board that is 2/3 correct.
  const reasons: string[] = [];
  if (reviewsError) reasons.push(t.monitor.reviews_error);
  if (messagesError) reasons.push(t.monitor.feed_error_messages);
  if (healthError) reasons.push(t.monitor.feed_error_health);
  if (reasons.length === 0) return null;

  return (
    <div className="relative z-10 flex-shrink-0 px-5 py-2" data-testid="monitor-feed-status">
      <InlineErrorBanner
        // Warning, not error: the board below is still showing real data for
        // every feed that answered. An `error` would overstate a partial gap.
        severity="warning"
        title={t.monitor.feed_error_title}
        message={reasons.join(' ')}
        compact
        actions={
          <span className="shrink-0 typo-caption text-foreground" data-testid="monitor-feed-as-of">
            {t.monitor.feed_as_of}{' '}
            <RelativeTime timestamp={lastRefreshed} fallback={t.monitor.feed_never} />
          </span>
        }
      />
    </div>
  );
}

export default MonitorFeedStatus;
