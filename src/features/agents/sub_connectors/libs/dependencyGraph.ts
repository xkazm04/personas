import type { CredentialMetadata } from '@/lib/types/types';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import type { ConnectorStatus } from './connectorTypes';
import { deriveReadiness } from './connectorTypes';

// ---------------------------------------------------------------------------
// Node / edge types
// ---------------------------------------------------------------------------

export type DepNodeKind = 'credential' | 'tool' | 'automation';

export interface DepNode {
  id: string;
  kind: DepNodeKind;
  label: string;
  color: string;
  healthy: boolean | null; // null = unknown
}

export interface DepEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  broken: boolean; // true when the dependency is unfulfilled
}

export interface DepGraph {
  nodes: DepNode[];
  edges: DepEdge[];
}

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

export interface DepBlastRadius {
  credentialId: string;
  credentialName: string;
  healthy: boolean | null;
  affectedTools: { id: string; name: string }[];
  affectedAutomations: { id: string; name: string; status: string }[];
  severity: 'low' | 'medium' | 'high';
}

export function analyzeDepBlastRadius(
  credentialNodeId: string,
  graph: DepGraph,
): DepBlastRadius | null {
  const node = graph.nodes.find((n) => n.id === credentialNodeId && n.kind === 'credential');
  if (!node) return null;

  const connected = graph.edges.filter((e) => e.source === credentialNodeId || e.target === credentialNodeId);

  const affectedTools: DepBlastRadius['affectedTools'] = [];
  const affectedAutomations: DepBlastRadius['affectedAutomations'] = [];

  for (const edge of connected) {
    const otherId = edge.source === credentialNodeId ? edge.target : edge.source;
    const other = graph.nodes.find((n) => n.id === otherId);
    if (!other) continue;
    if (other.kind === 'tool') {
      affectedTools.push({ id: other.id, name: other.label });
    } else if (other.kind === 'automation') {
      affectedAutomations.push({ id: other.id, name: other.label, status: '' });
    }
  }

  const total = affectedTools.length + affectedAutomations.length;
  const severity = total >= 4 ? 'high' : total >= 1 ? 'medium' : 'low';

  return {
    credentialId: credentialNodeId,
    credentialName: node.label,
    healthy: node.healthy,
    affectedTools,
    affectedAutomations,
    severity,
  };
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export function buildPersonaDependencyGraph(
  tools: PersonaToolDefinition[],
  automations: PersonaAutomation[],
  statuses: ConnectorStatus[],
  credentials: CredentialMetadata[],
): DepGraph {
  const nodes: DepNode[] = [];
  const edges: DepEdge[] = [];
  const nodeIds = new Set<string>();

  // 1. Add credential nodes from connector statuses
  const credNodeMap = new Map<string, string>(); // credType -> nodeId
  for (const status of statuses) {
    const nodeId = `cred:${status.name}`;
    const readiness = deriveReadiness(status);
    const healthy = readiness === 'healthy' ? true : readiness === 'unhealthy' ? false : null;
    const cred = status.credentialId ? credentials.find((c) => c.id === status.credentialId) : null;

    nodes.push({
      id: nodeId,
      kind: 'credential',
      label: cred?.name ?? status.name,
      color: readiness === 'healthy' ? '#10b981' : readiness === 'unhealthy' ? '#ef4444' : readiness === 'unlinked' ? '#f59e0b' : '#6b7280',
      healthy,
    });
    nodeIds.add(nodeId);
    credNodeMap.set(status.name, nodeId);
  }

  // 2. Add tool nodes and tool→credential edges
  for (const tool of tools) {
    const toolNodeId = `tool:${tool.id}`;
    nodes.push({
      id: toolNodeId,
      kind: 'tool',
      label: tool.name,
      color: '#3b82f6',
      healthy: null,
    });
    nodeIds.add(toolNodeId);

    if (tool.requires_credential_type) {
      const credNodeId = credNodeMap.get(tool.requires_credential_type);
      if (credNodeId) {
        const credStatus = statuses.find((s) => s.name === tool.requires_credential_type);
        const broken = !credStatus?.credentialId;
        edges.push({
          id: `${toolNodeId}->${credNodeId}`,
          source: toolNodeId,
          target: credNodeId,
          label: 'requires',
          broken,
        });
      }
    }
  }

  // 3. Add automation nodes and automation→credential edges
  for (const auto of automations) {
    const autoNodeId = `auto:${auto.id}`;
    const isHealthy = auto.deploymentStatus === 'active';
    nodes.push({
      id: autoNodeId,
      kind: 'automation',
      label: auto.name,
      color: isHealthy ? '#8b5cf6' : '#ef4444',
      healthy: isHealthy ? true : auto.deploymentStatus === 'error' ? false : null,
    });
    nodeIds.add(autoNodeId);

    // Automation platform credential dependency
    if (auto.platformCredentialId) {
      const cred = credentials.find((c) => c.id === auto.platformCredentialId);
      if (cred) {
        const credNodeId = credNodeMap.get(cred.service_type);
        if (credNodeId) {
          edges.push({
            id: `${autoNodeId}->${credNodeId}`,
            source: autoNodeId,
            target: credNodeId,
            label: 'platform',
            broken: false,
          });
        }
      }
    }

    // Credential mapping dependencies
    if (auto.credentialMapping) {
      try {
        const mapping = JSON.parse(auto.credentialMapping) as Record<string, string>;
        for (const [connName, credId] of Object.entries(mapping)) {
          let credNodeId = credNodeMap.get(connName);
          if (!credNodeId && credId) {
            const cred = credentials.find((c) => c.id === credId);
            if (cred) credNodeId = credNodeMap.get(cred.service_type);
          }
          if (credNodeId) {
            const edgeId = `${autoNodeId}->${credNodeId}:map`;
            if (!edges.some((e) => e.id === edgeId)) {
              edges.push({
                id: edgeId,
                source: autoNodeId,
                target: credNodeId,
                label: 'uses',
                broken: !credId,
              });
            }
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
  }

  return { nodes, edges };
}
