import { lazy, Suspense } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

// Lazy-load each settings tab -- only the active one resolves.
const AccountSettings = lazy(() => import('@/features/settings/sub_account/components/AccountSettings'));
const AppearanceSettings = lazy(() => import('@/features/settings/sub_appearance/components/AppearanceSettings'));
const NotificationSettings = lazy(() => import('@/features/settings/sub_notifications/components/NotificationSettings'));
const EngineSettings = lazy(() => import('@/features/settings/sub_engine/components/EngineSettings'));
const ByomSettings = lazy(() => import('@/features/settings/sub_byom/components/ByomSettings'));
const DataPortabilitySettings = lazy(() => import('@/features/settings/sub_portability/components/DataPortabilitySettings'));
const NetworkSettings = lazy(() => import('@/features/sharing/components/ExposureManager'));
const AdminSettings = lazy(() => import('@/features/settings/sub_admin/components/AdminSettings'));
const ConfigResolutionSettings = lazy(() => import('@/features/settings/sub_config/components/ConfigResolutionPanel'));

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
      case 'config': return <ConfigResolutionSettings />;
      case 'admin': return <AdminSettings />;
      default: return <AccountSettings />;
    }
  })();

  return (
    <div
      key={settingsTab}
      data-testid="settings-page"
      className="animate-fade-slide-in flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      <Suspense fallback={<SuspenseFallback />}>
        {content}
      </Suspense>
    </div>
  );
}
