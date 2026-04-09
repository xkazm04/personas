import { lazy, Suspense, useEffect, useState, useCallback, useMemo } from 'react';
import { FlaskConical, GitBranch, Wand2, Dna, Sparkles, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { managementFetch } from '@/api/system/managementApiAuth';
import type { LabMode } from '@/stores/slices/agents/labSlice';
import { useLabTranslation } from '../../i18n/useLabTranslation';

const ArenaPanel = lazy(() => import('../arena/ArenaPanel').then((m) => ({ default: m.ArenaPanel })));
const MatrixPanel = lazy(() => import('../matrix/MatrixPanel').then((m) => ({ default: m.MatrixPanel })));
const VersionsPanel = lazy(() => import('./VersionsPanel').then((m) => ({ default: m.VersionsPanel })));
const GenomeBreedingPanel = lazy(() => import('../genome/GenomeBreedingPanel').then((m) => ({ default: m.GenomeBreedingPanel })));
const EvolutionPanel = lazy(() => import('../evolution/EvolutionPanel').then((m) => ({ default: m.EvolutionPanel })));

const LAB_MODE_KEY = 'dac-lab-mode';

type TabDef = { id: LabMode; tabKey: keyof typeof import('../../i18n/en').en.lab.tabs; icon: typeof FlaskConical };

const tabDefs: TabDef[] = [
  { id: 'arena', tabKey: 'arena', icon: FlaskConical },
  { id: 'matrix', tabKey: 'improve', icon: Wand2 },
  { id: 'breed', tabKey: 'mixMatch', icon: Dna },
  { id: 'evolve', tabKey: 'autoImprove', icon: Sparkles },
  { id: 'versions', tabKey: 'versions', icon: GitBranch },
];

const validModes = new Set<string>(tabDefs.map((t) => t.id));

export function LabTab() {
  const labMode = useAgentStore((s) => s.labMode);
  const setLabMode = useAgentStore((s) => s.setLabMode);
  const personaId = useAgentStore((s) => s.selectedPersona?.id);
  const hydrateActiveProgress = useAgentStore((s) => s.hydrateActiveProgress);
  const { t } = useLabTranslation();

  const modeTabs = useMemo(() => tabDefs.map((def) => ({
    id: def.id,
    label: t.tabs[def.tabKey].label,
    desc: t.tabs[def.tabKey].desc,
    icon: def.icon,
  })), [t]);

  // Restore persisted tab on mount
  useEffect(() => {
    const saved = localStorage.getItem(LAB_MODE_KEY);
    if (saved && validModes.has(saved)) {
      setLabMode(saved as LabMode);
    }
  }, [setLabMode]);

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
      {/* Mode tabs + Auto-Optimize toggle */}
      <div className="flex items-center gap-1">
        {modeTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = labMode === tab.id;
          return (
            <button
              key={tab.id}
              data-testid={`lab-mode-${tab.id}`}
              onClick={() => setLabMode(tab.id)}
              className={`relative flex flex-col items-start gap-0.5 px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                isActive
                  ? 'bg-primary/10 text-foreground/90 border border-primary/20'
                  : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </span>
              <span className="typo-caption text-muted-foreground/60 font-mono tracking-wider">
                {tab.desc}
              </span>
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
        <div className="ml-auto">
          <AutoOptimizeToggle />
        </div>
      </div>

      {/* Mode content */}
      <Suspense fallback={<div className="py-8 text-center text-xs text-muted-foreground/50">Loading...</div>}>
        {labMode === 'arena' && <ArenaPanel />}
        {(labMode === 'matrix' || labMode === 'ab' || labMode === 'eval') && <MatrixPanel />}
        {labMode === 'breed' && <GenomeBreedingPanel />}
        {labMode === 'evolve' && <EvolutionPanel />}
        {labMode === 'versions' && <VersionsPanel />}
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
    } catch { /* management API not running */ }
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
    } catch { /* silent */ }
    setLoading(false);
  };

  return (
    <button
      data-testid="auto-optimize-toggle"
      onClick={toggle}
      disabled={loading || !persona}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        enabled
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
      }`}
      title={enabled ? "Auto-optimization enabled (weekly arena + improve)" : "Enable automatic prompt optimization"}
    >
      <Zap className={`w-3 h-3 ${enabled ? 'text-emerald-400' : ''}`} />
      Auto-Optimize
      <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
    </button>
  );
}
