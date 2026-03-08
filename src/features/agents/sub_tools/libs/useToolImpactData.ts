import { useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { ToolImpactData, ToolUseCaseRef, CoUsedTool } from './toolImpactTypes';
import { parseToolNames, parseUseCaseTitles } from './toolImpactTypes';

export type { ToolImpactData, ToolUseCaseRef, CoUsedTool } from './toolImpactTypes';

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
    const usageMap = new Map<string, (typeof toolUsageSummary)[number]>();
    for (const s of toolUsageSummary) usageMap.set(s.tool_name, s);

    // Parse all executions to build:
    // 1. tool -> use-case references
    // 2. tool -> co-used tools
    // 3. tool -> cost attribution
    const toolUseCaseMap = new Map<string, Map<string, number>>();
    const toolCoMap = new Map<string, Map<string, number>>();
    const toolCostMap = new Map<string, { totalCost: number; invocations: number }>();

    for (const exec of executions as PersonaExecution[]) {
      const toolNames = parseToolNames(exec.tool_steps);
      if (toolNames.length === 0) continue;

      const executionCost = typeof exec.cost_usd === 'number' && Number.isFinite(exec.cost_usd)
        ? exec.cost_usd
        : 0;
      const costPerTool = toolNames.length > 0 ? executionCost / toolNames.length : 0;

      for (const toolName of toolNames) {
        if (exec.use_case_id) {
          if (!toolUseCaseMap.has(toolName)) toolUseCaseMap.set(toolName, new Map());
          const ucMap = toolUseCaseMap.get(toolName)!;
          ucMap.set(exec.use_case_id, (ucMap.get(exec.use_case_id) ?? 0) + 1);
        }
        if (!toolCoMap.has(toolName)) toolCoMap.set(toolName, new Map());
        const coMap = toolCoMap.get(toolName)!;
        for (const other of toolNames) {
          if (other !== toolName) coMap.set(other, (coMap.get(other) ?? 0) + 1);
        }
        if (!toolCostMap.has(toolName)) toolCostMap.set(toolName, { totalCost: 0, invocations: 0 });
        const cost = toolCostMap.get(toolName)!;
        cost.totalCost += costPerTool;
        cost.invocations += 1;
      }
    }

    const allToolNames = new Set([
      ...usageMap.keys(),
      ...toolUseCaseMap.keys(),
      ...toolCoMap.keys(),
    ]);
    if (selectedPersona?.tools) {
      for (const t of selectedPersona.tools) allToolNames.add(t.name);
    }

    for (const toolName of allToolNames) {
      const usage = usageMap.get(toolName) ?? null;
      const ucMap = toolUseCaseMap.get(toolName);
      const coMap = toolCoMap.get(toolName);
      const costData = toolCostMap.get(toolName);

      const useCaseRefs: ToolUseCaseRef[] = [];
      if (ucMap) {
        for (const [ucId, count] of ucMap) {
          useCaseRefs.push({ useCaseId: ucId, title: useCaseTitles.get(ucId) ?? ucId, executionCount: count });
        }
        useCaseRefs.sort((a, b) => b.executionCount - a.executionCount);
      }

      const coUsedTools: CoUsedTool[] = [];
      if (coMap) {
        for (const [coTool, count] of coMap) {
          coUsedTools.push({ toolName: coTool, coOccurrences: count });
        }
        coUsedTools.sort((a, b) => b.coOccurrences - a.coOccurrences);
        coUsedTools.splice(5);
      }

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
