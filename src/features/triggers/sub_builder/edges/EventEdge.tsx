import { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { EVENT_EDGE_TYPES } from '../libs/eventCanvasConstants';

export interface EventEdgeData {
  triggerId: string;
  eventType: string;
  sourceFilter: string | null;
  conditionType?: string;
  dryRunCompleted?: boolean;
  dryRunActive?: boolean;
  [key: string]: unknown;
}

function EventEdgeInner({
  id,
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data, selected,
}: EdgeProps) {
  const d = data as EventEdgeData | undefined;
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 16,
  });

  // Determine styling based on condition type and dry-run state
  const condType = d?.conditionType ?? 'always';
  const typeStyle = EVENT_EDGE_TYPES[condType] ?? EVENT_EDGE_TYPES['always']!;

  let strokeColor = typeStyle.stroke;
  let strokeWidth = typeStyle.strokeWidth;
  let dashArray = typeStyle.strokeDasharray;

  if (d?.dryRunCompleted) {
    strokeColor = '#10b981'; // emerald
    strokeWidth = 3;
    dashArray = undefined;
  } else if (d?.dryRunActive) {
    strokeColor = '#f59e0b'; // amber
    strokeWidth = 3;
    dashArray = undefined;
  } else if (selected) {
    strokeWidth = 3;
  } else if (hovered) {
    strokeWidth = 2.5;
  }

  return (
    <>
      {/* Wide invisible hit area */}
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

      {/* Dry-run active: animated particle */}
      {d?.dryRunActive && (
        <circle r="4" fill="#f59e0b" opacity={0.9}>
          <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* Dry-run completed: faint glow */}
      {d?.dryRunCompleted && (
        <path
          d={edgePath}
          fill="none"
          stroke="#10b981"
          strokeWidth={6}
          opacity={0.15}
          strokeLinecap="round"
        />
      )}

      {/* Label on hover */}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none flex items-center gap-1.5 px-2 py-1 rounded-input bg-card border border-primary/15 shadow-elevation-3"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[140px]">
              {d?.eventType ?? 'event'}
            </span>
            {condType !== 'always' && (
              <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: `${strokeColor}20`, color: strokeColor }}>
                {typeStyle.label}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const EventEdge = memo(EventEdgeInner);
