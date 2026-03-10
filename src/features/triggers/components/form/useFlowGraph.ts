import { useMemo } from "react";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";
import {
  NODE_W,
  NODE_H,
  GAP_X,
  GAP_Y,
  type FlowNode,
  type FlowEdge,
} from "./triggerFlowConstants";

/**
 * Builds a graph layout (nodes + edges + dimensions) from trigger chain links.
 * Uses a simple left-to-right column layout: pure sources | middle | pure targets.
 */
export function useFlowGraph(triggerChains: TriggerChainLink[]) {
  return useMemo(() => {
    const nodeMap = new Map<string, FlowNode>();
    const edgeList: FlowEdge[] = [];

    // Collect unique personas involved in chains
    for (const chain of triggerChains) {
      if (!nodeMap.has(chain.source_persona_id)) {
        nodeMap.set(chain.source_persona_id, {
          id: chain.source_persona_id,
          name: chain.source_persona_name,
          x: 0,
          y: 0,
          enabled: true,
        });
      }
      if (!nodeMap.has(chain.target_persona_id)) {
        nodeMap.set(chain.target_persona_id, {
          id: chain.target_persona_id,
          name: chain.target_persona_name,
          x: 0,
          y: 0,
          enabled: true,
        });
      }
      edgeList.push({
        id: chain.trigger_id,
        from: chain.source_persona_id,
        to: chain.target_persona_id,
        conditionType: chain.condition_type,
        enabled: chain.enabled,
      });
    }

    // Simple left-to-right layout: sources on left, targets on right
    const sources = new Set(edgeList.map((e) => e.from));
    const targets = new Set(edgeList.map((e) => e.to));
    const pureTargets = [...targets].filter((t) => !sources.has(t));
    const pureSources = [...sources].filter((s) => !targets.has(s));
    const middle = [...sources].filter((s) => targets.has(s));

    const columns = [pureSources, middle, pureTargets].filter(
      (c) => c.length > 0,
    );

    let maxRows = 0;
    columns.forEach((col, colIdx) => {
      maxRows = Math.max(maxRows, col.length);
      col.forEach((id, rowIdx) => {
        const node = nodeMap.get(id);
        if (node) {
          node.x = 40 + colIdx * GAP_X;
          node.y = 40 + rowIdx * GAP_Y;
        }
      });
    });

    const w = Math.max(40 + columns.length * GAP_X + NODE_W, 500);
    const h = Math.max(40 + maxRows * GAP_Y + NODE_H, 200);

    return {
      nodes: [...nodeMap.values()],
      edges: edgeList,
      svgWidth: w,
      svgHeight: h,
    };
  }, [triggerChains]);
}
