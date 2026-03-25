import { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';

export interface EventEdgeData {
  triggerId: string;
  eventType: string;
  sourceFilter: string | null;
  [key: string]: unknown;
}

function EventEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const d = data as EventEdgeData | undefined;
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  return (
    <>
      {/* Invisible wider path for easier hover/click */}
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
          stroke: selected ? 'hsl(var(--primary))' : hovered ? 'hsl(var(--primary) / 0.6)' : 'hsl(var(--primary) / 0.25)',
          strokeWidth: selected ? 2 : 1.5,
          transition: 'stroke 0.15s, stroke-width 0.15s',
        }}
      />

      {/* Edge label + delete button on hover */}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-auto flex items-center gap-1.5 px-2 py-1 rounded-md bg-popover border border-primary/15 shadow-lg"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[140px]">
              {d?.eventType ?? 'event'}
            </span>
            {d?.sourceFilter && (
              <span className="text-[9px] text-muted-foreground/60 truncate max-w-[80px]">
                ({d.sourceFilter})
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const EventEdge = memo(EventEdgeInner);
