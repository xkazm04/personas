import type { CredentialMetadata, ConnectorDefinition, Persona, CredentialEvent } from '@/lib/types/types';
import type { CredentialDependent } from '@/lib/bindings/CredentialDependent';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';

// ---------------------------------------------------------------------------
// Agent-node ID contract
// ---------------------------------------------------------------------------
//
// Agent nodes are stored in the graph under `agent:<persona_id>` rather than
// the raw persona id so the same id space doesn't collide with credential ids
// (which are also UUIDs) and event ids (prefixed `evt:`). The prefix is an
// implementation detail of the graph — every caller that needs to read or
// write an agent node id MUST go through {@link toAgentNodeId} /
// {@link fromAgentNodeId} so the contract stays a single-file change.

/** Required prefix on every agent node id. */
const AGENT_NODE_PREFIX = 'agent:';

/** Branded string narrowing down the `agent:<persona_id>` shape. */
export type AgentNodeId = string & { readonly __agentNodeBrand?: never };

/** Wrap a raw persona id into its graph node id. */
export function toAgentNodeId(personaId: string): AgentNodeId {
  return `${AGENT_NODE_PREFIX}${personaId}` as AgentNodeId;
}

/** True iff the given string obeys the agent-node id contract. */
export function isAgentNodeId(value: string): value is AgentNodeId {
  return value.startsWith(AGENT_NODE_PREFIX) && value.length > AGENT_NODE_PREFIX.length;
}

/**
 * Strip the `agent:` prefix to recover the persona id. Throws when the input
 * does not match the contract — previous code silently passed the raw node id
 * through, producing "unknown" health grades and zero burn-rate, under-
 * reporting blast radius. An invariant-violation is preferable to a
 * plausibly-wrong result.
 */
