import { useEffect, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { getActiveTourSteps, getTourById } from '@/stores/slices/system/tourSlice';

/**
 * A single, ranked "resume" signal surfaced on Home above HeroHeader.
 *
 * Ranking (highest priority first):
 *   1. `failure` — a fresh failed execution within the last 24h. The user
 *      probably wants to investigate this immediately; it outranks edits.
 *   2. `tour`    — a tour was started but never finished (and is currently
 *      paused, i.e. `tourActive=false`).
 *   3. `edit`    — the most recently edited persona, if it still exists.
 *
 * `null` means the user has no signal worth surfacing — Home renders
 * nothing extra. The hook reads existing store state only; no new schema
 * is introduced, no IPC calls are issued.
 */
export type ResumeContext =
  | {
      kind: 'failure';
      personaId: string;
      personaName: string;
      executionId: string;
    }
  | {
      kind: 'tour';
      tourId: string;
      tourTitle: string;
      stepTitle: string;
      stepIndex: number;
      totalSteps: number;
    }
  | {
      kind: 'edit';
      personaId: string;
      personaName: string;
    };

const LAST_EDITED_KEY = 'personas:last-edited-persona';
const LAST_EDITED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FAILURE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

interface PersistedEdit {
  personaId: string;
  at: number;
}

export function readLastEdited(): PersistedEdit | null {
  try {
    const raw = localStorage.getItem(LAST_EDITED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEdit;
    if (typeof parsed?.personaId !== 'string' || typeof parsed?.at !== 'number') return null;
    if (Date.now() - parsed.at > LAST_EDITED_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a "last edited persona" marker. Call from persona editor on save. */
export function markPersonaEdited(personaId: string): void {
  try {
    localStorage.setItem(LAST_EDITED_KEY, JSON.stringify({ personaId, at: Date.now() }));
  } catch {
    /* storage full or unavailable */
  }
}

export function clearLastEdited(): void {
  try { localStorage.removeItem(LAST_EDITED_KEY); } catch { /* best-effort */ }
}

export function useResumeContext(): ResumeContext | null {
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourActiveTourId = useSystemStore((s) => s.tourActiveTourId);
  const tourStepCompleted = useSystemStore((s) => s.tourStepCompleted);
  const tourCurrentStepIndex = useSystemStore((s) => s.tourCurrentStepIndex);
  const tourDismissed = useSystemStore((s) => s.tourDismissed);
  const tourCompletionMap = useSystemStore((s) => s.tourCompletionMap);
  const personas = useAgentStore((s) => s.personas);
  const executions = useAgentStore((s) => s.executions);

  // Re-read localStorage when the dependencies change, since markPersonaEdited
  // mutates a separate channel.
  const [lastEdited, setLastEdited] = useState<PersistedEdit | null>(() => readLastEdited());
  useEffect(() => {
    setLastEdited(readLastEdited());
  }, [personas.length]);

  // 1. Failure (highest priority). Only count failures within FAILURE_MAX_AGE_MS.
  const recentFailure = executions.find((e) => {
    if (e.status !== 'failed') return false;
    const ts = e.created_at ? Date.parse(e.created_at) : NaN;
    return Number.isFinite(ts) && Date.now() - ts < FAILURE_MAX_AGE_MS;
  });
  if (recentFailure) {
    const persona = personas.find((p) => p.id === recentFailure.persona_id);
    return {
      kind: 'failure',
      personaId: recentFailure.persona_id,
      personaName: persona?.name ?? 'agent',
      executionId: recentFailure.id,
    };
  }

  // 2. Unfinished tour. Show only when paused (tourActive=false) so we don't
  //    duplicate the GuidedTour panel that's already on screen.
  const tourCompleted = tourCompletionMap[tourActiveTourId] ?? false;
  if (!tourActive && !tourCompleted && !tourDismissed) {
    const steps = getActiveTourSteps(tourActiveTourId);
    const tourDef = getTourById(tourActiveTourId);
    const completedCount = steps.filter((s) => tourStepCompleted[s.id]).length;
    if (steps.length > 0 && completedCount > 0 && completedCount < steps.length) {
      const currentStep = steps[tourCurrentStepIndex] ?? steps[completedCount];
      if (currentStep && tourDef) {
        return {
          kind: 'tour',
          tourId: tourActiveTourId,
          tourTitle: tourDef.title,
          stepTitle: currentStep.title,
          stepIndex: completedCount,
          totalSteps: steps.length,
        };
      }
    }
  }

  // 3. Last edited persona, if still in the store.
  if (lastEdited) {
    const persona = personas.find((p) => p.id === lastEdited.personaId);
    if (persona) {
      return { kind: 'edit', personaId: persona.id, personaName: persona.name };
    }
  }

  return null;
}
