import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { getConnectionStyle } from './teamConstants';

export default function GhostEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const connType = (data as Record<string, unknown>)?.connection_type as string || 'parallel';
  const typeStyle = getConnectionStyle(connType);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      {/* Glow layer */}
      <path
        d={edgePath}
        fill="none"
        stroke={typeStyle.stroke}
        strokeWidth={typeStyle.strokeWidth + 4}
        strokeDasharray="6 4"
        strokeLinecap="round"
        style={{ opacity: 0.1 }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: typeStyle.stroke,
          strokeWidth: typeStyle.strokeWidth,
          strokeDasharray: '6 4',
          opacity: 0.45,
        }}
      />
      {/* Animated pulse */}
      <path
        d={edgePath}
        fill="none"
        stroke={typeStyle.stroke}
        strokeWidth={typeStyle.strokeWidth}
        strokeDasharray="4 8"
        strokeLinecap="round"
        className="animate-[dash-flow_2s_linear_infinite]"
        style={{ opacity: 0.3 }}
      />
      {/* Suggestion label */}
      <foreignObject
        width={90}
        height={24}
        x={labelX - 45}
        y={labelY - 12}
        className="pointer-events-none"
      >
        <div className="flex items-center justify-center h-full">
          <span
            className="px-2 py-0.5 text-[8px] font-mono uppercase rounded-full border backdrop-blur-sm animate-pulse"
            style={{
              backgroundColor: typeStyle.stroke + '12',
              borderColor: typeStyle.stroke + '25',
              color: typeStyle.stroke,
            }}
          >
            suggested
          </span>
        </div>
      </foreignObject>
    </>
  );
}
