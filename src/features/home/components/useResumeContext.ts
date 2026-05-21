import { useEffect, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { getActiveTourSteps, getTourById } from '@/stores/slices/system/tourSlice';
import { silentCatch } from '@/lib/silentCatch';


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

// In-process pub/sub for the LAST_EDITED_KEY marker.
//
// The hook can't rely on the `storage` event because that only fires in
// *other* windows/tabs, not in the writer. In a single-window Tauri app
// every write is same-window, so without an explicit signal the hook
// wouldn't notice repeat edits to the same persona (no count change, no
// route change, no Zustand mutation). We keep the marker in localStorage
// (so it survives a reload) but layer a tiny module-level subscriber list
// on top so live components can re-read on every write.
type EditListener = () => void;
const editListeners = new Set<EditListener>();

function subscribeLastEdited(listener: EditListener): () => void {
  editListeners.add(listener);
  return () => { editListeners.delete(listener); };
}

function notifyLastEditedChange(): void {
  for (const l of editListeners) {
    try { l(); } catch (err) { silentCatch("features/home/components/useResumeContext:catch1")(err); }
  }
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

/**
 * Persist a "last edited persona" marker and notify any in-process
 * subscribers (the Resume banner hook) so they can re-read immediately,
 * even when the persona count hasn't changed.
 *
 * Call from the persona editor on save.
 */
export function markPersonaEdited(personaId: string): void {
  try {
    localStorage.setItem(LAST_EDITED_KEY, JSON.stringify({ personaId, at: Date.now() }));
  } catch (err) { silentCatch("features/home/components/useResumeContext:catch2")(err); }
  notifyLastEditedChange();
}

export function clearLastEdited(): void {
  try { localStorage.removeItem(LAST_EDITED_KEY); } catch (err) { silentCatch("features/home/components/useResumeContext:catch3")(err); }
  notifyLastEditedChange();
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

  // Re-read the LAST_EDITED_KEY marker whenever a write happens.
  //
  // Invariant (intentional, documented contract): the only signal that
  // causes a re-read is `markPersonaEdited`/`clearLastEdited` firing the
  // in-process subscriber list. We do NOT key off `personas.length` (the
  // old behavior), because editing the same persona twice in a row leaves
  // the count stable and would surface a stale name. The cross-tab
  // `storage` event isn't relevant for a single-window Tauri shell.
  const [lastEdited, setLastEdited] = useState<PersistedEdit | null>(() => readLastEdited());
  useEffect(() => subscribeLastEdited(() => setLastEdited(readLastEdited())), []);

  // 1. Failure (highest priority). Only count failures within FAILURE_MAX_AGE_MS.
  //    `executions` order is not guaranteed to be sorted by recency, so we
  //    explicitly pick the most recent failure rather than `find()` which
  //    would return whichever happened to be first in the array. We also
  //    clamp negative age diffs (future-dated created_at from clock skew)
  //    so they don't sneak past the FAILURE_MAX_AGE_MS check.
  const now = Date.now();
  const recentFailure = executions
    .map((e) => {
      if (e.status !== 'failed') return null;
      const ts = e.created_at ? Date.parse(e.created_at) : NaN;
      if (!Number.isFinite(ts)) return null;
      const age = Math.max(0, now - ts);
      if (age >= FAILURE_MAX_AGE_MS) return null;
      return { execution: e, ts };
    })
    .filter((x): x is { execution: typeof executions[number]; ts: number } => x !== null)
    .sort((a, b) => b.ts - a.ts)[0]?.execution;
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
