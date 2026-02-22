import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { getConnectionStyle } from './teamConstants';

export default function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const connType = (data as Record<string, unknown>)?.connection_type as string || 'sequential';
  const label = (data as Record<string, unknown>)?.label as string || '';
  const isActive = (data as Record<string, unknown>)?.isActive === true;
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
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: typeStyle.stroke,
          strokeWidth: typeStyle.strokeWidth,
          strokeDasharray: typeStyle.strokeDasharray,
        }}
      />
      {isActive && (
        <path
          d={edgePath}
          fill="none"
          stroke={typeStyle.stroke}
          strokeWidth={typeStyle.strokeWidth + 1}
          strokeDasharray="8 6"
          strokeLinecap="round"
          className="animate-[dash-flow_1.2s_linear_infinite]"
          style={{ opacity: 0.8 }}
        />
      )}
      {label && (
        <foreignObject
          width={80}
          height={24}
          x={labelX - 40}
          y={labelY - 12}
          className="pointer-events-none"
        >
          <div className="flex items-center justify-center h-full">
            <span
              className="px-2 py-0.5 text-sm font-mono rounded-full border backdrop-blur-sm"
              style={{
                backgroundColor: typeStyle.stroke + '15',
                borderColor: typeStyle.stroke + '30',
                color: typeStyle.stroke,
              }}
            >
              {label}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}
