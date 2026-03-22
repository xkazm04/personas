import { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useSystemStore } from "@/stores/systemStore";
import { SystemHealthPanel } from '@/features/overview/components/health/SystemHealthPanel';
import HomeWelcome from '@/features/home/components/HomeWelcome';

const HomeRoadmap = lazy(() => import('@/features/home/components/HomeRoadmap'));

export default function HomePage() {
  const homeTab = useSystemStore((s) => s.homeTab);
  const showSystemCheck = homeTab === 'system-check' && import.meta.env.DEV;

  return (
    <motion.div
      key={homeTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      {showSystemCheck ? (
        <SystemHealthPanel />
      ) : homeTab === 'roadmap' ? (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>}>
          <HomeRoadmap />
        </Suspense>
      ) : (
        <HomeWelcome />
      )}
    </motion.div>
  );
}
