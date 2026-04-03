import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import DashboardHome from '@/features/overview/components/dashboard/DashboardHome';

/**
 * Dashboard wrapper — previously hosted Overview/Analytics/Realtime/Timeline
 * subtabs. Those have been consolidated into the single DashboardHome view.
 */
export default function DashboardWithSubtabs() {
  return (
    <ErrorBoundary name="Dashboard">
      <DashboardHome />
    </ErrorBoundary>
  );
}
