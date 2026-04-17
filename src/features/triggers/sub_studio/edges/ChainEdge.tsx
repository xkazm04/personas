import { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import type { ChainEdgeData } from '../libs/triggerStudioConstants';

function ChainEdgeInner({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, selected,
}: EdgeProps) {
  const d = data as ChainEdgeData | undefined;
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 16,
  });

  const isConditional = !!d?.conditionBranch;
  let strokeColor = '#6366f1'; // indigo
  let strokeWidth = 2;
  let dashArray: string | undefined;

  if (isConditional) {
    strokeColor = '#f59e0b';
    dashArray = '6 3';
  }

  if (d?.animated) {
    strokeColor = '#10b981';
    strokeWidth = 3;
  } else if (selected) {
    strokeWidth = 3;
  } else if (hovered) {
    strokeWidth = 2.5;
  }

  const label = d?.label || d?.conditionBranch;

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: dashArray,
          transition: 'stroke 0.15s, stroke-width 0.15s',
        }}
      />

      {d?.animated && (
        <circle r="4" fill="#10b981" opacity={0.9}>
          <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {(hovered || selected) && label && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none flex items-center gap-1.5 px-2 py-1 rounded-input bg-card border border-primary/15 shadow-elevation-3"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[140px]">
              {label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ChainEdge = memo(ChainEdgeInner);
