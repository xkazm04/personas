import type { CredentialMetadata, ConnectorDefinition, DbPersona, DbCredentialEvent } from '@/lib/types/types';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';

// ---------------------------------------------------------------------------
// Graph node / edge types
// ---------------------------------------------------------------------------

export type GraphNodeKind = 'credential' | 'agent' | 'event';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  color: string;
  meta: {
    healthOk?: boolean | null;
    serviceType?: string;
    category?: string;
    eventCount?: number;
    dependentCount?: number;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  style: 'solid' | 'dashed';
}

export interface CredentialGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Blast-radius analysis
// ---------------------------------------------------------------------------

export interface BlastRadius {
  credentialId: string;
  credentialName: string;
  affectedAgents: { id: string; name: string; via: string | null }[];
  affectedEvents: { id: string; name: string }[];
  severity: 'low' | 'medium' | 'high';
}

export function analyzeBlastRadius(
  credentialId: string,
  graph: CredentialGraph,
): BlastRadius | null {
  const credNode = graph.nodes.find((n) => n.id === credentialId && n.kind === 'credential');
  if (!credNode) return null;

  // Find edges from this credential
  const outEdges = graph.edges.filter((e) => e.source === credentialId);
  const inEdges = graph.edges.filter((e) => e.target === credentialId);
  const allEdges = [...outEdges, ...inEdges];

  // Find connected agents
  const agentIds = new Set<string>();
  const affectedAgents: BlastRadius['affectedAgents'] = [];
  for (const edge of allEdges) {
    const otherId = edge.source === credentialId ? edge.target : edge.source;
    const otherNode = graph.nodes.find((n) => n.id === otherId);
    if (otherNode?.kind === 'agent' && !agentIds.has(otherId)) {
      agentIds.add(otherId);
      affectedAgents.push({ id: otherId, name: otherNode.label, via: edge.label ?? null });
    }
  }

  // Find connected events
  const affectedEvents: BlastRadius['affectedEvents'] = [];
  for (const edge of allEdges) {
    const otherId = edge.source === credentialId ? edge.target : edge.source;
    const otherNode = graph.nodes.find((n) => n.id === otherId);
    if (otherNode?.kind === 'event') {
      affectedEvents.push({ id: otherId, name: otherNode.label });
    }
  }

  // Severity: high if 3+ agents, medium if 1-2, low if none
  const severity = affectedAgents.length >= 3 ? 'high' : affectedAgents.length >= 1 ? 'medium' : 'low';

  return {
    credentialId,
    credentialName: credNode.label,
    affectedAgents,
    affectedEvents,
    severity,
  };
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export function buildCredentialGraph(
  credentials: CredentialMetadata[],
  connectors: ConnectorDefinition[],
  personas: DbPersona[],
  credentialEvents: DbCredentialEvent[],
  dependentsMap: Map<string, CredentialDependent[]>,
): CredentialGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const connectorByName = new Map<string, ConnectorDefinition>();
  for (const c of connectors) connectorByName.set(c.name, c);

  // 1. Add credential nodes
  for (const cred of credentials) {
    const connector = connectorByName.get(cred.service_type);
    const events = credentialEvents.filter((e) => e.credential_id === cred.id);
    const deps = dependentsMap.get(cred.id) ?? [];

    nodes.push({
      id: cred.id,
      kind: 'credential',
      label: cred.name,
      color: connector?.color ?? '#8b5cf6',
      meta: {
        healthOk: cred.healthcheck_last_success,
        serviceType: cred.service_type,
        eventCount: events.length,
        dependentCount: deps.length,
      },
    });
    nodeIds.add(cred.id);
  }

  // 2. Add agent nodes and credential->agent edges via dependentsMap
  const agentNodes = new Map<string, GraphNode>();
  for (const [credId, deps] of dependentsMap) {
    for (const dep of deps) {
      const agentNodeId = `agent:${dep.persona_id}`;
      if (!agentNodes.has(agentNodeId)) {
        const persona = personas.find((p) => p.id === dep.persona_id);
        agentNodes.set(agentNodeId, {
          id: agentNodeId,
          kind: 'agent',
          label: dep.persona_name,
          color: persona?.color ?? '#3b82f6',
          meta: {},
        });
      }

      edges.push({
        id: `${credId}→${agentNodeId}:${dep.link_type}`,
        source: credId,
        target: agentNodeId,
        label: dep.via_connector ?? dep.link_type,
        style: dep.link_type === 'tool_connector' ? 'solid' : 'dashed',
      });
    }
  }
  for (const node of agentNodes.values()) {
    nodes.push(node);
    nodeIds.add(node.id);
  }

  // 3. Add event nodes
  for (const evt of credentialEvents) {
    if (!nodeIds.has(evt.credential_id)) continue;
    const evtNodeId = `evt:${evt.id}`;
    nodes.push({
      id: evtNodeId,
      kind: 'event',
      label: evt.name,
      color: evt.enabled ? '#f59e0b' : '#6b7280',
      meta: {},
    });
    nodeIds.add(evtNodeId);

    edges.push({
      id: `${evt.credential_id}→${evtNodeId}`,
      source: evt.credential_id,
      target: evtNodeId,
      label: 'triggers',
      style: evt.enabled ? 'solid' : 'dashed',
    });
  }

  return { nodes, edges };
}

