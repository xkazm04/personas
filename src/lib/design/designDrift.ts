import type { AgentIR } from '@/lib/types/designTypes';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type DriftKind = 'error_pattern' | 'tool_mismatch' | 'timeout' | 'cost_overrun' | 'repeated_failure';

export interface DesignDriftEvent {
  id: string;
  personaId: string;
  personaName: string;
  kind: DriftKind;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  suggestion: string;
  /** Which design section should be updated */
  targetSection: 'errorHandling' | 'toolGuidance' | 'instructions' | 'identity';
  executionId: string;
  dismissed: boolean;
  createdAt: string;
}

// â”€â”€ Detection from execution summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ExecutionSummary {
  status: string;
  durationMs: number | null;
  costUsd: number;
  errorMessage: string | null;
  toolSteps: string | null;
  executionId: string;
}

interface PersonaDesignContext {
  personaId: string;
  personaName: string;
  timeoutMs: number;
  maxBudgetUsd: number | null;
  lastDesignResult: AgentIR | null;
  recentFailureCount: number;
}

const STORAGE_KEY = 'dolla:design-drift';

export function loadDriftEvents(): DesignDriftEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DesignDriftEvent[];
  } catch {
    return [];
  }
}

export function saveDriftEvents(events: DesignDriftEvent[]): void {
  try {
    // Keep only the most recent 50 events
    const trimmed = events.slice(-50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage full
  }
}

function makeId(): string {
  return `drift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Analyze a completed execution against the persona's design expectations.
 * Returns drift events when divergence exceeds thresholds.
 */
export function detectDesignDrift(
  exec: ExecutionSummary,
  ctx: PersonaDesignContext,
): DesignDriftEvent[] {
  const events: DesignDriftEvent[] = [];
  const now = new Date().toISOString();
  const base = {
    personaId: ctx.personaId,
    personaName: ctx.personaName,
    executionId: exec.executionId,
    dismissed: false,
    createdAt: now,
  };

  // 1. Error pattern detection â€” failed execution with error message
  if (exec.status === 'failed' && exec.errorMessage) {
    const errorLower = exec.errorMessage.toLowerCase();
    const isToolError = /tool.*fail|tool.*error|tool_use|function.*error/i.test(errorLower);
    const isTimeoutError = /timeout|timed out|deadline/i.test(errorLower);
    const isApiError = /api.*error|rate.?limit|401|403|429|500|502|503/i.test(errorLower);

    if (isToolError) {
      events.push({
        ...base,
        id: makeId(),
        kind: 'tool_mismatch',
        severity: 'high',
        title: 'Tool call failure detected',
        description: `Execution failed with tool error: "${truncate(exec.errorMessage, 120)}"`,
        suggestion: 'Update toolGuidance to add error recovery instructions or remove the failing tool.',
        targetSection: 'toolGuidance',
      });
    } else if (isTimeoutError) {
      events.push({
        ...base,
        id: makeId(),
        kind: 'timeout',
        severity: 'medium',
        title: 'Execution timeout detected',
        description: `Agent timed out: "${truncate(exec.errorMessage, 120)}"`,
        suggestion: 'Increase timeout_ms or simplify instructions to reduce processing time.',
        targetSection: 'instructions',
      });
    } else if (isApiError) {
      events.push({
        ...base,
        id: makeId(),
        kind: 'error_pattern',
        severity: 'high',
        title: 'API error pattern detected',
        description: `API-related failure: "${truncate(exec.errorMessage, 120)}"`,
        suggestion: 'Add rate limiting guidance or retry instructions to errorHandling section.',
        targetSection: 'errorHandling',
      });
    } else {
      events.push({
        ...base,
        id: makeId(),
        kind: 'error_pattern',
        severity: 'medium',
        title: 'Execution failure detected',
        description: `Failed with: "${truncate(exec.errorMessage, 120)}"`,
        suggestion: 'Review errorHandling section and add handling for this failure pattern.',
        targetSection: 'errorHandling',
      });
    }
  }

  // 2. Timeout drift â€” execution took longer than 80% of the configured timeout
  if (exec.durationMs != null && ctx.timeoutMs > 0) {
    const ratio = exec.durationMs / ctx.timeoutMs;
    if (ratio > 0.8 && exec.status === 'completed') {
      events.push({
        ...base,
        id: makeId(),
        kind: 'timeout',
        severity: 'low',
        title: 'Near-timeout execution',
        description: `Execution took ${Math.round(exec.durationMs / 1000)}s (${Math.round(ratio * 100)}% of timeout).`,
        suggestion: 'Consider increasing timeout or simplifying the agent\'s task scope in instructions.',
        targetSection: 'instructions',
      });
    }
  }

  // 3. Cost overrun â€” execution cost exceeds budget threshold
  if (ctx.maxBudgetUsd != null && ctx.maxBudgetUsd > 0 && exec.costUsd > 0) {
    const costRatio = exec.costUsd / ctx.maxBudgetUsd;
    if (costRatio > 0.5) {
      events.push({
        ...base,
        id: makeId(),
        kind: 'cost_overrun',
        severity: costRatio > 0.8 ? 'high' : 'medium',
        title: 'High execution cost',
        description: `Single execution cost $${exec.costUsd.toFixed(4)} (${Math.round(costRatio * 100)}% of budget).`,
        suggestion: 'Tighten instructions to reduce token usage, or consider using a smaller model.',
        targetSection: 'instructions',
      });
    }
  }

  // 4. Repeated failure detection
  if (exec.status === 'failed' && ctx.recentFailureCount >= 2) {
    events.push({
      ...base,
      id: makeId(),
      kind: 'repeated_failure',
      severity: 'high',
      title: `Repeated failures (${ctx.recentFailureCount + 1} consecutive)`,
      description: 'This agent has failed multiple times in a row. The design may need significant revision.',
      suggestion: 'Consider running a new design analysis to rebuild the agent configuration.',
      targetSection: 'instructions',
    });
  }

  return events;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

// â”€â”€ Drift kind metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const DRIFT_KIND_META: Record<DriftKind, { label: string; bgClass: string; borderClass: string; textClass: string }> = {
  error_pattern: { label: 'Error Pattern', bgClass: 'bg-rose-500/10', borderClass: 'border-rose-500/20', textClass: 'text-rose-400' },
  tool_mismatch: { label: 'Tool Issue', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/20', textClass: 'text-amber-400' },
  timeout: { label: 'Timeout Risk', bgClass: 'bg-orange-500/10', borderClass: 'border-orange-500/20', textClass: 'text-orange-400' },
  cost_overrun: { label: 'Cost Alert', bgClass: 'bg-violet-500/10', borderClass: 'border-violet-500/20', textClass: 'text-violet-400' },
  repeated_failure: { label: 'Repeated Failure', bgClass: 'bg-red-500/10', borderClass: 'border-red-500/20', textClass: 'text-red-400' },
};
