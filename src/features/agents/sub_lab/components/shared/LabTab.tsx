import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { FlaskConical, GitBranch, Wand2, Dna, Sparkles, Zap, ShieldCheck, Scale } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from '@/stores/systemStore';
import { managementFetch } from '@/api/system/managementApiAuth';
import type { LabMode } from '@/stores/slices/agents/labSlice';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText } from '@/i18n/DebtText';



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
  const { t } = useTranslation();
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
          <AutoOptimizeToggle />
        </div>
      </div>

      {/* Mode content */}
      <Suspense fallback={<div className="py-8 text-center typo-caption text-foreground">{t.agents.lab.loading}</div>}>
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

function AutoOptimizeToggle() {
  const persona = useAgentStore((s) => s.selectedPersona);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!persona) return;
    try {
      const resp = await managementFetch(`/api/settings/auto-optimize/${persona.id}`);
      if (resp.ok) {
        const data = await resp.json();
        setEnabled(data?.data?.enabled || false);
      }
    } catch (err) { silentCatch("features/agents/sub_lab/components/shared/LabTab:catch1")(err); }
  }, [persona]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const toggle = async () => {
    if (!persona) return;
    setLoading(true);
    try {
      await managementFetch(`/api/settings/auto-optimize/${persona.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !enabled,
          cron: "0 2 * * 0",
          min_score: 80,
          models: ["sonnet"],
        }),
      });
      setEnabled(!enabled);
    } catch (err) { silentCatch("features/agents/sub_lab/components/shared/LabTab:catch2")(err); }
    setLoading(false);
  };

  return (
    <button
      data-testid="auto-optimize-toggle"
      onClick={toggle}
      disabled={loading || !persona}
      className={`flex items-center gap-1.5 px-2.5 py-1 typo-caption font-medium rounded-card border transition-colors ${
        enabled
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
          : 'text-foreground hover:bg-secondary/30 border-primary/10 hover:border-primary/20'
      }`}
      title={enabled ? "Auto-optimization enabled (weekly arena + improve)" : "Enable automatic prompt optimization"}
    >
      <Zap className={`w-3 h-3 ${enabled ? 'text-emerald-400' : ''}`} />
      <DebtText k="auto_auto_optimize_14b37f99" />
      <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
    </button>
  );
}
