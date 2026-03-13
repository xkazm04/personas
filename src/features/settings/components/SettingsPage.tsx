import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useSystemStore } from "@/stores/systemStore";
import PanelSkeleton from '@/features/shared/components/layout/PanelSkeleton';

// Lazy-load each settings tab -- only the active one resolves.
const AccountSettings = lazy(() => import('@/features/settings/sub_account/components/AccountSettings'));
const AppearanceSettings = lazy(() => import('@/features/settings/sub_appearance/components/AppearanceSettings'));
const NotificationSettings = lazy(() => import('@/features/settings/sub_notifications/components/NotificationSettings'));
const EngineSettings = lazy(() => import('@/features/settings/sub_engine/components/EngineSettings'));
const ByomSettings = lazy(() => import('@/features/settings/sub_byom/components/ByomSettings'));
const DataPortabilitySettings = lazy(() => import('@/features/settings/sub_portability/components/DataPortabilitySettings'));
const NetworkSettings = lazy(() => import('@/features/sharing/components/ExposureManager'));
const AdminSettings = lazy(() => import('@/features/settings/sub_admin/components/AdminSettings'));

export default function SettingsPage() {
  const settingsTab = useSystemStore((s) => s.settingsTab);

  const content = (() => {
    switch (settingsTab) {
      case 'account': return <AccountSettings />;
      case 'appearance': return <AppearanceSettings />;
      case 'notifications': return <NotificationSettings />;
      case 'engine': return <EngineSettings />;
      case 'byom': return <ByomSettings />;
      case 'portability': return <DataPortabilitySettings />;
      case 'network': return <NetworkSettings />;
      case 'admin': return <AdminSettings />;
      default: return <AccountSettings />;
    }
  })();

  return (
    <motion.div
      key={settingsTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      <Suspense fallback={<PanelSkeleton variant="subtab" />}>
        {content}
      </Suspense>
    </motion.div>
  );
}
