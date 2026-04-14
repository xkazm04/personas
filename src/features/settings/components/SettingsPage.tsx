import { lazy, Suspense, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSystemStore } from "@/stores/systemStore";
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import type { SettingsTab } from '@/lib/types/types';

// Lazy-load each settings tab -- only mounted on first visit.
const tabComponents: Record<SettingsTab, React.LazyExoticComponent<React.ComponentType>> = {
  account: lazy(() => import('@/features/settings/sub_account/components/AccountSettings')),
  appearance: lazy(() => import('@/features/settings/sub_appearance/components/AppearanceSettings')),
  notifications: lazy(() => import('@/features/settings/sub_notifications/components/NotificationSettings')),
  engine: lazy(() => import('@/features/settings/sub_engine/components/EngineSettings')),
  byom: lazy(() => import('@/features/settings/sub_byom/components/ByomSettings')),
  portability: lazy(() => import('@/features/settings/sub_portability/components/DataPortabilitySettings')),
  network: lazy(() => import('@/features/sharing/components/ExposureManager')),
  admin: lazy(() => import('@/features/settings/sub_admin/components/AdminSettings')),
  config: lazy(() => import('@/features/settings/sub_config/components/ConfigResolutionPanel')),
  'quality-gates': lazy(() => import('@/features/settings/sub_quality_gates/components/QualityGateSettings')),
};

export default function SettingsPage() {
  const settingsTab = useSystemStore((s) => s.settingsTab);
  const visitedRef = useRef(new Set<SettingsTab>());
  visitedRef.current.add(settingsTab);

  return (
    <div
      data-testid="settings-page"
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden relative"
    >
      {Array.from(visitedRef.current).map((tab) => {
        const Component = tabComponents[tab];
        const isActive = tab === settingsTab;
        return (
          <motion.div
            key={tab}
            animate={{ opacity: isActive ? 1 : 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={isActive
              ? 'relative flex-1 min-h-0 flex flex-col'
              : 'absolute inset-0 pointer-events-none overflow-hidden'}
            style={{ willChange: 'opacity' }}
          >
            <Suspense fallback={<SuspenseFallback />}>
              <Component />
            </Suspense>
          </motion.div>
        );
      })}
    </div>
  );
}
