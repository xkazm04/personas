import { useEffect, useRef, useState } from 'react';
import { useViewport, type Node } from '@xyflow/react';

// ── Constants ────────────────────────────────────────────────────────
const SNAP_TOLERANCE = 4;
const FADE_DURATION_MS = 200;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 70;

// ── Types ────────────────────────────────────────────────────────────
export interface AlignmentLine {
  orientation: 'horizontal' | 'vertical';
  /** Fixed coordinate of the line (x for vertical, y for horizontal) */
  pos: number;
  /** Start of the line span */
  from: number;
  /** End of the line span */
  to: number;
}

/** Given a node, return its bounding edges and center points. */
function getNodeEdges(node: Node) {
  const x = node.position.x;
  const y = node.position.y;
  const w = node.measured?.width ?? NODE_WIDTH;
  const h = node.measured?.height ?? NODE_HEIGHT;
  return {
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
    centerX: x + w / 2,
    centerY: y + h / 2,
  };
}

/**
 * Compute alignment guide lines between a dragged node and all other nodes.
 * Returns lines where any edge/center of the dragged node aligns within
 * `SNAP_TOLERANCE` px of another node's corresponding edge/center.
 */
export function computeAlignments(draggedNode: Node, otherNodes: Node[]): AlignmentLine[] {
  const lines: AlignmentLine[] = [];
  const d = getNodeEdges(draggedNode);

  for (const other of otherNodes) {
    if (other.id === draggedNode.id) continue;
    const o = getNodeEdges(other);

    // ── Vertical alignments (x-axis match → draw vertical line) ──────
    const xPairs: [number, number][] = [
      [d.left, o.left],
      [d.left, o.right],
      [d.right, o.left],
      [d.right, o.right],
      [d.centerX, o.centerX],
    ];
    for (const [dVal, oVal] of xPairs) {
      if (Math.abs(dVal - oVal) <= SNAP_TOLERANCE) {
        const minY = Math.min(d.top, o.top);
        const maxY = Math.max(d.bottom, o.bottom);
        lines.push({ orientation: 'vertical', pos: oVal, from: minY, to: maxY });
      }
    }

    // ── Horizontal alignments (y-axis match → draw horizontal line) ──
    const yPairs: [number, number][] = [
      [d.top, o.top],
      [d.top, o.bottom],
      [d.bottom, o.top],
      [d.bottom, o.bottom],
      [d.centerY, o.centerY],
    ];
    for (const [dVal, oVal] of yPairs) {
      if (Math.abs(dVal - oVal) <= SNAP_TOLERANCE) {
        const minX = Math.min(d.left, o.left);
        const maxX = Math.max(d.right, o.right);
        lines.push({ orientation: 'horizontal', pos: oVal, from: minX, to: maxX });
      }
    }
  }

  return lines;
}

// ── Component ────────────────────────────────────────────────────────
interface AlignmentGuidesProps {
  lines: AlignmentLine[];
  /** Whether a drag is actively occurring */
  isDragging: boolean;
}

/**
 * Renders inside <ReactFlow> so it can access the viewport transform.
 * Lines are specified in flow coordinates and transformed to screen space
 * via the viewport's translate + scale.
 */
export default function AlignmentGuides({ lines, isDragging }: AlignmentGuidesProps) {
  const { x: vx, y: vy, zoom } = useViewport();
  const [visible, setVisible] = useState(false);
  const [renderLines, setRenderLines] = useState<AlignmentLine[]>([]);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isDragging && lines.length > 0) {
      if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
      setRenderLines(lines);
      setVisible(true);
    } else if (!isDragging && visible) {
      fadeTimer.current = setTimeout(() => {
        setVisible(false);
        setRenderLines([]);
        fadeTimer.current = null;
      }, FADE_DURATION_MS);
    } else if (isDragging && lines.length === 0) {
      setVisible(false);
      setRenderLines([]);
    }
  }, [isDragging, lines, visible]);

  useEffect(() => {
    return () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); };
  }, []);

  if (renderLines.length === 0) return null;

  return (
    <svg
      className="react-flow__panel"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 15,
        opacity: visible && isDragging ? 1 : 0,
        transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
      }}
    >
      <g transform={`translate(${vx}, ${vy}) scale(${zoom})`}>
        {renderLines.map((line, i) => {
          if (line.orientation === 'vertical') {
            return (
              <line
                key={`v-${i}`}
                x1={line.pos}
                y1={line.from}
                x2={line.pos}
                y2={line.to}
                stroke="#3b82f6"
                strokeWidth={1 / zoom}
                strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              />
            );
          }
          return (
            <line
              key={`h-${i}`}
              x1={line.from}
              y1={line.pos}
              x2={line.to}
              y2={line.pos}
              stroke="#3b82f6"
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
          );
        })}
      </g>
    </svg>
  );
}
