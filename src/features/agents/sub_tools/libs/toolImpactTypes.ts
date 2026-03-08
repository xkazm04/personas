import type { ToolUsageSummary } from '@/lib/types/types';

/** A use case that references (has been executed with) a given tool */
export interface ToolUseCaseRef {
  useCaseId: string;
  title: string;
  executionCount: number;
}

/** A tool frequently used alongside the selected tool */
export interface CoUsedTool {
  toolName: string;
  coOccurrences: number;
}

/** Complete impact data for a single tool */
export interface ToolImpactData {
  /** Use cases that have executed this tool */
  useCaseRefs: ToolUseCaseRef[];
  /** Usage stats from the store */
  usage: ToolUsageSummary | null;
  /** Estimated average cost per invocation (USD) */
  avgCostPerInvocation: number | null;
  /** Total cost attributed to this tool (USD) */
  totalCost: number;
  /** Whether the required credential is linked */
  credentialLinked: boolean;
  /** Whether a credential is required at all */
  credentialRequired: boolean;
  /** Credential service type */
  credentialType: string | null;
  /** Tools commonly used alongside this one */
  coUsedTools: CoUsedTool[];
}

interface ToolStepEntry {
  tool_name?: string;
}

/**
 * Parse tool_steps JSON from a PersonaExecution.
 * Returns an array of unique tool names used in that execution.
 */
export function parseToolNames(toolStepsJson: string | null): string[] {
  if (!toolStepsJson) return [];
  try {
    const steps: ToolStepEntry[] = JSON.parse(toolStepsJson);
    if (!Array.isArray(steps)) return [];
    const names = new Set<string>();
    for (const step of steps) {
      if (step.tool_name) names.add(step.tool_name);
    }
    return Array.from(names);
  } catch {
    // intentional: non-critical — JSON parse fallback
    return [];
  }
}

/**
 * Parse design_context JSON to extract use case titles keyed by ID.
 */
export function parseUseCaseTitles(designContext: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!designContext) return map;
  try {
    const ctx = JSON.parse(designContext);
    const useCases = ctx?.use_cases ?? ctx?.useCases ?? [];
    if (!Array.isArray(useCases)) return map;
    for (const uc of useCases) {
      if (uc.id && (uc.title || uc.name)) {
        map.set(uc.id, uc.title || uc.name);
      }
    }
  } catch {
    // intentional: non-critical — JSON parse fallback (design_context may have a different shape)
  }
  return map;
}
