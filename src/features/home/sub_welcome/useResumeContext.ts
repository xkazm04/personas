import { useEffect, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { createDedupedStateStorage } from '@/stores/util/dedupedStorage';
import { useTourStore } from '@/stores/tourStore';
import { getLocalizedTourById, getLocalizedTourSteps } from '@/stores/slices/system/tourSlice';
import { useTranslation } from '@/i18n/useTranslation';
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
      /**
       * Stable identity for the acknowledgement marker. Equal to `executionId`
       * when the failure came from the executions list; for a failure derived
       * from the cross-persona run sample (which carries no row id) it is
       * `persona@created_at`, unique for the same reason a run is.
       */
      failureKey: string;
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
const ACKED_FAILURES_KEY = 'personas:resume-acked-failures';
const LAST_EDITED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FAILURE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

interface PersistedEdit {
  personaId: string;
  at: number;
}

interface AckedFailure {
  key: string;
  at: number;
}

/**
 * The sanctioned Web Storage door (client-state-persistence): fail-soft on a
 * full profile or private mode, and reported once per key instead of per call.
 * The older markers in this file predate it and still touch the raw API.
 */
const ackStorage = createDedupedStateStorage();

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
    try { l(); } catch (err) { silentCatch("features/home/sub_welcome/useResumeContext:catch1")(err); }
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
  } catch (err) { silentCatch("features/home/sub_welcome/useResumeContext:catch2")(err); }
  notifyLastEditedChange();
}

export function clearLastEdited(): void {
  try { localStorage.removeItem(LAST_EDITED_KEY); } catch (err) { silentCatch("features/home/sub_welcome/useResumeContext:catch3")(err); }
  notifyLastEditedChange();
}

/**
 * Acknowledged failures.
 *
 * Dismissing a failure banner used to be a documented no-op - the comment said
 * failures dismiss themselves once acknowledged via the activity tab, which no
 * code did, so the X on the highest-ranked signal did nothing at all. The
 * marker is local and self-pruning: entries older than the failure window can
 * never match a live candidate again, so they are dropped on read.
 */
