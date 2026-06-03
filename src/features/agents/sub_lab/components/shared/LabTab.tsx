import { lazy, Suspense, useEffect } from 'react';
import { FlaskConical, GitBranch, Wand2, Dna, Sparkles, ShieldCheck, Scale } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from '@/stores/systemStore';
import type { LabMode } from '@/stores/slices/agents/labSlice';
import { LabResultsSkeleton } from './LabResultsSkeleton';
import { AutoOptimizeConfig } from './AutoOptimizeConfig';



const ArenaPanel = lazy(() => import('../arena/ArenaPanel').then((m) => ({ default: m.ArenaPanel })));
const AbPanel = lazy(() => import('../ab/AbPanel').then((m) => ({ default: m.AbPanel })));
const MatrixPanel = lazy(() => import('../matrix/MatrixPanel').then((m) => ({ default: m.MatrixPanel })));
const VersionsPanel = lazy(() => import('./VersionsPanel').then((m) => ({ default: m.VersionsPanel })));
const GenomeBreedingPanel = lazy(() => import('../genome/GenomeBreedingPanel').then((m) => ({ default: m.GenomeBreedingPanel })));
const EvolutionPanel = lazy(() => import('../evolution/EvolutionPanel').then((m) => ({ default: m.EvolutionPanel })));
const RegressionPanel = lazy(() => import('../regression/RegressionPanel').then((m) => ({ default: m.RegressionPanel })));

const LAB_MODE_KEY = 'dac-lab-mode';

const modeTabs: Array<{ id: LabMode; label: string; icon: typeof FlaskConical }> = [
  { id: 'arena', label: 'Arena', icon: FlaskConical },
  { id: 'ab', label: 'A/B', icon: Scale },
  { id: 'matrix', label: 'Improve', icon: Wand2 },
  { id: 'breed', label: 'Breed', icon: Dna },
  { id: 'evolve', label: 'Evolve', icon: Sparkles },
  { id: 'versions', label: 'Versions', icon: GitBranch },
  { id: 'regression', label: 'Regression', icon: ShieldCheck },
];

const validModes = new Set<string>(modeTabs.map((t) => t.id));

export function LabTab() {
  const labMode = useAgentStore((s) => s.labMode);
  const setLabMode = useAgentStore((s) => s.setLabMode);
  const personaId = useAgentStore((s) => s.selectedPersona?.id);
  const hydrateActiveProgress = useAgentStore((s) => s.hydrateActiveProgress);

  // Restore persisted tab on mount.
  // Phase F: a pending Athena `companion://open-lab` jump beats the
  // persisted localStorage choice — Athena's intent is the most
  // recent signal. Consume + clear in the same effect.
  useEffect(() => {
    const sys = useSystemStore.getState();
    const jump = sys.companionLabJump;
    if (jump && validModes.has(jump.mode) && (!personaId || personaId === jump.personaId)) {
      setLabMode(jump.mode as LabMode);
      sys.setCompanionLabJump(null);
      return;
    }
    const saved = localStorage.getItem(LAB_MODE_KEY);
    if (saved && validModes.has(saved)) {
      setLabMode(saved as LabMode);
    }
  }, [setLabMode, personaId]);

  // Hydrate active run progress on mount (restores progress indicators after page refresh)
  useEffect(() => {
    if (personaId) hydrateActiveProgress(personaId);
  }, [personaId, hydrateActiveProgress]);

  // Persist tab on change
  useEffect(() => {
    localStorage.setItem(LAB_MODE_KEY, labMode);
  }, [labMode]);

  return (
    <div className="space-y-4">
      {/* Mode tabs + Auto-Optimize toggle — styled to mirror the parent EditorTabBar */}
      <div className="flex items-center border-b border-primary/10 px-1">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {modeTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = labMode === tab.id;
            return (
              <button
                key={tab.id}
                data-testid={`lab-mode-${tab.id}`}
                onClick={() => setLabMode(tab.id)}
                title={tab.label}
                className={`relative flex items-center gap-1.5 px-3 py-2 typo-body font-medium transition-colors whitespace-nowrap ${
                  isActive ? 'text-primary' : 'text-foreground hover:text-foreground/95'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="labModeTab"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="pl-2 flex-shrink-0">
          <AutoOptimizeConfig />
        </div>
      </div>

      {/* Mode content */}
      <Suspense fallback={<div className="pt-4"><LabResultsSkeleton /></div>}>
        {labMode === 'arena' && <ArenaPanel />}
        {labMode === 'ab' && <AbPanel />}
        {(labMode === 'matrix' || labMode === 'eval') && <MatrixPanel />}
        {labMode === 'breed' && <GenomeBreedingPanel />}
        {labMode === 'evolve' && <EvolutionPanel />}
        {labMode === 'versions' && <VersionsPanel />}
        {labMode === 'regression' && <RegressionPanel />}
      </Suspense>
    </div>
  );
}
