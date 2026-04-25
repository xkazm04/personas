import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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

/** Unmount inactive settings tabs after this many ms of idleness. */
const IDLE_UNMOUNT_MS = 30_000;
/** How often the idle-tab sweep runs. */
const SWEEP_INTERVAL_MS = 5_000;

export default function SettingsPage() {
  const settingsTab = useSystemStore((s) => s.settingsTab);
  // Per-tab last-active timestamp. The active tab keeps the latest timestamp
  // while it's visible; once the user switches away, the timestamp freezes
  // and the sweep unmounts it after IDLE_UNMOUNT_MS.
  const lastActive = useRef<Map<SettingsTab, number>>(new Map());
  const [mountedTabs, setMountedTabs] = useState<SettingsTab[]>(() => [settingsTab]);

  // Whenever the active tab changes, stamp it and ensure it's mounted.
  useEffect(() => {
    lastActive.current.set(settingsTab, Date.now());
    setMountedTabs((prev) => (prev.includes(settingsTab) ? prev : [...prev, settingsTab]));
  }, [settingsTab]);

  // Periodically refresh the active tab's timestamp and unmount any tab
  // that has been idle longer than IDLE_UNMOUNT_MS. The lazy() module stays
  // cached, so re-entering an unmounted tab re-mounts synchronously.
  useEffect(() => {
    const id = setInterval(() => {
      lastActive.current.set(settingsTab, Date.now());
      const now = Date.now();
      setMountedTabs((prev) => {
        const next = prev.filter((tab) => {
          if (tab === settingsTab) return true;
          const ts = lastActive.current.get(tab) ?? 0;
          return now - ts <= IDLE_UNMOUNT_MS;
        });
        if (next.length === prev.length) return prev;
        for (const tab of prev) {
          if (!next.includes(tab)) lastActive.current.delete(tab);
        }
        return next;
      });
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [settingsTab]);

  return (
    <div
      data-testid="settings-page"
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden relative"
    >
      {mountedTabs.map((tab) => {
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
