import { useEffect, useRef, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { getTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

export const TEMPLATE_SAMPLE_INPUT: Record<string, object> = {
  'gmail-maestro': { mode: 'process_inbox', max_emails: 5, labels: ['inbox', 'unread'] },
  'code-reviewer': { repo: 'owner/repo', pr_number: 42 },
  'slack-standup': { channel: '#team-standup', lookback_hours: 24 },
  'security-auditor': { target_path: './src', scan_type: 'full' },
  'doc-writer': { source_path: './src', output_format: 'markdown' },
  'test-generator': { module_path: './src/utils/helpers.ts', framework: 'vitest' },
  'dep-updater': { manifest: 'package.json', check_security: true },
  'bug-triager': { issue_id: 'BUG-1234', source: 'github' },
  'data-monitor': { pipeline: 'etl-daily', check_interval_min: 5 },
};

export async function getSampleInput(personaName: string | undefined): Promise<string> {
  if (!personaName) return '{}';
  const catalog = await getTemplateCatalog();
  const match = catalog.find((t) => t.name === personaName);
  const data = match ? TEMPLATE_SAMPLE_INPUT[match.id] ?? {} : {};
  return JSON.stringify(data, null, 2);
}

export function formatTokens(tokens: number): string {
  if (tokens === 0) return '-';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

/**
 * Single source of truth for the persona execution list.
 * Fetches on mount / personaId change and auto-refreshes when isExecuting transitions false.
 * All callers share the same Zustand state — no local copies, no redundant API calls.
 */
export function useExecutionList(personaId: string): {
  executions: PersonaExecution[];
  loading: boolean;
  refresh: () => Promise<void>;
  typicalDurationMs: number | null;
} {
  const executions = useAgentStore((s) => s.executions);
  const loading = useAgentStore((s) => s.executionsLoading);
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

  return { executions, loading, refresh: () => refresh(personaId), typicalDurationMs };
}
