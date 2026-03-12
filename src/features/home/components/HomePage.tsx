import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { SystemHealthPanel } from '@/features/overview/components/health/SystemHealthPanel';
import HomeWelcome from '@/features/home/components/HomeWelcome';

export default function HomePage() {
  const homeTab = usePersonaStore((s) => s.homeTab);
  const showSystemCheck = homeTab === 'system-check' && import.meta.env.DEV;

  return (
    <motion.div
      key={homeTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      {showSystemCheck ? <SystemHealthPanel /> : <HomeWelcome />}
    </motion.div>
  );
}