export function fromAgentNodeId(nodeId: string): string {
  if (!isAgentNodeId(nodeId)) {
    throw new Error(
      `fromAgentNodeId: expected "${AGENT_NODE_PREFIX}<persona_id>", got ${JSON.stringify(nodeId)}`,
    );
  }
  return nodeId.slice(AGENT_NODE_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Blast-radius severity thresholds
// ---------------------------------------------------------------------------

/**
 * Severity thresholds driving the colour / urgency of the vault UI's
 * blast-radius indicator AND the revocation simulator. Shared source of
 * truth so the two surfaces cannot drift.
 *
 * - `HIGH_SEVERITY_AGENT_COUNT = 3` — pragmatic: a credential feeding 3+
 *   agents is treated as "rotate now" because the blast-radius page stops
 *   being browsable past that count (heuristics grid condenses), and ops
 *   feedback has historically flagged 3-agent breakages as "outage" whereas
 *   1–2 are "degraded".
 * - `MEDIUM_SEVERITY_AGENT_COUNT = 1` — any agent depending on a credential
 *   is at least a "degraded" rotation risk; zero dependents is the only
 *   "low" state.
 *
 * Tune here, not at the call site. Both `analyzeBlastRadius` and
 * `simulateRevocation` read from this object.
 */
export const BLAST_RADIUS_THRESHOLDS = {
  HIGH_SEVERITY_AGENT_COUNT: 3,
  MEDIUM_SEVERITY_AGENT_COUNT: 1,
} as const;

/** Map an affected-agent count to a blast-radius severity bucket. */
export function severityForAgentCount(
  affectedAgents: number,
): 'low' | 'medium' | 'high' {
  if (affectedAgents >= BLAST_RADIUS_THRESHOLDS.HIGH_SEVERITY_AGENT_COUNT) return 'high';
  if (affectedAgents >= BLAST_RADIUS_THRESHOLDS.MEDIUM_SEVERITY_AGENT_COUNT) return 'medium';
  return 'low';
}

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

/**
 * Deterministic precedence for credential→agent link types when a single
 * (credential, persona) pair is reported via multiple paths. Lower index =
 * stronger / preferred — `tool_connector` (live binding from the persona's
 * config) outranks `event_trigger` (subscriptions) which outranks `audit_log`
 * (historical observation only).
 *
 * The graph builder dedupes edges per `(source, target)` and keeps the
 * dominant link, eliminating non-deterministic "via" labels in
 * BlastRadiusPanel that previously depended on dependentsMap iteration order.
 *
 * Unknown link types are appended after all known ones (any precedence value
 * ≥ this list's length), keeping the comparison total but conservative —
 * a known link always wins over an unknown one.
 */
const LINK_TYPE_PRECEDENCE: readonly string[] = [
  'tool_connector',
  'event_trigger',
  'audit_log',
] as const;

function linkTypeRank(linkType: string): number {
  const idx = LINK_TYPE_PRECEDENCE.indexOf(linkType);
  return idx === -1 ? LINK_TYPE_PRECEDENCE.length : idx;
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

  // Find connected events. Mirror the agent-dedupe via eventIds Set so a
  // credential with both an outgoing `triggers` edge and a future inbound
  // edge to the same event can't double-count toward blast radius.
  const eventIds = new Set<string>();
  const affectedEvents: BlastRadius['affectedEvents'] = [];
  for (const edge of allEdges) {
    const otherId = edge.source === credentialId ? edge.target : edge.source;
    const otherNode = graph.nodes.find((n) => n.id === otherId);
    if (otherNode?.kind === 'event' && !eventIds.has(otherId)) {
      eventIds.add(otherId);
      affectedEvents.push({ id: otherId, name: otherNode.label });
    }
  }

  // Severity derived from shared threshold table (see BLAST_RADIUS_THRESHOLDS).
  const severity = severityForAgentCount(affectedAgents.length);

  return {
    credentialId,
    credentialName: credNode.label,
    affectedAgents,
    affectedEvents,
    severity,
  };
}

// ---------------------------------------------------------------------------
// Revocation simulation (chaos-engineering inspired)
// ---------------------------------------------------------------------------

export interface FailoverSuggestion {
  credentialId: string;
  credentialName: string;
  serviceType: string;
  healthOk: boolean | null;
}

export interface SimulationResult {
  credentialId: string;
  credentialName: string;
  serviceType: string;

  // Affected personas with health context
  affectedPersonas: {
    id: string;
    name: string;
    via: string | null;
    recentExecutions: number;
    dailyBurnRate: number;
    grade: string;
  }[];

  // Impact metrics
  totalAffectedPersonas: number;
  estimatedDailyExecutionsLost: number;
  estimatedDailyRevenueLost: number; // $ based on burn rate of affected personas

  // Failover suggestions
  failoverSuggestions: FailoverSuggestion[];

  // Severity matches blast-radius bucket. The previous `'critical'` branch
  // was driven by an `affectedWorkflows` collection that was always empty
  // (the only caller passed `workflows: []`), so the workflow-aware severity
  // and panel were unreachable. Fold severity back to the blast-radius bucket
  // until a real workflow source is wired in.
  severity: 'low' | 'medium' | 'high';
}

export function simulateRevocation(
  credentialId: string,
  graph: CredentialGraph,
  healthSignals: PersonaHealthSignal[],
  allCredentials: CredentialMetadata[],
): SimulationResult | null {
  const credNode = graph.nodes.find((n) => n.id === credentialId && n.kind === 'credential');
  if (!credNode) return null;

  const serviceType = credNode.meta.serviceType ?? 'unknown';

  // 1. Find affected agents (same as blast radius but enriched with health)
  const healthMap = new Map(healthSignals.map((s) => [s.personaId, s]));

  const outEdges = graph.edges.filter((e) => e.source === credentialId);
  const inEdges = graph.edges.filter((e) => e.target === credentialId);
  const allEdges = [...outEdges, ...inEdges];

  const agentIds = new Set<string>();
  const affectedPersonas: SimulationResult['affectedPersonas'] = [];
  for (const edge of allEdges) {
    const otherId = edge.source === credentialId ? edge.target : edge.source;
    const otherNode = graph.nodes.find((n) => n.id === otherId);
    if (otherNode?.kind === 'agent' && !agentIds.has(otherId)) {
      agentIds.add(otherId);
      // Invariant is enforced at graph-build time in buildCredentialGraph —
      // fromAgentNodeId throws on malformed ids so a bogus node can't silently
      // degrade the simulation to `grade='unknown'`, `$0 burn rate`, etc.
      const personaId = fromAgentNodeId(otherId);
      const health = healthMap.get(personaId);
      affectedPersonas.push({
        id: personaId,
        name: otherNode.label,
        via: edge.label ?? null,
        recentExecutions: health?.recentExecutions ?? 0,
        dailyBurnRate: health?.dailyBurnRate ?? 0,
        grade: health?.grade ?? 'unknown',
      });
    }
  }

  // 2. Impact metrics
  const estimatedDailyExecutionsLost = affectedPersonas.reduce(
    (sum, p) => sum + Math.round(p.recentExecutions / 7),
    0,
  );
  const estimatedDailyRevenueLost = affectedPersonas.reduce(
    (sum, p) => sum + p.dailyBurnRate,
    0,
  );

  // 3. Failover suggestions — same service_type credentials that aren't this one
  const failoverSuggestions: FailoverSuggestion[] = allCredentials
    .filter((c) => c.id !== credentialId && c.service_type === serviceType)
    .map((c) => ({
      credentialId: c.id,
      credentialName: c.name,
      serviceType: c.service_type,
      healthOk: c.healthcheck_last_success,
    }));

  return {
    credentialId,
    credentialName: credNode.label,
    serviceType,
    affectedPersonas,
    totalAffectedPersonas: affectedPersonas.length,
    estimatedDailyExecutionsLost,
    estimatedDailyRevenueLost: Math.round(estimatedDailyRevenueLost * 100) / 100,
    failoverSuggestions,
    severity: severityForAgentCount(affectedPersonas.length),
  };
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export function buildCredentialGraph(
  credentials: CredentialMetadata[],
  connectors: ConnectorDefinition[],
  personas: Persona[],
  credentialEvents: CredentialEvent[],
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

  // 2. Add agent nodes and credential->agent edges via dependentsMap.
  //    Agent node ids go through `toAgentNodeId` exclusively so
  //    `fromAgentNodeId` at read time can enforce the invariant and never
  //    silently fall back to the raw id.
  //
  //    Dedupe per (credential, persona): if the same persona depends on the
  //    same credential through multiple link_types (e.g. both
  //    `tool_connector` and `event_trigger`), keep the highest-precedence
  //    one. Without this dedupe, the graph rendered duplicate edges and
  //    `analyzeBlastRadius`'s `via` label was non-deterministic by
  //    dependentsMap iteration order. Precedence order is documented in
  //    LINK_TYPE_PRECEDENCE above.
  const agentNodes = new Map<string, GraphNode>();
  // Track the dominant edge per (credId, agentNodeId) pair while we scan.
  // Stores both the index in `edges` and the rank of the link_type that
  // produced it, so we can compare without re-deriving link_type from the
  // edge's label/style.
  const dominantEdge = new Map<string, { index: number; rank: number }>();
  for (const [credId, deps] of dependentsMap) {
    for (const dep of deps) {
      if (!dep.persona_id) continue; // skip: orphaned dependents shouldn't poison the graph
      const agentNodeId = toAgentNodeId(dep.persona_id);
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

      const candidateEdge: GraphEdge = {
        id: `${credId}->${agentNodeId}`,
        source: credId,
        target: agentNodeId,
        label: dep.via_connector ?? dep.link_type,
        style: dep.link_type === 'tool_connector' ? 'solid' : 'dashed',
      };
      const candidateRank = linkTypeRank(dep.link_type);

      const edgeKey = `${credId}->${agentNodeId}`;
      const existing = dominantEdge.get(edgeKey);
      if (existing === undefined) {
        dominantEdge.set(edgeKey, { index: edges.length, rank: candidateRank });
        edges.push(candidateEdge);
      } else if (candidateRank < existing.rank) {
        edges[existing.index] = candidateEdge;
        existing.rank = candidateRank;
      }
    }
  }
  for (const node of agentNodes.values()) {
    // Invariant guard. Every agent node id in the graph MUST obey the
    // agent-node contract — if a future code path adds one without the
    // prefix, fail loudly here instead of mis-reporting blast radius later.
    if (!isAgentNodeId(node.id)) {
      throw new Error(
        `buildCredentialGraph: agent node id ${JSON.stringify(node.id)} does not match the "agent:<persona_id>" contract`,
      );
    }
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
      id: `${evt.credential_id}->${evtNodeId}`,
      source: evt.credential_id,
      target: evtNodeId,
      label: 'triggers',
      style: evt.enabled ? 'solid' : 'dashed',
    });
  }

  return { nodes, edges };
}

