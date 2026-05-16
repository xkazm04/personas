/**
 * Pure derivation of the cross-persona lineage graph from raw triggers.
 *
 * Produces three logical node families:
 *  - persona: every persona that owns at least one trigger or is referenced
 *    as a chain source
 *  - trigger: every trigger row (carries its event_type for display)
 *  - event:   every event_type that is referenced by an `event_listener`
 *             trigger but not produced by a known chain (used as upstream hub)
 *
 * Edges:
 *  - owns:   trigger -> owning persona (the trigger fires this persona)
 *  - chain:  source_persona -> trigger (chain trigger upstream)
 *  - listen: event hub -> trigger (event_listener upstream)
 */
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

export type LineageNodeKind = 'persona' | 'trigger' | 'event';
export type LineageEdgeKind = 'owns' | 'chain' | 'listen';

export interface LineagePersonaNode {
  id: string;
  kind: 'persona';
  persona: Persona;
}

export interface LineageTriggerNode {
  id: string;
  kind: 'trigger';
  trigger: PersonaTrigger;
  eventType: string | null;
  sourcePersonaId: string | null;
  /** True when the trigger's source reference is broken or has no downstream effect. */
  isOrphan: boolean;
  /** True when this trigger participates in a chain cycle. */
  inCycle: boolean;
}

export interface LineageEventNode {
  id: string;
  kind: 'event';
  eventType: string;
}

export type LineageNode = LineagePersonaNode | LineageTriggerNode | LineageEventNode;

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  kind: LineageEdgeKind;
  /** True when the connected trigger is in a cycle (used for highlighting). */
  inCycle?: boolean;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  /** Trigger ids whose downstream cascade is empty AND upstream is broken/missing. */
  orphanTriggerIds: Set<string>;
  /** Trigger ids participating in at least one chain cycle. */
  cycleTriggerIds: Set<string>;
  /** Persona ids participating in at least one chain cycle. */
  cyclePersonaIds: Set<string>;
}

interface ParsedTriggerConfig {
  sourcePersonaId: string | null;
  eventType: string | null;
}

function parseTriggerConfig(t: PersonaTrigger): ParsedTriggerConfig {
  if (!t.config) return { sourcePersonaId: null, eventType: null };
  try {
    const cfg = JSON.parse(t.config) as {
      source_persona_id?: string;
      event_type?: string;
      listen_event_type?: string;
    };
    if (t.trigger_type === 'chain') {
      return {
        sourcePersonaId: cfg.source_persona_id ?? null,
        eventType: cfg.event_type ?? 'chain_triggered',
      };
    }
    if (t.trigger_type === 'event_listener') {
      return { sourcePersonaId: null, eventType: cfg.listen_event_type ?? null };
    }
    return { sourcePersonaId: null, eventType: cfg.event_type ?? null };
  } catch {
    return { sourcePersonaId: null, eventType: null };
  }
}

export function personaNodeId(personaId: string): string {
  return `persona:${personaId}`;
}

export function triggerNodeId(triggerId: string): string {
  return `trigger:${triggerId}`;
}

export function eventNodeId(eventType: string): string {
  return `event:${eventType}`;
}

/**
 * Detect chain cycles using a DFS-based 3-color algorithm. Builds an
 * adjacency map of source_persona -> [target_persona] from enabled chain
 * triggers, then flags every persona+trigger that participates in a cycle.
 */
