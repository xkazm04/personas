import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Sparkles, Play, Loader2, CheckCircle2, XCircle,
  ToggleLeft, ToggleRight, TrendingUp,
  Zap, DollarSign, Target, Settings2,
  RefreshCw, AlertTriangle,
} from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import * as evolutionApi from '@/api/agents/evolution';
import type { EvolutionPolicy } from '@/lib/bindings/EvolutionPolicy';
import type { EvolutionCycle } from '@/lib/bindings/EvolutionCycle';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { useTranslation } from '@/i18n/useTranslation';

// ============================================================================
// Cycle status badge
// ============================================================================

function CycleStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; icon: React.ReactNode }> = {
    breeding: { color: 'text-blue-400 bg-blue-500/10', icon: <Sparkles className="w-3 h-3" /> },
    evaluating: { color: 'text-amber-400 bg-amber-500/10', icon: <TrendingUp className="w-3 h-3" /> },
    promoting: { color: 'text-violet-400 bg-violet-500/10', icon: <Zap className="w-3 h-3" /> },
    completed: { color: 'text-emerald-400 bg-emerald-500/10', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { color: 'text-red-400 bg-red-500/10', icon: <XCircle className="w-3 h-3" /> },
  };
  const { color, icon } = config[status] ?? config.failed!;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${color}`}>
      {icon}
      <span className="capitalize">{status}</span>
    </span>
  );
}

// ============================================================================
// Fitness objective inline editor
// ============================================================================

function ObjectiveEditor({
  objective,
  onChange,
}: {
  objective: FitnessObjective;
  onChange: (obj: FitnessObjective) => void;
}) {
  const { t } = useTranslation();
  const adjust = (key: keyof FitnessObjective, value: number) => {
    const next = { ...objective, [key]: value };
    const total = next.speed + next.quality + next.cost;
    if (total > 0) {
      next.speed /= total;
      next.quality /= total;
      next.cost /= total;
    }
    onChange(next);
  };

  const row = (key: keyof FitnessObjective, label: string, icon: React.ReactNode, color: string) => (
    <div className="flex items-center gap-2">
      <span className={`flex items-center gap-1 text-xs w-14 ${color}`}>{icon} {label}</span>
      <input
        type="range"
        min={0} max={100}
        value={Math.round(objective[key] * 100)}
        onChange={(e) => adjust(key, Number(e.target.value) / 100)}
        aria-label={`${label} weight`}
        className="flex-1 h-1 accent-violet-500"
      />
      <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(objective[key] * 100)}%</span>
    </div>
  );

  return (
    <div className="space-y-1.5">
      {row('quality', t.agents.lab.quality_label, <Target className="w-3 h-3" />, 'text-emerald-400')}
      {row('speed', t.agents.lab.speed_label, <Zap className="w-3 h-3" />, 'text-amber-400')}
      {row('cost', t.agents.lab.cost_label, <DollarSign className="w-3 h-3" />, 'text-blue-400')}
    </div>
  );
}

// ============================================================================
// Cycle history card
// ============================================================================

function CycleCard({ cycle }: { cycle: EvolutionCycle }) {
  const { t } = useTranslation();
  const improvement = cycle.winnerFitness != null && cycle.incumbentFitness != null
    ? cycle.winnerFitness - cycle.incumbentFitness
    : null;

  const hasWarning = cycle.error?.startsWith('Warning:');

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-primary/10 bg-primary/[0.02]">
        <CycleStatusBadge status={cycle.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {cycle.variantsTested} variants tested
            </span>
            {cycle.promoted && (
              <span className="text-emerald-400 font-medium flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" /> {t.agents.lab.promoted_label}
              </span>
            )}
            {improvement != null && improvement > 0 && (
              <span className="text-violet-400 text-[10px]">
                +{(improvement * 100).toFixed(1)}%
              </span>
            )}
            {hasWarning && (
              <span className="text-amber-400 flex items-center gap-0.5" title={cycle.error ?? ''}>
                <AlertTriangle className="w-3 h-3" />
                <span className="text-[10px]">{t.agents.lab.objective_warning}</span>
              </span>
            )}
          </div>
          {cycle.incumbentFitness != null && (
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground/60">
              <span>Incumbent: {Math.round(cycle.incumbentFitness * 100)}%</span>
              {cycle.winnerFitness != null && (
                <span>Winner: {Math.round(cycle.winnerFitness * 100)}%</span>
              )}
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/40 whitespace-nowrap">
          {new Date(cycle.startedAt).toLocaleDateString()}
        </span>
      </div>
      {hasWarning && (
        <div className="mx-3 mt-1 mb-1 px-2 py-1 rounded text-[10px] text-amber-300/80 bg-amber-500/5 border border-amber-500/10">
          {cycle.error?.replace('Warning: ', '')}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main panel
// ============================================================================

export function EvolutionPanel() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const addToast = useToastStore((s) => s.addToast);
  const personaId = selectedPersona?.id;

  const [policy, setPolicy] = useState<EvolutionPolicy | null>(null);
  const [cycles, setCycles] = useState<EvolutionCycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [eligible, setEligible] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Editable settings
  const [mutationRate, setMutationRate] = useState(0.15);
  const [variants, setVariants] = useState(4);
  const [threshold, setThreshold] = useState(0.05);
  const [minExecs, setMinExecs] = useState(10);
  const [objective, setObjective] = useState<FitnessObjective>({
    speed: 0.33, quality: 0.34, cost: 0.33,
  });

  const loadData = useCallback(async () => {
    if (!personaId) return;
    setIsLoading(true);
    try {
      const [p, c, e] = await Promise.all([
        evolutionApi.getPolicy(personaId),
        evolutionApi.listCycles(personaId),
        evolutionApi.checkEligibility(personaId),
      ]);
      setPolicy(p);
      setCycles(c);
      setEligible(e);
      if (p) {
        setMutationRate(p.mutationRate);
        setVariants(p.variantsPerCycle);
        setThreshold(p.improvementThreshold);
        setMinExecs(p.minExecutionsBetween);
        try {
          const obj = JSON.parse(p.fitnessObjective);
          if (obj && typeof obj.speed === 'number' && typeof obj.quality === 'number' && typeof obj.cost === 'number') {
            setObjective(obj);
          } else {
            console.warn('[EvolutionPanel] Fitness objective has unexpected shape, using defaults:', p.fitnessObjective);
          }
        } catch {
          console.warn('[EvolutionPanel] Failed to parse fitness objective, using defaults:', p.fitnessObjective);
        }
      }
    } catch {
      // silent — policy may not exist yet
    } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggle = async () => {
    if (!personaId) return;
    setIsSaving(true);
    try {
      const newEnabled = !policy?.enabled;
      const updated = await evolutionApi.toggleEvolution(personaId, newEnabled);
      setPolicy(updated);
      addToast(
        newEnabled ? 'Auto-evolution enabled' : 'Auto-evolution disabled',
        'success',
      );
    } catch (err: unknown) {
      addToast(`Failed to toggle: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!personaId) return;
    setIsSaving(true);
    try {
      const updated = await evolutionApi.upsertPolicy(personaId, {
        fitnessObjective: objective,
        mutationRate,
        variantsPerCycle: variants,
        improvementThreshold: threshold,
        minExecutionsBetween: minExecs,
      });
      setPolicy(updated);
      setShowSettings(false);
      addToast('Evolution settings saved', 'success');
    } catch (err: unknown) {
      addToast(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTriggerCycle = async () => {
    if (!personaId) return;
    setIsTriggering(true);
    try {
      const cycle = await evolutionApi.triggerCycle(personaId);
      setCycles((prev) => [cycle, ...prev]);
      addToast('Evolution cycle started', 'success');

      // Poll for completion
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      pollRef.current = setInterval(async () => {
        const updated = await evolutionApi.listCycles(personaId, 1).catch(() => []);
        if (updated.length > 0 && (updated[0]!.status === 'completed' || updated[0]!.status === 'failed')) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadData();
          if (updated[0]!.status === 'completed' && updated[0]!.promoted) {
            addToast('Evolution: variant promoted!', 'success');
          }
          if (updated[0]!.error?.startsWith('Warning:')) {
            addToast(t.agents.lab.objective_fallback_toast, 'error');
          }
        }
      }, 3000);

      // Safety timeout
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 120_000);
    } catch (err: unknown) {
      addToast(`Trigger failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsTriggering(false);
    }
  };

  if (!personaId) {
    return (
      <div className="text-center py-10 text-muted-foreground/60 text-sm">
        {t.agents.lab.select_persona_evolution}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10" role="status">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const isEnabled = policy?.enabled ?? false;

  return (
    <div className="space-y-4" role="region" aria-label="Auto-evolution panel">
      {/* Header with toggle */}
      <SectionCard
        title="Auto-Evolution"
        subtitle="Continuously evolve this persona through lab-driven optimization"
      >
        <div className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium">
                Darwinian Evolution
              </span>
            </div>
            <button
              onClick={handleToggle}
              disabled={isSaving}
              className="flex items-center gap-1.5 text-sm transition-colors"
              aria-label={isEnabled ? 'Disable auto-evolution' : 'Enable auto-evolution'}
            >
              {isEnabled ? (
                <ToggleRight className="w-8 h-8 text-emerald-400" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-muted-foreground/40" />
              )}
            </button>
          </div>

          {/* Status summary */}
          {policy && (
            <div className="grid grid-cols-3 gap-2">
              <div className="px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-center">
                <div className="text-lg font-semibold text-foreground">{policy.totalCycles}</div>
                <div className="text-[10px] text-muted-foreground">{t.agents.lab.cycles_label}</div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-center">
                <div className="text-lg font-semibold text-emerald-400">{policy.totalPromotions}</div>
                <div className="text-[10px] text-muted-foreground">{t.agents.lab.promotions_label}</div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-center">
                <div className="text-lg font-semibold text-foreground">
                  {eligible ? (
                    <span className="text-amber-400">{t.agents.lab.ready_label}</span>
                  ) : (
                    <span className="text-muted-foreground/60">{t.agents.lab.waiting_label}</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{t.agents.lab.next_cycle}</div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerCycle}
              disabled={isTriggering}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-40"
            >
              {isTriggering ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Evolving...</>
              ) : (
                <><Play className="w-4 h-4" /> Trigger Evolution Cycle</>
              )}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg border transition-colors ${
                showSettings
                  ? 'bg-violet-500/10 border-violet-500/20 text-violet-300'
                  : 'border-primary/10 text-muted-foreground hover:bg-primary/5'
              }`}
              aria-label="Toggle evolution settings"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button
              onClick={loadData}
              className="p-2 rounded-lg border border-primary/10 text-muted-foreground hover:bg-primary/5 transition-colors"
              aria-label="Refresh evolution data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Settings panel */}
          {showSettings && (
              <div
                className="animate-fade-slide-in overflow-hidden"
              >
                <div className="space-y-3 pt-3 border-t border-primary/10">
                  <ObjectiveEditor objective={objective} onChange={setObjective} />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor="evo-mutation">
                        Mutation Rate
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          id="evo-mutation"
                          type="range" min={5} max={50}
                          value={Math.round(mutationRate * 100)}
                          onChange={(e) => setMutationRate(Number(e.target.value) / 100)}
                          className="flex-1 h-1 accent-violet-500"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {Math.round(mutationRate * 100)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor="evo-variants">
                        Variants per Cycle
                      </label>
                      <select
                        id="evo-variants"
                        value={variants}
                        onChange={(e) => setVariants(Number(e.target.value))}
                        className="mt-1 w-full text-sm bg-primary/5 border border-primary/10 rounded-md px-2 py-1 text-foreground"
                      >
                        {[2, 3, 4, 5, 6, 8].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor="evo-threshold">
                        Improvement Threshold
                      </label>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          id="evo-threshold"
                          type="range" min={1} max={20}
                          value={Math.round(threshold * 100)}
                          onChange={(e) => setThreshold(Number(e.target.value) / 100)}
                          className="flex-1 h-1 accent-violet-500"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {Math.round(threshold * 100)}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor="evo-min-execs">
                        Min Executions Between
                      </label>
                      <select
                        id="evo-min-execs"
                        value={minExecs}
                        onChange={(e) => setMinExecs(Number(e.target.value))}
                        className="mt-1 w-full text-sm bg-primary/5 border border-primary/10 rounded-md px-2 py-1 text-foreground"
                      >
                        {[3, 5, 10, 15, 20, 30, 50].map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isSaving}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
                  >
                    {isSaving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    {t.agents.lab.save_settings}
                  </button>
                </div>
              </div>
            )}
        </div>
      </SectionCard>

      {/* Cycle history */}
      {cycles.length > 0 && (
        <SectionCard title="Evolution History" subtitle={`${cycles.length} cycle${cycles.length !== 1 ? 's' : ''}`}>
          <div className="space-y-1.5" role="list" aria-label="Evolution cycles">
            {cycles.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </SectionCard>
      )}

      {/* Empty state */}
      {cycles.length === 0 && !policy && (
        <div className="text-center py-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-violet-500/10 mb-3">
            <Sparkles className="w-7 h-7 text-violet-400/60" />
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">
            Self-improving personas
          </h3>
          <p className="text-xs text-muted-foreground/60 max-w-xs mx-auto leading-relaxed">
            Enable auto-evolution to continuously optimize this persona. After each batch of
            executions, variants are automatically generated, evaluated, and promoted if they
            outperform the current configuration.
          </p>
        </div>
      )}
    </div>
  );
}
