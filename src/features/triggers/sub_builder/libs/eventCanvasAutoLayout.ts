import type { Node, Edge } from '@xyflow/react';
import { NODE_TYPE_EVENT_SOURCE, NODE_TYPE_PERSONA_CONSUMER } from './eventCanvasConstants';
import { snapToGrid } from '@/lib/canvas/gridUtils';

// Layout constants
const NODE_W = 180;
const NODE_H = 60;
const X_GAP = 140;
const Y_GAP = 80;
const PADDING = 80;

/**
 * Sugiyama-style layered auto-layout for event canvas.
 *
 * Layout strategy:
 *   Layer 0 (left):  All EventSource nodes
 *   Layer 1 (right): All PersonaConsumer nodes connected to sources
 *   Layer 2 (far right): Unconnected PersonaConsumer nodes
 *   Sticky notes: untouched (keep current positions)
 *
 * Within each layer, nodes are stacked vertically and centered.
 */
export function computeAutoLayout(nodes: Node[], edges: Edge[]): Node[] {
  // Separate node types
  const sources: Node[] = [];
  const consumers: Node[] = [];
  const others: Node[] = []; // sticky notes etc.

  for (const n of nodes) {
    if (n.type === NODE_TYPE_EVENT_SOURCE) sources.push(n);
    else if (n.type === NODE_TYPE_PERSONA_CONSUMER) consumers.push(n);
    else others.push(n);
  }

  // Determine which consumers are connected
  const connectedConsumerIds = new Set(edges.map(e => e.target));
  const connectedConsumers = consumers.filter(n => connectedConsumerIds.has(n.id));
  const orphanConsumers = consumers.filter(n => !connectedConsumerIds.has(n.id));

  // Sort for deterministic layout
  sources.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  connectedConsumers.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  orphanConsumers.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Assign positions
  const result: Node[] = [];

  // Layer 0: sources (left column)
  const sourceX = PADDING;
  const sourceStartY = PADDING;
  for (let i = 0; i < sources.length; i++) {
    result.push({
      ...sources[i]!,
      position: {
        x: snapToGrid(sourceX),
        y: snapToGrid(sourceStartY + i * (NODE_H + Y_GAP)),
      },
    });
  }

  // Layer 1: connected consumers (right column)
  const consumerX = PADDING + NODE_W + X_GAP;
  const consumerStartY = PADDING;
  for (let i = 0; i < connectedConsumers.length; i++) {
    result.push({
      ...connectedConsumers[i]!,
      position: {
        x: snapToGrid(consumerX),
        y: snapToGrid(consumerStartY + i * (NODE_H + Y_GAP)),
      },
    });
  }

  // Layer 2: orphan consumers (below connected, same X)
  const orphanStartY = consumerStartY + Math.max(connectedConsumers.length, sources.length) * (NODE_H + Y_GAP) + Y_GAP;
  for (let i = 0; i < orphanConsumers.length; i++) {
    result.push({
      ...orphanConsumers[i]!,
      position: {
        x: snapToGrid(consumerX),
        y: snapToGrid(orphanStartY + i * (NODE_H + Y_GAP)),
      },
    });
  }

  // Keep sticky notes and other nodes unchanged
  result.push(...others);

  return result;
}
