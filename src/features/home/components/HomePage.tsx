import { lazy, Suspense } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { SystemHealthPanel } from '@/features/overview/components/health/SystemHealthPanel';
import HomeWelcome from '@/features/home/components/HomeWelcome';

const HomeRoadmap = lazy(() => import('@/features/home/components/HomeRoadmap'));

export default function HomePage() {
  const homeTab = useSystemStore((s) => s.homeTab);
  const showSystemCheck = homeTab === 'system-check' && import.meta.env.DEV;

  return (
    <div
      key={homeTab}
      className="animate-fade-slide-in flex-1 min-h-0 flex flex-col w-full overflow-hidden"
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
    </div>
  );
}
