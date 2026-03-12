import { lazy, Suspense, useEffect } from 'react';
import { FlaskConical, GitBranch, Wand2, ArrowLeftRight, Grid3X3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { Button } from '@/features/shared/components/buttons';
import PanelSkeleton from '@/features/shared/components/layout/PanelSkeleton';
import type { LabMode } from '@/stores/slices/agents/labSlice';

// Each mode panel is lazy-loaded -- only the active one resolves.
const ArenaPanel = lazy(() => import('./panels/arena/ArenaPanel').then(m => ({ default: m.ArenaPanel })));
const AbPanel = lazy(() => import('./panels/ab/AbPanel').then(m => ({ default: m.AbPanel })));
const EvalPanel = lazy(() => import('./panels/eval/EvalPanel').then(m => ({ default: m.EvalPanel })));
const MatrixPanel = lazy(() => import('./panels/matrix/MatrixPanel').then(m => ({ default: m.MatrixPanel })));
const VersionsPanel = lazy(() => import('./panels/VersionsPanel').then(m => ({ default: m.VersionsPanel })));

const LAB_MODE_KEY = 'dac-lab-mode';

const modeTabs: Array<{ id: LabMode; label: string; desc: string; icon: typeof FlaskConical }> = [
  { id: 'arena', label: 'Arena', desc: 'Compare models head-to-head', icon: FlaskConical },
  { id: 'ab', label: 'A/B', desc: 'Split-test prompt variants', icon: ArrowLeftRight },
  { id: 'eval', label: 'Eval', desc: 'Score against rubrics', icon: Grid3X3 },
  { id: 'matrix', label: 'Matrix', desc: 'Cross-model x cross-scenario grid', icon: Wand2 },
  { id: 'versions', label: 'Versions', desc: 'Track prompt evolution', icon: GitBranch },
];

const validModes = new Set<string>(modeTabs.map((t) => t.id));

export function LabTab() {
  const labMode = usePersonaStore((s) => s.labMode);
  const setLabMode = usePersonaStore((s) => s.setLabMode);

  // Restore persisted tab on mount
  useEffect(() => {
    const saved = localStorage.getItem(LAB_MODE_KEY);
    if (saved && validModes.has(saved)) {
      setLabMode(saved as LabMode);
    }
  }, [setLabMode]);

  // Persist tab on change
  useEffect(() => {
    localStorage.setItem(LAB_MODE_KEY, labMode);
  }, [labMode]);

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex items-center gap-1">
        {modeTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = labMode === tab.id;
          return (
            <Button
              key={tab.id}
              onClick={() => setLabMode(tab.id)}
              variant="ghost"
              size="sm"
              className={`relative flex flex-col items-start gap-0.5 ${
                isActive
                  ? 'bg-primary/10 text-foreground/90 border border-primary/20'
                  : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </span>
              <span className="text-[10px] text-muted-foreground/60 font-mono tracking-wider">
                {tab.desc}
              </span>
              {isActive && (
                <motion.div
                  layoutId="labModeTab"
                  className="absolute -bottom-px left-2 right-2 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </Button>
          );
        })}
      </div>

      {/* Mode content -- lazy loaded with skeleton fallback */}
      <Suspense fallback={<PanelSkeleton variant="tab" />}>
        {labMode === 'arena' && <ArenaPanel />}
        {labMode === 'ab' && <AbPanel />}
        {labMode === 'eval' && <EvalPanel />}
        {labMode === 'matrix' && <MatrixPanel />}
        {labMode === 'versions' && <VersionsPanel />}
      </Suspense>
    </div>
  );
}
