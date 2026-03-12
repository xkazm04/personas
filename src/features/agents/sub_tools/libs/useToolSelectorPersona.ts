import { useEffect, useMemo, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';

/**
 * Persona-scoped data for the tool selector: tool definitions,
 * assigned tools, credential state, and usage metrics.
 */
export function useToolSelectorPersona() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const toolDefinitions = usePersonaStore((s) => s.toolDefinitions);
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const toolUsageSummary = usePersonaStore((s) => s.toolUsageSummary);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);

  useEffect(() => { fetchToolUsage(30); }, [fetchToolUsage]);

  const credentialLabel = useCallback((credType: string): string => {
    const connector = connectorDefinitions.find((c) => c.name === credType);
    if (connector) return connector.label;
    return getConnectorMeta(credType).label;
  }, [connectorDefinitions]);

  const credentialTypeSet = useMemo(() => {
    const set = new Set<string>();
    credentials.forEach(c => set.add(c.service_type));
    return set;
  }, [credentials]);

  const usageByTool = useMemo(() => {
    const map = new Map<string, number>();
    toolUsageSummary.forEach((s) => map.set(s.tool_name, s.total_invocations));
    return map;
  }, [toolUsageSummary]);

  const personaId = selectedPersona?.id || '';
  const assignedToolIds = useMemo(() => {
    const ids = selectedPersona?.tools?.map(t => t.id) || [];
    return new Set(ids);
  }, [selectedPersona?.tools]);

  const assignedTools = useMemo(() => {
    return toolDefinitions.filter((td) => assignedToolIds.has(td.id));
  }, [assignedToolIds, toolDefinitions]);

  return {
    selectedPersona,
    toolDefinitions,
    credentialLabel,
    credentialTypeSet,
    usageByTool,
    personaId,
    assignedToolIds,
    assignedTools,
  };
}
