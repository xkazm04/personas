import { useMemo } from 'react';

const WIDTH = 48;
const HEIGHT = 32;
const NODE_R = 2;
const PADDING = 4;

interface N8nNode {
  type?: string;
  position?: [number, number];
}

interface N8nWorkflow {
  nodes?: N8nNode[];
}

function isTriggerNode(type: string | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return lower.includes('trigger') || lower.startsWith('n8n-nodes-base.webhook');
}

function isActionNode(type: string | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return (
    lower.includes('http')
    || lower.includes('function')
    || lower.includes('code')
    || lower.includes('set')
    || lower.includes('if')
    || lower.includes('switch')
    || lower.includes('merge')
    || lower.includes('split')
  );
}

interface WorkflowThumbnailProps {
  rawWorkflowJson: string;
}

export function WorkflowThumbnail({ rawWorkflowJson }: WorkflowThumbnailProps) {
  const elements = useMemo(() => {
    try {
      const parsed = JSON.parse(rawWorkflowJson) as N8nWorkflow;
      const nodes = (parsed.nodes ?? []).filter(
        (n): n is N8nNode & { position: [number, number] } =>
          Array.isArray(n.position) && n.position.length >= 2,
      );
      if (nodes.length === 0) return null;

      // Compute bounding box
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.position[0] < minX) minX = n.position[0];
        if (n.position[0] > maxX) maxX = n.position[0];
        if (n.position[1] < minY) minY = n.position[1];
        if (n.position[1] > maxY) maxY = n.position[1];
      }

      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const viewW = WIDTH - PADDING * 2;
      const viewH = HEIGHT - PADDING * 2;

      const mapped = nodes.map((n) => ({
        x: PADDING + ((n.position[0] - minX) / rangeX) * viewW,
        y: PADDING + ((n.position[1] - minY) / rangeY) * viewH,
        type: n.type,
      }));

      // Sort by x position to create sequential connections
      const sorted = [...mapped].sort((a, b) => a.x - b.x);

      return { nodes: mapped, sorted };
    } catch {
      return null;
    }
  }, [rawWorkflowJson]);

  if (!elements) {
    return (
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="shrink-0 rounded bg-primary/5"
        data-testid="workflow-thumbnail-empty"
      >
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={3} fill="none" />
      </svg>
    );
  }

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="shrink-0 rounded bg-primary/5"
      data-testid="workflow-thumbnail"
    >
      {/* Connections between sequential nodes */}
      {elements.sorted.map((node, i) => {
        if (i === 0) return null;
        const prev = elements.sorted[i - 1]!;
        return (
          <line
            key={`edge-${i}`}
            x1={prev.x}
            y1={prev.y}
            x2={node.x}
            y2={node.y}
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeWidth={1}
          />
        );
      })}
      {/* Nodes */}
      {elements.nodes.map((node, i) => (
        <circle
          key={`node-${i}`}
          cx={node.x}
          cy={node.y}
          r={NODE_R}
          fill={
            isTriggerNode(node.type)
              ? 'rgb(245, 158, 11)'   // amber-500
              : isActionNode(node.type)
                ? 'rgb(59, 130, 246)'  // blue-500
                : 'currentColor'
          }
          fillOpacity={isTriggerNode(node.type) || isActionNode(node.type) ? 0.8 : 0.2}
        />
      ))}
    </svg>
  );
}
