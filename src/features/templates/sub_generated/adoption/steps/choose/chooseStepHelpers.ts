import type { UseCaseFlow } from '@/lib/types/frontendTypes';

export function deriveRequirementsFromFlows(
  flows: UseCaseFlow[],
  selectedIds: Set<string>,
): { connectorNames: Set<string>; toolNames: Set<string> } {
  const connectorNames = new Set<string>();
  const toolNames = new Set<string>();

  for (const flow of flows) {
    if (!selectedIds.has(flow.id)) continue;
    for (const node of flow.nodes) {
      if (node.type === 'connector' && node.connector) {
        connectorNames.add(node.connector);
      }
      if (node.type === 'action') {
        toolNames.add(node.label);
      }
    }
  }

  return { connectorNames, toolNames };
}

/** Build a map from connector name -> set of flow IDs that use it */
export function buildConnectorFlowIndex(flows: UseCaseFlow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (node.type === 'connector' && node.connector) {
        let set = index.get(node.connector);
        if (!set) {
          set = new Set();
          index.set(node.connector, set);
        }
        set.add(flow.id);
      }
    }
  }
  return index;
}
