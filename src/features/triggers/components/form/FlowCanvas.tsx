import {
  NODE_W,
  NODE_H,
  CONDITION_COLORS,
  CONDITION_STROKE_HEX,
  type FlowNode,
  type FlowEdge,
} from "./triggerFlowConstants";

interface FlowCanvasProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  svgWidth: number;
  svgHeight: number;
}

export function FlowCanvas({ nodes, edges, svgWidth, svgHeight }: FlowCanvasProps) {
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      className="select-none"
    >
      {/* Edges */}
      {edges.map((edge) => {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);
        if (!fromNode || !toNode) return null;

        const x1 = fromNode.x + NODE_W;
        const y1 = fromNode.y + NODE_H / 2;
        const x2 = toNode.x;
        const y2 = toNode.y + NODE_H / 2;
        const midX = (x1 + x2) / 2;
        const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

        const color = edge.enabled
          ? CONDITION_COLORS[edge.conditionType] || "text-zinc-400"
          : "text-zinc-600";
        const strokeHex = edge.enabled
          ? CONDITION_STROKE_HEX[edge.conditionType] || "#a1a1aa"
          : "#52525b";

        return (
          <g key={edge.id}>
            {/* Base edge path */}
            <path
              d={pathD}
              fill="none"
              stroke={strokeHex}
              strokeWidth={edge.enabled ? 2 : 1}
              strokeDasharray={edge.enabled ? "none" : "4 4"}
              opacity={edge.enabled ? 0.5 : 0.3}
              className="transition-all duration-300"
            />
            {/* Animated dash-flow overlay for enabled edges */}
            {edge.enabled && (
              <path
                d={pathD}
                fill="none"
                stroke={strokeHex}
                strokeWidth={2.5}
                strokeDasharray="8 6"
                strokeLinecap="round"
                className="animate-[dash-flow_1.2s_linear_infinite]"
                style={{ opacity: 0.7 }}
              />
            )}
            {/* Arrow */}
            <polygon
              points={`${x2} ${y2}, ${x2 - 8} ${y2 - 4}, ${x2 - 8} ${y2 + 4}`}
              fill={strokeHex}
              opacity={edge.enabled ? 0.7 : 0.3}
            />
            {/* Condition badge on edge */}
            <foreignObject
              x={midX - 30}
              y={(y1 + y2) / 2 - 10}
              width={60}
              height={20}
            >
              <div className="flex items-center justify-center">
                <span
                  className={`text-sm px-1.5 py-0.5 rounded-lg bg-background/80 border border-border/30 ${color}`}
                >
                  {edge.conditionType}
                </span>
              </div>
            </foreignObject>
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => (
        <foreignObject
          key={node.id}
          x={node.x}
          y={node.y}
          width={NODE_W}
          height={NODE_H}
        >
          <div className="w-full h-full px-3 py-2 bg-secondary/60 backdrop-blur-sm border border-border/40 rounded-xl flex items-center gap-2 hover:border-purple-500/30 transition-colors cursor-default">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                backgroundColor: node.enabled
                  ? "rgb(16 185 129)"
                  : "rgb(113 113 122)",
              }}
            />
            <span className="text-sm font-medium text-foreground/80 truncate">
              {node.name}
            </span>
          </div>
        </foreignObject>
      ))}
    </svg>
  );
}
