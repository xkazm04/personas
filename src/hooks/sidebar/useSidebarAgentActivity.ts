/**
 * Aggregates per-persona activity into a flat list for the sidebar orbit
 * dots on the Agents button. Each entry represents one currently-running
 * task tied to a specific persona, so the sidebar can show one dot per
 * task (not one dot per activity type aggregated across the app).
 *
 * Three sources are merged in this order of priority (driver of the color):
 *   1. `draft`  — a build/adoption session in a non-terminal phase (purple)
 *   2. `exec`   — a foreground or background execution running/queued (blue)
 *   3. `lab`    — an active lab run for that persona (orange)
 *
 * A single persona can appear multiple times if it has, say, both a draft
 * and an execution in flight — each renders as its own dot.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';

export type AgentActivityType = 'draft' | 'exec' | 'lab';

export interface AgentActivity {
  /** Stable key for React list reconciliation. */
  id: string;
  personaId: string;
  personaName: string;
  type: AgentActivityType;
  /** Tooltip label, e.g. "Testing agent", "Execution in progress". */
  label: string;
}

export function useSidebarAgentActivity(): AgentActivity[] {
  const {
    personas,
    buildSessions,
    isExecuting,
    executionPersonaId,
    backgroundExecutions,
    buildPhase,
    labRunningPersonaIds,
  } = useAgentStore(
    useShallow((s) => ({
      personas: s.personas,
      buildSessions: s.buildSessions,
      isExecuting: s.isExecuting,
      executionPersonaId: s.executionPersonaId,
      backgroundExecutions: s.backgroundExecutions,
      buildPhase: s.buildPhase,
      labRunningPersonaIds: s.labRunningPersonaIds,
    })),
  );

  return useMemo(() => {
    const result: AgentActivity[] = [];
    // Deduplicate per (personaId, type) so multiple sessions for the same
    // persona/type don't stack — we show one dot per activity class.
    const seen = new Set<string>();
    const push = (a: AgentActivity) => {
      const key = `${a.personaId}::${a.type}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(a);
    };
    const nameOf = (id: string) => personas.find((p) => p.id === id)?.name ?? 'Draft agent';

    // 1. Draft builds (purple) — one per active persona session.
    for (const sess of Object.values(buildSessions ?? {})) {
      if (!sess) continue;
      if (sess.phase === 'initializing' || sess.phase === 'promoted' || sess.phase === 'failed' || sess.phase === 'cancelled' || sess.phase === 'completed') continue;
      push({
        id: `draft:${sess.personaId}:${sess.sessionId}`,
        personaId: sess.personaId,
        personaName: nameOf(sess.personaId),
        type: 'draft',
        label: sess.phase === 'testing' ? 'Testing agent' : 'Draft in progress',
      });
    }

    // 2. Foreground execution (blue). Persisted via localStorage so a refresh
    // keeps the dot visible while the run is genuinely still active.
    if (isExecuting && executionPersonaId) {
      push({
        id: `exec:${executionPersonaId}:fg`,
        personaId: executionPersonaId,
        personaName: nameOf(executionPersonaId),
        type: 'exec',
        label: 'Execution in progress',
      });
    }

    // 3. Background executions (blue) — one per running/queued.
    for (const bg of backgroundExecutions ?? []) {
      if (bg.status !== 'running' && bg.status !== 'queued') continue;
      push({
        id: `exec:${bg.personaId}:${bg.executionId}`,
        personaId: bg.personaId,
        personaName: bg.personaName ?? nameOf(bg.personaId),
        type: 'exec',
        label: bg.status === 'queued' ? 'Execution queued' : 'Execution in progress',
      });
    }

    // 4. Lab runs (orange) — one per persona running any lab mode.
    for (const personaId of labRunningPersonaIds ?? []) {
      push({
        id: `lab:${personaId}`,
        personaId,
        personaName: nameOf(personaId),
        type: 'lab',
        label: 'Lab run in progress',
      });
    }

    // Suppress unused warning — buildPhase participates in the Zustand
    // subscription so dots re-render when the active session transitions
    // phase, even though we read the phase off `buildSessions` directly.
    void buildPhase;

    return result;
  }, [personas, buildSessions, isExecuting, executionPersonaId, backgroundExecutions, labRunningPersonaIds, buildPhase]);
}
