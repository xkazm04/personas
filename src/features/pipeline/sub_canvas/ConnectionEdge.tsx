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
  const dryRunCompleted = (data as Record<string, unknown>)?.dryRunCompleted === true;
  const dryRunActive = (data as Record<string, unknown>)?.dryRunActive === true;
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

  // Determine edge opacity and styling based on dry-run state
  const edgeOpacity = dryRunCompleted || dryRunActive ? 1 : undefined;
  const edgeStrokeWidth = dryRunActive ? typeStyle.strokeWidth + 1.5 : dryRunCompleted ? typeStyle.strokeWidth + 0.5 : typeStyle.strokeWidth;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: dryRunCompleted ? '#10b981' : dryRunActive ? '#f59e0b' : typeStyle.stroke,
          strokeWidth: edgeStrokeWidth,
          strokeDasharray: typeStyle.strokeDasharray,
          opacity: edgeOpacity,
        }}
      />
      {/* Animated particles on active edges */}
      {(isActive || dryRunActive) &&
        [0, 1, 2].map((i) => {
          const particleColor = dryRunActive ? '#f59e0b' : typeStyle.stroke;
          const dur = dryRunActive ? 2.5 : 1.5;
          const delay = (dur / 3) * i;
          return (
            <g key={i}>
              {/* Glow halo */}
              <circle r={5} fill={particleColor} opacity={0.15}>
                <animateMotion
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                  begin={`${delay}s`}
                  path={edgePath}
                />
              </circle>
              {/* Core particle */}
              <circle r={2.5} fill={particleColor} opacity={0.85}>
                <animateMotion
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                  begin={`${delay}s`}
                  path={edgePath}
                />
              </circle>
            </g>
          );
        })}
      {/* Dry-run completed glow */}
      {dryRunCompleted && (
        <path
          d={edgePath}
          fill="none"
          stroke="#10b981"
          strokeWidth={typeStyle.strokeWidth + 3}
          strokeLinecap="round"
          style={{ opacity: 0.15 }}
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
