import { useMemo } from 'react';
import type { UseCaseFlow, FlowNode } from '@/lib/types/frontendTypes';
import FlowNodeCard from './FlowNodeCard';

// ============================================================================
// Simple vertical flow layout with BFS layering
// ============================================================================

export default function FlowDiagram({
  flow,
  onNodeClick,
}: {
  flow: UseCaseFlow;
  onNodeClick: (node: FlowNode, e: React.MouseEvent) => void;
}) {
  // Build adjacency from edges
  const adjacency = useMemo(() => {
    const adj = new Map<string, { target: string; label?: string }[]>();
    for (const edge of flow.edges) {
      const list = adj.get(edge.source) || [];
      list.push({ target: edge.target, label: edge.label });
      adj.set(edge.source, list);
    }
    return adj;
  }, [flow.edges]);

  // BFS layering
  const layers = useMemo(() => {
    const inDegree = new Map<string, number>();
    for (const node of flow.nodes) inDegree.set(node.id, 0);
    for (const edge of flow.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    const visited = new Set<string>();
    const result: string[][] = [];
    let queue = flow.nodes
      .filter(n => n.type === 'start' || (inDegree.get(n.id) || 0) === 0)
      .map(n => n.id);

    if (queue.length === 0 && flow.nodes.length > 0) {
      const first = flow.nodes[0];
      if (first) queue = [first.id];
    }

    while (queue.length > 0) {
      const level: string[] = [];
      const next: string[] = [];
      for (const id of queue) {
        if (visited.has(id)) continue;
        visited.add(id);
        level.push(id);
        for (const { target } of adjacency.get(id) || []) {
          if (!visited.has(target)) next.push(target);
        }
      }
      if (level.length > 0) result.push(level);
      queue = next;
    }

    // Add orphaned nodes
    for (const node of flow.nodes) {
      if (!visited.has(node.id)) {
        if (result.length === 0) result.push([]);
        const lastLevel = result[result.length - 1];
        if (lastLevel) lastLevel.push(node.id);
      }
    }

    return result;
  }, [flow.nodes, flow.edges, adjacency]);

  const nodeMap = useMemo(() => new Map(flow.nodes.map(n => [n.id, n])), [flow.nodes]);

  // Collect unique edge labels between consecutive layers
  const interLayerLabels = useMemo(() => {
    const result: string[][] = [];
    for (let i = 0; i < layers.length; i++) {
      if (i === 0) { result.push([]); continue; }
      const prevSet = new Set(layers[i - 1]);
      const currSet = new Set(layers[i]);
      const labels: string[] = [];
      for (const edge of flow.edges) {
        if (prevSet.has(edge.source) && currSet.has(edge.target) && edge.label) {
          if (!labels.includes(edge.label)) labels.push(edge.label);
        }
      }
      result.push(labels);
    }
    return result;
  }, [layers, flow.edges]);

  return (
    <div className="flex flex-col items-center gap-1 py-6 px-4 overflow-auto">
      {layers.map((layer, layerIdx) => (
        <div key={layerIdx}>
          {/* Connector arrow from previous layer */}
          {layerIdx > 0 && (
            <div className="flex justify-center py-1">
              <div className="relative flex items-center justify-center">
                <svg
                  width="10"
                  height="28"
                  viewBox="0 0 10 28"
                  className="shrink-0"
                  aria-hidden="true"
                >
                  <line
                    x1="5" y1="0" x2="5" y2="20"
                    stroke="hsl(var(--primary) / 0.2)"
                    strokeWidth="1.5"
                  />
                  <polygon
                    points="1,19 5,27 9,19"
                    fill="hsl(var(--primary) / 0.3)"
                  />
                </svg>
                {interLayerLabels[layerIdx] && interLayerLabels[layerIdx].length > 0 && (
                  <div className="ml-1.5 flex gap-1">
                    {interLayerLabels[layerIdx].map((label) => (
                      <span
                        key={label}
                        className="text-[10px] leading-tight bg-primary/5 px-1.5 py-px rounded-full text-primary/60 whitespace-nowrap"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Nodes in this layer */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {layer.map(nodeId => {
              const node = nodeMap.get(nodeId);
              if (!node) return null;
              return (
                <FlowNodeCard key={node.id} node={node} onClick={onNodeClick} />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
