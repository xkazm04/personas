/**
 * Per-agent health check: the editor HealthBadge and the Arena herald.
 *
 * It grades by THE definition of agent health in `./agentHealth` — the same
 * one the weekly digest uses — so one agent gets one verdict on every surface.
 * Until 2026-10-30 this hook scored design feasibility instead
 * (`test_design_feasibility` plus a five-rule auto-fix proposal pipeline whose
 * only consumer, the health panel, was deleted in 2026-08); see the
 * `agentHealth.ts` header for why the telemetry definition won.
 *
 * Error policy: a failure of the telemetry pipeline fails the check
 * (`phase: 'error'`, Sentry breadcrumb). A best-effort sub-check failure
 * (config warnings) is an `undetermined` issue inside the result, handled in
 * `agentHealth.ts`. Never throw out of `runHealthCheck`.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealthCheck, HealthScore } from './types';
import { HEALTH_SCORING, computeHealthScore, computeAggregateHealthScore, makeIssueId } from './healthScoring';
import { assessAgentHealth } from './agentHealth';

// The pure scoring/identity helpers live in `./healthScoring` so the agent
// store's health slice can use them without importing this module, which pulls
// in `useAgentStore` and closes an import cycle. Re-exported here because this
// has always been their public address.
export { HEALTH_SCORING, computeHealthScore, computeAggregateHealthScore, makeIssueId };

// -- Hook return type -------------------------------------------------

export interface UseHealthCheckReturn {
  phase: 'idle' | 'running' | 'done' | 'error';
  result: PersonaHealthCheck | null;
  score: HealthScore | null;
  error: string | null;
  runHealthCheck: (persona: Persona) => Promise<PersonaHealthCheck | null>;
  reset: () => void;
}

// -- Hook -------------------------------------------------------------

export function useHealthCheck(): UseHealthCheckReturn {
  const [phase, setPhase] = useState<UseHealthCheckReturn['phase']>('idle');
  const [result, setResult] = useState<PersonaHealthCheck | null>(null);
  const score = useMemo(() => result ? computeHealthScore(result.result.issues) : null, [result]);
  const [error, setError] = useState<string | null>(null);
  // One latest-wins slot per hook instance: a newer run (or reset) makes every
  // in-flight run inert before it can write state.
  const latestRef = useRef<ReturnType<typeof createLatestWins> | null>(null);
  if (latestRef.current === null) latestRef.current = createLatestWins();
  const latest = latestRef.current;

  // A verdict belongs to the persona it was computed for. Both consumers (the
  // editor HealthBadge and the Arena herald) sit inside a component tree that is
  // NOT keyed by persona — PersonasPage renders one <PersonaEditor/> for every
  // selected id — so switching from agent A to agent B used to keep painting
  // A's "degraded · 65" under B's name until someone pressed Run again. The
  // hook remembers which persona it last checked and presents `idle` whenever
  // the app's selected persona is a different one; a stale in-flight run for A
  // that resolves after the switch lands in state but is never shown.
  const [checkedPersonaId, setCheckedPersonaId] = useState<string | null>(null);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersona?.id ?? null);
  const staleForSelection =
    checkedPersonaId !== null && selectedPersonaId !== null && selectedPersonaId !== checkedPersonaId;

  const runHealthCheck = useCallback(async (persona: Persona): Promise<PersonaHealthCheck | null> => {
    const gen = latest.next();
    setCheckedPersonaId(persona.id);
    setPhase('running');
    setResult(null);
    setError(null);

    try {
      const [check] = await assessAgentHealth([persona]);
      if (!latest.isCurrent(gen)) return null;
      if (!check) throw new Error('health assessment returned no result');

      setResult(check);
      setPhase('done');
      return check;
    } catch (err) {
      // The failure reaches the UI as `phase: 'error'`; the breadcrumb is the
      // durable evidence that the telemetry pipeline threw.
      silentCatch('useHealthCheck:run')(err);
      if (!latest.isCurrent(gen)) return null;
      // invokeWithTimeout rejects with a serialized AppError object, never an
      // Error, so `err instanceof Error ? … : String(err)` stored "[object Object]".
      const msg = extractMessage(err);
      setError(msg);
      setPhase('error');
      return null;
    }
  }, [latest]);

  const reset = useCallback(() => {
    latest.next();
    setCheckedPersonaId(null);
    setPhase('idle');
    setResult(null);
    setError(null);
  }, [latest]);

  if (staleForSelection) {
    return { phase: 'idle', result: null, score: null, error: null, runHealthCheck, reset };
  }
  return { phase, result, score, error, runHealthCheck, reset };
}
