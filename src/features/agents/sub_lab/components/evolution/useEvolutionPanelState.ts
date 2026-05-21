import { useState, useCallback, useEffect, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import * as evolutionApi from '@/api/agents/evolution';
import type { EvolutionPolicy } from '@/lib/bindings/EvolutionPolicy';
import type { EvolutionCycle } from '@/lib/bindings/EvolutionCycle';
import type { FitnessObjective } from '@/lib/bindings/FitnessObjective';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

export interface EvolutionPanelState {
  personaId: string | undefined;
  policy: EvolutionPolicy | null;
  cycles: EvolutionCycle[];
  isLoading: boolean;
  isSaving: boolean;
  isTriggering: boolean;
  eligible: boolean;
  isEnabled: boolean;
  showSettings: boolean;
  setShowSettings: (open: boolean) => void;
  mutationRate: number;
  setMutationRate: (n: number) => void;
  variants: number;
  setVariants: (n: number) => void;
  threshold: number;
  setThreshold: (n: number) => void;
  minExecs: number;
  setMinExecs: (n: number) => void;
  objective: FitnessObjective;
  setObjective: (obj: FitnessObjective) => void;
  loadData: () => Promise<void>;
  handleToggle: () => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  handleTriggerCycle: () => Promise<void>;
}

export function useEvolutionPanelState(): EvolutionPanelState {
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
          }
        } catch (err) { silentCatch("features/agents/sub_lab/components/evolution/useEvolutionPanelState:catch1")(err); }
      }
    } catch (err) { silentCatch("features/agents/sub_lab/components/evolution/useEvolutionPanelState:catch2")(err); } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggle = useCallback(async () => {
    if (!personaId) return;
    setIsSaving(true);
    try {
      const newEnabled = !policy?.enabled;
      const updated = await evolutionApi.toggleEvolution(personaId, newEnabled);
      setPolicy(updated);
      addToast(newEnabled ? 'Auto-evolution enabled' : 'Auto-evolution disabled', 'success');
    } catch (err: unknown) {
      addToast(`Failed to toggle: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  }, [personaId, policy?.enabled, addToast]);

  const handleSaveSettings = useCallback(async () => {
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
  }, [personaId, objective, mutationRate, variants, threshold, minExecs, addToast]);

  const handleTriggerCycle = useCallback(async () => {
    if (!personaId) return;
    setIsTriggering(true);
    try {
      const cycle = await evolutionApi.triggerCycle(personaId);
      setCycles((prev) => [cycle, ...prev]);
      addToast('Evolution cycle started', 'success');

      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      pollRef.current = setInterval(async () => {
        const updated = await evolutionApi.listCycles(personaId, 1).catch((e) => {
          silentCatch('lab:evolution-poll-cycles')(e);
          return [] as EvolutionCycle[];
        });
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
  }, [personaId, addToast, loadData, t.agents.lab.objective_fallback_toast]);

  return {
    personaId,
    policy,
    cycles,
    isLoading,
    isSaving,
    isTriggering,
    eligible,
    isEnabled: policy?.enabled ?? false,
    showSettings,
    setShowSettings,
    mutationRate, setMutationRate,
    variants, setVariants,
    threshold, setThreshold,
    minExecs, setMinExecs,
    objective, setObjective,
    loadData,
    handleToggle,
    handleSaveSettings,
    handleTriggerCycle,
  };
}
