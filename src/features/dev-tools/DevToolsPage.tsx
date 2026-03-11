import { lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { usePersonaStore } from '@/stores/personaStore';

const ProjectManagerPage = lazy(() => import('./sub_projects/ProjectManagerPage'));
const ContextMapPage = lazy(() => import('./sub_context/ContextMapPage'));
const IdeaScannerPage = lazy(() => import('./sub_scanner/IdeaScannerPage'));
const IdeaTriagePage = lazy(() => import('./sub_triage/IdeaTriagePage'));
const TaskRunnerPage = lazy(() => import('./sub_runner/TaskRunnerPage'));

const SPINNER = (
  <div className="flex-1 flex items-center justify-center">
    <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
  </div>
);

export default function DevToolsPage() {
  const { shouldAnimate, transition } = useMotion();
  const devToolsTab = usePersonaStore((s) => s.devToolsTab);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={devToolsTab}
        initial={{ opacity: 0, x: shouldAnimate ? 14 : 0 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: shouldAnimate ? -14 : 0 }}
        transition={transition}
        className="h-full w-full"
      >
        <Suspense fallback={SPINNER}>
          {devToolsTab === 'projects' && <ProjectManagerPage />}
          {devToolsTab === 'context-map' && <ContextMapPage />}
          {devToolsTab === 'idea-scanner' && <IdeaScannerPage />}
          {devToolsTab === 'idea-triage' && <IdeaTriagePage />}
          {devToolsTab === 'task-runner' && <TaskRunnerPage />}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}
