import { getPendingReviewCount } from '@/api/overview/reviews';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { createLogger } from '@/lib/log';

const logger = createLogger('check-human-reviews');

/**
 * After a successful execution, checks whether new pending human reviews
 * were created.  If so, pushes a notification to the NotificationCenter
 * with a redirect to Overview > Approvals.
 */
export async function checkNewHumanReviews(
  personaId: string,
  personaName: string | null,
): Promise<void> {
  try {
    const count = await getPendingReviewCount(personaId);
    if (count <= 0) return;

    useNotificationCenterStore.getState().addProcessNotification({
      processType: 'execution',
      personaId,
      personaName,
      status: 'success',
      summary: `${count} pending review${count !== 1 ? 's' : ''} awaiting approval`,
      redirectSection: 'overview',
      redirectTab: 'manual-review',
    });

    // Refresh the overview store pending count so the sidebar badge updates immediately
    void import('@/stores/overviewStore').then(({ useOverviewStore }) => {
      useOverviewStore.getState().fetchPendingReviewCount();
    });
  } catch (err) {
    logger.warn('Failed to check human reviews after execution', { personaId, error: String(err) });
  }
}
