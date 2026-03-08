import { useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Editor tab to navigate to for this item */
  tab?: string;
}

export interface OnboardingChecklist {
  items: ChecklistItem[];
  completed: number;
  total: number;
  /** 0-100 */
  score: number;
  allDone: boolean;
}

/**
 * Derives agent setup completeness from existing store data.
 * Returns a checklist with per-item completion and an overall score.
 */
export function useOnboardingChecklist(personaId: string | undefined): OnboardingChecklist {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const triggerCount = usePersonaStore((s) => personaId ? s.personaTriggerCounts[personaId] : undefined);
  const lastRun = usePersonaStore((s) => personaId ? s.personaLastRun[personaId] : undefined);

  return useMemo(() => {
    if (!selectedPersona || selectedPersona.id !== personaId) {
      return { items: [], completed: 0, total: 0, score: 0, allDone: true };
    }

    const hasPrompt = !!(selectedPersona.structured_prompt || selectedPersona.system_prompt);
    const hasModel = !!selectedPersona.model_profile;
    const hasTools = selectedPersona.tools.length > 0;
    const hasTrigger = (triggerCount ?? 0) > 0 || selectedPersona.triggers.length > 0;
    const hasConnector = (() => {
      try {
        if (!selectedPersona.design_context) return false;
        const ctx = JSON.parse(selectedPersona.design_context) as Record<string, unknown>;
        const links = ctx.credentialLinks as Record<string, string> | undefined;
        return !!links && Object.keys(links).length > 0;
      } catch {
        return false;
      }
    })();
    const hasTestRun = !!lastRun;

    const items: ChecklistItem[] = [
      { id: 'prompt', label: 'Configure prompt', done: hasPrompt, tab: 'prompt' },
      { id: 'model', label: 'Select model', done: hasModel, tab: 'use-cases' },
      { id: 'tools', label: 'Assign a tool', done: hasTools, tab: 'connectors' },
      { id: 'connector', label: 'Link a connector', done: hasConnector, tab: 'connectors' },
      { id: 'trigger', label: 'Create a trigger', done: hasTrigger, tab: 'connectors' },
      { id: 'test', label: 'Run first test', done: hasTestRun, tab: 'lab' },
    ];

    const completed = items.filter((i) => i.done).length;
    const total = items.length;
    const score = Math.round((completed / total) * 100);

    return { items, completed, total, score, allDone: completed === total };
  }, [selectedPersona, personaId, triggerCount, lastRun]);
}

/**
 * Lightweight version for sidebar cards — only needs personaId, no selectedPersona.
 */
export function useOnboardingScore(personaId: string): number {
  const personas = usePersonaStore((s) => s.personas);
  const triggerCount = usePersonaStore((s) => s.personaTriggerCounts[personaId]);
  const lastRun = usePersonaStore((s) => s.personaLastRun[personaId]);

  return useMemo(() => {
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return 100; // Don't show ring if persona not found

    let done = 0;
    const total = 6;

    if (persona.structured_prompt || persona.system_prompt) done++;
    if (persona.model_profile) done++;
    // Can't check tools/connectors without detail fetch — estimate from design_context
    try {
      if (persona.design_context) {
        const ctx = JSON.parse(persona.design_context) as Record<string, unknown>;
        const links = ctx.credentialLinks as Record<string, string> | undefined;
        if (links && Object.keys(links).length > 0) done++; // connector
        const useCases = ctx.useCases as unknown[] | undefined;
        if (useCases && useCases.length > 0) done++; // tools proxy (use cases imply tools)
      }
    } catch { /* intentional */ }
    if ((triggerCount ?? 0) > 0) done++;
    if (lastRun) done++;

    return Math.round((done / total) * 100);
  }, [personas, personaId, triggerCount, lastRun]);
}