function detectCycles(
  triggers: PersonaTrigger[],
  personaMap: Map<string, Persona>,
): { cyclePersonaIds: Set<string>; cycleTriggerIds: Set<string> } {
  interface ChainEdge {
    sourceId: string;
    targetId: string;
    triggerId: string;
  }
  const chainEdges: ChainEdge[] = [];
  for (const t of triggers) {
    if (t.trigger_type !== 'chain') continue;
    const parsed = parseTriggerConfig(t);
    if (!parsed.sourcePersonaId) continue;
    if (!personaMap.has(parsed.sourcePersonaId) || !personaMap.has(t.persona_id)) continue;
    chainEdges.push({
      sourceId: parsed.sourcePersonaId,
      targetId: t.persona_id,
      triggerId: t.id,
    });
  }

  const adj = new Map<string, ChainEdge[]>();
  for (const e of chainEdges) {
    const list = adj.get(e.sourceId) ?? [];
    list.push(e);
    adj.set(e.sourceId, list);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cyclePersonaIds = new Set<string>();
  const cycleTriggerIds = new Set<string>();

  interface Frame { node: string; iter: number; path: string[]; pathEdges: string[]; }

  function dfs(start: string) {
    const stack: Frame[] = [{ node: start, iter: 0, path: [start], pathEdges: [] }];
    color.set(start, GRAY);

    while (stack.length > 0) {
      const frame: Frame = stack[stack.length - 1] as Frame;
      const outgoing = adj.get(frame.node) ?? [];
      if (frame.iter >= outgoing.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const edge: ChainEdge = outgoing[frame.iter] as ChainEdge;
      frame.iter += 1;
      const nextColor = color.get(edge.targetId) ?? WHITE;
      if (nextColor === GRAY) {
        // Back edge → cycle. Mark every persona and edge from when target was first entered.
        const cycleStartIdx = frame.path.indexOf(edge.targetId);
        if (cycleStartIdx >= 0) {
          for (let i = cycleStartIdx; i < frame.path.length; i += 1) {
            const p = frame.path[i];
            if (p !== undefined) cyclePersonaIds.add(p);
          }
          for (let i = cycleStartIdx; i < frame.pathEdges.length; i += 1) {
            const tid = frame.pathEdges[i];
            if (tid !== undefined) cycleTriggerIds.add(tid);
          }
          cycleTriggerIds.add(edge.triggerId);
        }
      } else if (nextColor === WHITE) {
        color.set(edge.targetId, GRAY);
        stack.push({
          node: edge.targetId,
          iter: 0,
          path: [...frame.path, edge.targetId],
          pathEdges: [...frame.pathEdges, edge.triggerId],
        });
      }
    }
  }

  for (const sourceId of adj.keys()) {
    if ((color.get(sourceId) ?? WHITE) === WHITE) dfs(sourceId);
  }

  return { cyclePersonaIds, cycleTriggerIds };
}

export function deriveLineageGraph(
  personas: Persona[],
  triggers: PersonaTrigger[],
): LineageGraph {
  const personaMap = new Map<string, Persona>();
  for (const p of personas) personaMap.set(p.id, p);

  const { cyclePersonaIds, cycleTriggerIds } = detectCycles(triggers, personaMap);

  // Set of personas that are source of at least one chain trigger (have downstream cascade)
  const personasWithDownstream = new Set<string>();
  for (const t of triggers) {
    if (t.trigger_type !== 'chain') continue;
    const parsed = parseTriggerConfig(t);
    if (parsed.sourcePersonaId) personasWithDownstream.add(parsed.sourcePersonaId);
  }

  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const orphanTriggerIds = new Set<string>();

  // Persona nodes — only personas referenced by triggers or by chain sources stay visible.
  const referencedPersonaIds = new Set<string>();
  for (const t of triggers) {
    referencedPersonaIds.add(t.persona_id);
    const parsed = parseTriggerConfig(t);
    if (parsed.sourcePersonaId) referencedPersonaIds.add(parsed.sourcePersonaId);
  }
  for (const pid of referencedPersonaIds) {
    const persona = personaMap.get(pid);
    if (!persona) continue;
    nodes.push({ id: personaNodeId(pid), kind: 'persona', persona });
  }

  // Event hubs — track which event types are listened-for so we can create
  // hub nodes only when worth it.
  const listenedEventTypes = new Map<string, string[]>(); // eventType -> trigger ids listening
  for (const t of triggers) {
    if (t.trigger_type !== 'event_listener') continue;
    const parsed = parseTriggerConfig(t);
    if (!parsed.eventType) continue;
    const list = listenedEventTypes.get(parsed.eventType) ?? [];
    list.push(t.id);
    listenedEventTypes.set(parsed.eventType, list);
  }
  for (const [eventType] of listenedEventTypes) {
    nodes.push({ id: eventNodeId(eventType), kind: 'event', eventType });
  }

  // Trigger nodes + edges
  for (const t of triggers) {
    const parsed = parseTriggerConfig(t);
    const ownsPersonaExists = personaMap.has(t.persona_id);
    const chainSourceExists =
      t.trigger_type !== 'chain' ||
      (parsed.sourcePersonaId !== null && personaMap.has(parsed.sourcePersonaId));

    // Determine orphan status:
    //   - chain trigger with a broken source reference, OR
    //   - owning persona has no further downstream chain (cascade ends here)
    //     AND this trigger is not the start of a fresh useful chain itself.
    // For the simpler rule, mark as orphan when:
    //   - source reference broken, OR
    //   - persona doesn't exist, OR
    //   - owning persona has zero outgoing chain triggers (no consumer of its output).
    const isOrphan =
      !ownsPersonaExists ||
      !chainSourceExists ||
      !personasWithDownstream.has(t.persona_id);
    if (isOrphan) orphanTriggerIds.add(t.id);
    const inCycle = cycleTriggerIds.has(t.id);

    const tNodeId = triggerNodeId(t.id);
    nodes.push({
      id: tNodeId,
      kind: 'trigger',
      trigger: t,
      eventType: parsed.eventType,
      sourcePersonaId: parsed.sourcePersonaId,
      isOrphan,
      inCycle,
    });

    // owns edge (trigger -> owning persona)
    if (ownsPersonaExists) {
      edges.push({
        id: `e-owns-${t.id}`,
        source: tNodeId,
        target: personaNodeId(t.persona_id),
        kind: 'owns',
        inCycle,
      });
    }

    // upstream edges
    if (t.trigger_type === 'chain' && parsed.sourcePersonaId && personaMap.has(parsed.sourcePersonaId)) {
      edges.push({
        id: `e-chain-${t.id}`,
        source: personaNodeId(parsed.sourcePersonaId),
        target: tNodeId,
        kind: 'chain',
        inCycle,
      });
    } else if (t.trigger_type === 'event_listener' && parsed.eventType) {
      edges.push({
        id: `e-listen-${t.id}`,
        source: eventNodeId(parsed.eventType),
        target: tNodeId,
        kind: 'listen',
      });
    }
  }

  return {
    nodes,
    edges,
    orphanTriggerIds,
    cycleTriggerIds,
    cyclePersonaIds,
  };
}

/**
 * Compute the blast radius for a persona: every trigger that would fire (directly
 * or transitively through chains) when the persona's executions complete.
 *
 * Returns sets of impacted persona ids and trigger ids — including the seed.
 */
export function computeBlastRadius(
  seedPersonaId: string,
  triggers: PersonaTrigger[],
): { personaIds: Set<string>; triggerIds: Set<string> } {
  const triggersBySource = new Map<string, PersonaTrigger[]>();
  for (const t of triggers) {
    if (t.trigger_type !== 'chain') continue;
    const parsed = parseTriggerConfig(t);
    if (!parsed.sourcePersonaId) continue;
    const list = triggersBySource.get(parsed.sourcePersonaId) ?? [];
    list.push(t);
    triggersBySource.set(parsed.sourcePersonaId, list);
  }

  const personaIds = new Set<string>([seedPersonaId]);
  const triggerIds = new Set<string>();
  const queue = [seedPersonaId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const chains = triggersBySource.get(current) ?? [];
    for (const t of chains) {
      if (triggerIds.has(t.id)) continue;
      triggerIds.add(t.id);
      if (!personaIds.has(t.persona_id)) {
        personaIds.add(t.persona_id);
        queue.push(t.persona_id);
      }
    }
  }

  return { personaIds, triggerIds };
}
