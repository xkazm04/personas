import { Suspense, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSystemStore } from "@/stores/systemStore";
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import type { SettingsTab } from '@/lib/types/types';

// Lazy-load each settings tab -- only mounted on first visit.
const tabComponents: Record<SettingsTab, React.ComponentType> = {
  account: lazyRetry(() => import('@/features/settings/sub_account/components/AccountSettings')),
  appearance: lazyRetry(() => import('@/features/settings/sub_appearance/components/AppearanceSettings')),
  notifications: lazyRetry(() => import('@/features/settings/sub_notifications/components/NotificationSettings')),
  radio: lazyRetry(() => import('@/features/plugins/radio/components/RadioPage')),
  engine: lazyRetry(() => import('@/features/settings/sub_engine/components/EngineSettings')),
  byom: lazyRetry(() => import('@/features/settings/sub_byom/components/ByomSettings')),
  portability: lazyRetry(() => import('@/features/settings/sub_portability/components/DataPortabilitySettings')),
  network: lazyRetry(() => import('@/features/settings/sub_network/components/ExposureManager')),
  devices: lazyRetry(() => import('@/features/settings/sub_devices/components/DeviceLinkPage')),
  admin: lazyRetry(() => import('@/features/settings/sub_admin/components/AdminSettings')),
  'api-keys': lazyRetry(() => import('@/features/settings/sub_api_keys/components/ApiKeysSettings')),
  history: lazyRetry(() => import('@/features/settings/sub_history/components/SettingsHistoryTab')),
  limits: lazyRetry(() => import('@/features/settings/sub_limits/components/LimitsSettings')),
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
            inert={!isActive}
            aria-hidden={!isActive}
            animate={{ opacity: isActive ? 1 : 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={isActive
              ? 'relative flex-1 min-h-0 flex flex-col'
              : 'absolute inset-0 pointer-events-none overflow-hidden'}
            style={{ willChange: 'opacity' }}
          >
            {/* Each tab renders its own ContentHeader, so the ghost is the delayed
                header band: a cold tab shows chrome inside the 150ms window
                instead of an empty box (page-loading.md Deviations D). */}
            <Suspense fallback={<RouteChunkSkeleton showIcon />}>
              <Component />
            </Suspense>
          </motion.div>
        );
      })}
    </div>
  );
}