export function readAckedFailures(): AckedFailure[] {
  try {
    const raw = ackStorage.getItem(ACKED_FAILURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (e): e is AckedFailure =>
        typeof (e as AckedFailure)?.key === 'string' &&
        typeof (e as AckedFailure)?.at === 'number' &&
        now - (e as AckedFailure).at < FAILURE_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

export function ackFailure(key: string): void {
  try {
    const next = [...readAckedFailures().filter((e) => e.key !== key), { key, at: Date.now() }];
    ackStorage.setItem(ACKED_FAILURES_KEY, JSON.stringify(next));
  } catch (err) { silentCatch("features/home/sub_welcome/useResumeContext:ackFailure")(err); }
  notifyLastEditedChange();
}

export function clearAckedFailures(): void {
  try { ackStorage.removeItem(ACKED_FAILURES_KEY); } catch (err) { silentCatch("features/home/sub_welcome/useResumeContext:clearAcked")(err); }
  notifyLastEditedChange();
}

interface FailureCandidate {
  personaId: string;
  failureKey: string;
  executionId: string;
  ts: number;
}

/**
 * Recent failures from both sources, newest first.
 *
 * `useAgentStore.executions` is a PER-PERSONA list that only the editor's
 * activity tab ever loads, so on Home it is almost always empty and the
 * highest-ranked resume signal was structurally dead. The Overview spine's
 * `homeRunsSample` is the cross-persona sample Home already primes, so it is
 * the source that actually has data on a landing surface; the executions list
 * still wins when it is populated because it carries a real row id.
 */
export function collectRecentFailures(
  executions: ReadonlyArray<{ id: string; status: string; persona_id: string; created_at?: string | null }>,
  runs: ReadonlyArray<{ persona_id: string; status: string; created_at: string }> | null,
  now: number,
): FailureCandidate[] {
  const out: FailureCandidate[] = [];
  const fresh = (raw: string | null | undefined): number | null => {
    const ts = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(ts)) return null;
    // Clamp future-dated rows (clock skew) so they cannot slip past the window.
    if (Math.max(0, now - ts) >= FAILURE_MAX_AGE_MS) return null;
    return ts;
  };
  for (const e of executions) {
    if (e.status !== 'failed') continue;
    const ts = fresh(e.created_at);
    if (ts == null) continue;
    out.push({ personaId: e.persona_id, failureKey: e.id, executionId: e.id, ts });
  }
  const seen = new Set(out.map((c) => `${c.personaId}@${new Date(c.ts).toISOString()}`));
  for (const r of runs ?? []) {
    if (r.status !== 'failed') continue;
    const ts = fresh(r.created_at);
    if (ts == null) continue;
    const key = `${r.persona_id}@${r.created_at}`;
    if (seen.has(key)) continue;
    out.push({ personaId: r.persona_id, failureKey: key, executionId: '', ts });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export function useResumeContext(): ResumeContext | null {
  // The tour title / step title surfaced below are translated copy resolved
  // from `onboarding.tours`, so this hook needs the live bundle.
  const { t } = useTranslation();
  const tourActive = useTourStore((s) => s.tourActive);
  const tourActiveTourId = useTourStore((s) => s.tourActiveTourId);
  const tourStepCompleted = useTourStore((s) => s.tourStepCompleted);
  const tourCurrentStepIndex = useTourStore((s) => s.tourCurrentStepIndex);
  const tourDismissed = useTourStore((s) => s.tourDismissed);
  const tourCompletionMap = useTourStore((s) => s.tourCompletionMap);
  const personas = useAgentStore((s) => s.personas);
  const executions = useAgentStore((s) => s.executions);
  const runsSample = useOverviewStore((s) => s.homeRunsSample);

  // Re-read the LAST_EDITED_KEY marker whenever a write happens.
  //
  // Invariant (intentional, documented contract): the only signal that
  // causes a re-read is `markPersonaEdited`/`clearLastEdited` firing the
  // in-process subscriber list. We do NOT key off `personas.length` (the
  // old behavior), because editing the same persona twice in a row leaves
  // the count stable and would surface a stale name. The cross-tab
  // `storage` event isn't relevant for a single-window Tauri shell.
  const [lastEdited, setLastEdited] = useState<PersistedEdit | null>(() => readLastEdited());
  const [acked, setAcked] = useState<AckedFailure[]>(() => readAckedFailures());
  useEffect(
    () =>
      subscribeLastEdited(() => {
        setLastEdited(readLastEdited());
        setAcked(readAckedFailures());
      }),
    [],
  );

  // Warm the cross-persona run sample. TTL-guarded and deduped in the spine
  // slice, and it is the same fetch the since-you-left briefing triggers - so
  // this adds no IPC on a Home surface that already mounts either of them.
  useEffect(() => {
    useOverviewStore.getState().primeHomeSpine();
  }, []);

  // 1. Failure (highest priority). Only count failures within FAILURE_MAX_AGE_MS.
  //    `executions` order is not guaranteed to be sorted by recency, so we
  //    explicitly pick the most recent failure rather than `find()` which
  //    would return whichever happened to be first in the array. We also
  //    clamp negative age diffs (future-dated created_at from clock skew)
  //    so they don't sneak past the FAILURE_MAX_AGE_MS check.
  const now = Date.now();
  const ackedKeys = new Set(acked.map((a) => a.key));
  const recentFailure = collectRecentFailures(executions, runsSample, now).find(
    (c) => !ackedKeys.has(c.failureKey),
  );
  if (recentFailure) {
    const persona = personas.find((p) => p.id === recentFailure.personaId);
    return {
      kind: 'failure',
      personaId: recentFailure.personaId,
      personaName: persona?.name ?? 'agent',
      executionId: recentFailure.executionId,
      failureKey: recentFailure.failureKey,
    };
  }

  // 2. Unfinished tour. Show only when paused (tourActive=false) so we don't
  //    duplicate the GuidedTour panel that's already on screen.
  const tourCompleted = tourCompletionMap[tourActiveTourId] ?? false;
  if (!tourActive && !tourCompleted && !tourDismissed) {
    const steps = getLocalizedTourSteps(t, tourActiveTourId);
    const tourDef = getLocalizedTourById(t, tourActiveTourId);
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
