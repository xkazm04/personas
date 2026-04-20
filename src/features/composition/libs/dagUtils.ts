/**
 * DAG utilities for the Persona Composition Engine.
 *
 * Provides topological sorting (Kahn's algorithm), cycle detection,
 * and structural validation for workflow graphs.
 */

import type { WorkflowNode, WorkflowEdge } from '@/lib/types/compositionTypes';

// ── Topological sort (Kahn's algorithm) ─────────────────────────────────

/**
 * Discriminated union result. Callers must narrow on `ok` before using the
 * payload — this makes it a compile error to ignore a cyclic graph and
 * silently treat it as an empty execution plan.
 */
export type TopologicalResult =
  | { ok: true; order: string[] }
  | { ok: false; cycleNodes: string[] };

export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): TopologicalResult {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (order.length === nodeIds.size) {
    return { ok: true, order };
  }

  // Cycle detected: nodes still carrying residual in-degree are part of, or
  // downstream of, the cycle. Surface them so the editor can highlight them.
  const cycleNodes: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg > 0) cycleNodes.push(id);
  }
  return { ok: false, cycleNodes };
}

// ── Validation ──────────────────────────────────────────────────────────

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export function validateWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Must have at least one node
  if (nodes.length === 0) {
    errors.push({ message: 'Workflow must have at least one node.' });
    return errors;
  }

  // Persona nodes must reference a persona
  for (const node of nodes) {
    if (node.kind === 'persona' && !node.personaId) {
      errors.push({ nodeId: node.id, message: `Node "${node.label}" has no persona assigned.` });
    }
  }

  // Edges must reference valid nodes
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ edgeId: edge.id, message: `Edge source "${edge.source}" not found.` });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ edgeId: edge.id, message: `Edge target "${edge.target}" not found.` });
    }
    if (edge.source === edge.target) {
      errors.push({ edgeId: edge.id, message: 'Self-loops are not allowed.' });
    }
  }

  // Cycle detection
  const result = topologicalSort(nodes, edges);
  if (!result.ok) {
    errors.push({ message: 'Workflow contains a cycle — only DAGs are allowed.' });
    for (const nodeId of result.cycleNodes) {
      errors.push({ nodeId, message: 'Node is part of a cycle.' });
    }
  }

  return errors;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Get direct upstream node IDs for a given node. */
export function getUpstream(nodeId: string, edges: WorkflowEdge[]): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

/** Get direct downstream node IDs for a given node. */
export function getDownstream(nodeId: string, edges: WorkflowEdge[]): string[] {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target);
}
