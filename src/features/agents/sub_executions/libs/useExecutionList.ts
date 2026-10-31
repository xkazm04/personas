import { useEffect, useRef, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import type { DesignUseCase } from '@/lib/types/frontendTypes';

/**
 * The first-run "Try it" seed: the persona's own declared input, as the JSON
 * text the runner expects. Takes the first runnable use case (enabled, not
 * documentation-only) that declares a `sample_input`, else one built from its
 * `input_schema` defaults; `'{}'` when nothing declares an input.
 */
export function deriveSampleInput(useCases: readonly DesignUseCase[]): string {
  for (const uc of useCases) {
    if (uc.enabled === false || uc.execution_mode === 'non_executable') continue;
    if (uc.sample_input && Object.keys(uc.sample_input).length > 0) {
      return JSON.stringify(uc.sample_input, null, 2);
    }
    const fromSchema: Record<string, unknown> = {};
    for (const field of uc.input_schema ?? []) {
      if (field.default !== undefined) fromSchema[field.key] = field.default;
    }
    if (Object.keys(fromSchema).length > 0) return JSON.stringify(fromSchema, null, 2);
  }
  return '{}';
}

/**
 * Single source of truth for the persona execution list.
 * Fetches on mount / personaId change and auto-refreshes when isExecuting transitions false.
 * All callers share the same Zustand state — no local copies, no redundant API calls.
 */
export function useExecutionList(personaId: string): {
  executions: ExecutionListItem[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  typicalDurationMs: number | null;
} {
  const executions = useAgentStore((s) => s.executions);
  const loading = useAgentStore((s) => s.executionsLoading);
  const error = useAgentStore((s) => s.executionsError);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const fetchExecutions = useAgentStore((s) => s.fetchExecutions);

  const prevIsExecutingRef = useRef(isExecuting);

  // Fetch on mount and when personaId changes
  useEffect(() => {
    if (personaId) fetchExecutions(personaId);
  }, [personaId, fetchExecutions]);

  // Auto-refresh when isExecuting transitions true → false
  useEffect(() => {
    if (prevIsExecutingRef.current && !isExecuting && personaId) {
      fetchExecutions(personaId);
    }
    prevIsExecutingRef.current = isExecuting;
  }, [isExecuting, personaId, fetchExecutions]);

  // Derive typical duration from the shared execution list (median of completed runs)
  const typicalDurationMs = useMemo(() => {
    const durations = executions
      .filter((e): e is typeof e & { duration_ms: number } =>
        e.persona_id === personaId &&
        e.status === 'completed' &&
        typeof e.duration_ms === 'number' &&
        e.duration_ms > 0,
      )
      .slice(0, 20)
      .map((e) => e.duration_ms);
    if (durations.length === 0) return null;
    durations.sort((a, b) => a - b);
    return durations[Math.floor(durations.length / 2)] ?? null;
  }, [executions, personaId]);

  const refresh = useAgentStore((s) => s.fetchExecutions);

  return { executions, loading, error, refresh: () => refresh(personaId), typicalDurationMs };
}
