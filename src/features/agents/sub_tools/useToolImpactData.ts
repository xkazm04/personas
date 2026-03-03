import { useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import type { ToolUsageSummary } from '@/lib/types/types';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

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
function parseToolNames(toolStepsJson: string | null): string[] {
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
    return [];
  }
}

/**
 * Parse design_context JSON to extract use case titles keyed by ID.
 */
function parseUseCaseTitles(designContext: string | null): Map<string, string> {
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
    // design_context may not be valid JSON or may have a different shape
  }
  return map;
}

/**
 * Hook that computes impact analysis data for all tools.
 * Returns a Map keyed by tool name for O(1) lookup.
 */
export function useToolImpactData(): Map<string, ToolImpactData> {
  const executions = usePersonaStore((s) => s.executions);
  const toolUsageSummary = usePersonaStore((s) => s.toolUsageSummary);
  const credentials = usePersonaStore((s) => s.credentials);
  const credentialTypeSet = useMemo(() => {
    const set = new Set<string>();
    credentials.forEach((c) => set.add(c.service_type));
    return set;
  }, [credentials]);
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const designContext = selectedPersona?.design_context ?? null;

  return useMemo(() => {
    const result = new Map<string, ToolImpactData>();
    const useCaseTitles = parseUseCaseTitles(designContext);

    // Index: tool_name -> usage summary
    const usageMap = new Map<string, ToolUsageSummary>();
    for (const s of toolUsageSummary) usageMap.set(s.tool_name, s);

    // Parse all executions to build:
    // 1. tool -> use-case references
    // 2. tool -> co-used tools
    // 3. tool -> cost attribution
    const toolUseCaseMap = new Map<string, Map<string, number>>(); // tool -> (useCaseId -> count)
    const toolCoMap = new Map<string, Map<string, number>>();      // tool -> (coTool -> count)
    const toolCostMap = new Map<string, { totalCost: number; invocations: number }>();

    for (const exec of executions as PersonaExecution[]) {
      const toolNames = parseToolNames(exec.tool_steps);
      if (toolNames.length === 0) continue;

      // Cost attribution: distribute execution cost equally across tools
      const costPerTool = toolNames.length > 0 ? exec.cost_usd / toolNames.length : 0;

      for (const toolName of toolNames) {
        // Use case references
        if (exec.use_case_id) {
          if (!toolUseCaseMap.has(toolName)) toolUseCaseMap.set(toolName, new Map());
          const ucMap = toolUseCaseMap.get(toolName)!;
          ucMap.set(exec.use_case_id, (ucMap.get(exec.use_case_id) ?? 0) + 1);
        }

        // Co-used tools
        if (!toolCoMap.has(toolName)) toolCoMap.set(toolName, new Map());
        const coMap = toolCoMap.get(toolName)!;
        for (const other of toolNames) {
          if (other !== toolName) {
            coMap.set(other, (coMap.get(other) ?? 0) + 1);
          }
        }

        // Cost attribution
        if (!toolCostMap.has(toolName)) toolCostMap.set(toolName, { totalCost: 0, invocations: 0 });
        const cost = toolCostMap.get(toolName)!;
        cost.totalCost += costPerTool;
        cost.invocations += 1;
      }
    }

    // Build the final data structure for each known tool
    const allToolNames = new Set([
      ...usageMap.keys(),
      ...toolUseCaseMap.keys(),
      ...toolCoMap.keys(),
    ]);

    // Also include tools from the persona's assigned tools
    if (selectedPersona?.tools) {
      for (const t of selectedPersona.tools) allToolNames.add(t.name);
    }

    for (const toolName of allToolNames) {
      const usage = usageMap.get(toolName) ?? null;
      const ucMap = toolUseCaseMap.get(toolName);
      const coMap = toolCoMap.get(toolName);
      const costData = toolCostMap.get(toolName);

      // Build use case refs
      const useCaseRefs: ToolUseCaseRef[] = [];
      if (ucMap) {
        for (const [ucId, count] of ucMap) {
          useCaseRefs.push({
            useCaseId: ucId,
            title: useCaseTitles.get(ucId) ?? ucId,
            executionCount: count,
          });
        }
        useCaseRefs.sort((a, b) => b.executionCount - a.executionCount);
      }

      // Build co-used tools (top 5)
      const coUsedTools: CoUsedTool[] = [];
      if (coMap) {
        for (const [coTool, count] of coMap) {
          coUsedTools.push({ toolName: coTool, coOccurrences: count });
        }
        coUsedTools.sort((a, b) => b.coOccurrences - a.coOccurrences);
        coUsedTools.splice(5);
      }

      // Find credential info from persona's tools
      const personaTool = selectedPersona?.tools?.find((t) => t.name === toolName);
      const credType = personaTool?.requires_credential_type ?? null;

      result.set(toolName, {
        useCaseRefs,
        usage,
        avgCostPerInvocation: costData && costData.invocations > 0
          ? costData.totalCost / costData.invocations
          : null,
        totalCost: costData?.totalCost ?? 0,
        credentialLinked: credType ? credentialTypeSet.has(credType) : true,
        credentialRequired: !!credType,
        credentialType: credType,
        coUsedTools,
      });
    }

    return result;
  }, [executions, toolUsageSummary, designContext, selectedPersona?.tools, credentialTypeSet]);
}
