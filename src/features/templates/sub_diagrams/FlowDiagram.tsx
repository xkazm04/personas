import { useMemo } from 'react';
import type { UseCaseFlow, FlowNode } from '@/lib/types/frontendTypes';
import FlowNodeCard from './FlowNodeCard';

// ============================================================================
// Simple vertical flow with BFS layering
// ============================================================================

export default function FlowDiagram({
  flow,
  onNodeClick,
}: {
  flow: UseCaseFlow;
  onNodeClick: (node: FlowNode, e: React.MouseEvent) => void;
}) {
  // The backend shape-checks use_case_flows only one level deep, and the TS type
  // asserts nodes/edges are arrays the LLM may actually omit. Normalize on read
  // so a single malformed flow (missing `nodes` or `edges`) can't throw
  // "x is not iterable" inside a useMemo and blank the whole diagram modal.
  // Dedupe nodes by id. LLM output can repeat a node id; downstream that's
  // corrosive — `nodeMap` (a Map keyed by id) would silently keep only the
  // last node per id and drop the rest from the diagram, and two same-id nodes
  // landing in one layer collide on React's `key={node.id}`. Dedupe up front,
  // keeping the first occurrence, so every derived structure (adjacency,
  // inDegree, layers, nodeMap, keys) is 1:1 and stable. Warn in dev so a
  // malformed flow surfaces instead of rendering a silently-truncated graph.
  const safeNodes = useMemo(() => {
    const raw = flow.nodes ?? [];
    const seen = new Set<string>();
    const deduped: FlowNode[] = [];
    for (const node of raw) {
      if (seen.has(node.id)) {
        if (import.meta.env.DEV) {
          console.warn(
            `[FlowDiagram] duplicate node id "${node.id}" — keeping the first occurrence, dropping the duplicate.`,
          );
        }
        continue;
      }
      seen.add(node.id);
      deduped.push(node);
    }
    return deduped;
  }, [flow.nodes]);
  const safeEdges = useMemo(() => flow.edges ?? [], [flow.edges]);

  // Build adjacency from edges
  const adjacency = useMemo(() => {
    const adj = new Map<string, { target: string; label?: string }[]>();
    for (const edge of safeEdges) {
      const list = adj.get(edge.source) || [];
      list.push({ target: edge.target, label: edge.label });
      adj.set(edge.source, list);
    }
    return adj;
  }, [safeEdges]);

  // BFS layering
  const layers = useMemo(() => {
    const inDegree = new Map<string, number>();
    for (const node of safeNodes) inDegree.set(node.id, 0);
    for (const edge of safeEdges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    const visited = new Set<string>();
    const result: string[][] = [];
    let queue = safeNodes
      .filter(n => n.type === 'start' || (inDegree.get(n.id) || 0) === 0)
      .map(n => n.id);

    if (queue.length === 0 && safeNodes.length > 0) {
      const first = safeNodes[0];
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
    for (const node of safeNodes) {
      if (!visited.has(node.id)) {
        if (result.length === 0) result.push([]);
        const lastLevel = result[result.length - 1];
        if (lastLevel) lastLevel.push(node.id);
      }
    }

    return result;
  }, [safeNodes, safeEdges, adjacency]);

  const nodeMap = useMemo(() => new Map(safeNodes.map(n => [n.id, n])), [safeNodes]);

  // Collect unique edge labels between consecutive layers
  const interLayerLabels = useMemo(() => {
    const result: string[][] = [];
    for (let i = 0; i < layers.length; i++) {
      if (i === 0) { result.push([]); continue; }
      const prevSet = new Set(layers[i - 1]);
      const currSet = new Set(layers[i]);
      const labels: string[] = [];
      for (const edge of safeEdges) {
        if (prevSet.has(edge.source) && currSet.has(edge.target) && edge.label) {
          if (!labels.includes(edge.label)) labels.push(edge.label);
        }
      }
      result.push(labels);
    }
    return result;
  }, [layers, safeEdges]);

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
