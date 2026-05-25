import { memo } from 'react';
import { RotationOverviewPanel } from '@/features/overview/sub_analytics/components/RotationOverviewPanel';

/**
 * Lazy-loaded analytics inserts for DashboardHome.
 * Keeps recharts out of the eager bundle.
 */
const AnalyticsInserts = memo(function AnalyticsInserts() {
  return <RotationOverviewPanel />;
});

export default AnalyticsInserts;
