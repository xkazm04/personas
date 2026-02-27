import { FlaskConical, GitBranch, Wand2, ArrowLeftRight, Grid3X3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { useLabEvents } from '@/hooks/lab/useLabEvents';
import { ArenaPanel } from './ArenaPanel';
import { AbPanel } from './AbPanel';
import { MatrixPanel } from './MatrixPanel';
import { EvalPanel } from './EvalPanel';
import { VersionsPanel } from './VersionsPanel';
import type { LabMode } from '@/stores/slices/labSlice';

const modeTabs: Array<{ id: LabMode; label: string; icon: typeof FlaskConical }> = [
  { id: 'arena', label: 'Arena', icon: FlaskConical },
  { id: 'ab', label: 'A/B', icon: ArrowLeftRight },
  { id: 'eval', label: 'Eval', icon: Grid3X3 },
  { id: 'matrix', label: 'Matrix', icon: Wand2 },
  { id: 'versions', label: 'Versions', icon: GitBranch },
];

export function LabTab() {
  const labMode = usePersonaStore((s) => s.labMode);
  const setLabMode = usePersonaStore((s) => s.setLabMode);

  // Attach Tauri event listeners for lab progress
  useLabEvents();

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex items-center gap-1">
        {modeTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = labMode === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setLabMode(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary/10 text-foreground/90 border border-primary/20'
                  : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="labModeTab"
                  className="absolute -bottom-px left-2 right-2 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Mode content */}
      {labMode === 'arena' && <ArenaPanel />}
      {labMode === 'ab' && <AbPanel />}
      {labMode === 'eval' && <EvalPanel />}
      {labMode === 'matrix' && <MatrixPanel />}
      {labMode === 'versions' && <VersionsPanel />}
    </div>
  );
}
