import type { Node } from '@xyflow/react';
import { buildTeamGraph } from '@/features/pipeline/sub_canvas';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import { snapToGrid } from './useCanvasHandlers';

/**
 * Computes auto-layout positions for canvas nodes using a layered graph approach.
 * Pure function -- no side effects.
 */
export function computeAutoLayout(nds: Node[], connections: PersonaTeamConnection[]): Node[] {
  if (nds.length === 0) return nds;
  if (nds.length === 1) {
    return [{ ...nds[0]!, position: { x: snapToGrid(200), y: snapToGrid(120) } }];
  }

  const nodeWidth = 180;
  const nodeHeight = 70;
  const xGap = 60;
  const yGap = 100;

  const graph = buildTeamGraph(nds.map((n) => n.id), connections);

  const layerGroups = new Map<number, number[]>();
  nds.forEach((n, i) => {
    const layer = graph.layers.get(n.id) ?? 0;
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(i);
  });

  const maxPerLayer = Math.max(...Array.from(layerGroups.values()).map((g) => g.length));
  const totalWidth = maxPerLayer * (nodeWidth + xGap);

  return nds.map((node, i) => {
    const layerIdx = graph.layers.get(node.id) ?? 0;
    const nodesInLayer = layerGroups.get(layerIdx)!;
    const posInLayer = nodesInLayer.indexOf(i);
    const count = nodesInLayer.length;
    const layerWidth = count * (nodeWidth + xGap) - xGap;
    const startX = (totalWidth - layerWidth) / 2 + 80;
    const x = snapToGrid(startX + posInLayer * (nodeWidth + xGap));
    const y = snapToGrid(80 + layerIdx * (nodeHeight + yGap));
    return { ...node, position: { x, y } };
  });
}
