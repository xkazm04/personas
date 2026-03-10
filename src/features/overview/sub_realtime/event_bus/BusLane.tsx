import { memo } from 'react';

interface Props {
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
}

function BusLaneComponent({ x, y, width, height, isActive }: Props) {
  const barHeight = height * 4;
  const barY = y - barHeight / 2;
  const cornerR = barHeight / 2;

  return (
    <g>
      {/* Background bar */}
      <rect
        x={x}
        y={barY}
        width={width}
        height={barHeight}
        rx={cornerR}
        fill="rgba(255,255,255,0.015)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.5}
      />

      {/* Gradient fill */}
      <rect
        x={x}
        y={barY}
        width={width}
        height={barHeight}
        rx={cornerR}
        fill="url(#busGradient)"
        opacity={isActive ? 0.6 : 0.3}
        className="transition-opacity duration-1000"
      />

      {/* Center dashed guide line */}
      <line
        x1={x + 12}
        y1={y}
        x2={x + width - 12}
        y2={y}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={0.5}
        strokeDasharray="4 6"
      />

      {/* "EVENT QUEUE" label */}
      <text
        x={x + width / 2}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(6, 182, 212, 0.3)"
        fontSize={9}
        fontFamily="monospace"
        letterSpacing={3}
      >
        EVENT QUEUE
      </text>

      {/* Active pulse overlay */}
      {isActive && (
        <rect
          x={x}
          y={barY - 2}
          width={width}
          height={barHeight + 4}
          rx={cornerR + 1}
          fill="url(#busGradient)"
          opacity={0.15}
        >
          <animate
            attributeName="opacity"
            values="0.08;0.2;0.08"
            dur="2.5s"
            repeatCount="indefinite"
          />
        </rect>
      )}
    </g>
  );
}

const BusLane = memo(BusLaneComponent);
export default BusLane;
