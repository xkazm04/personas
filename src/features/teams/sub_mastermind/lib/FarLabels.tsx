// Screen-space label layer for far zoom — the Civilization city-label trick:
// island names render OUTSIDE the world transform at a fixed screen size, so
// the core identity stays readable no matter how far out the camera is.
import { STATE_INK } from './ink';
import type { Camera, Island } from './types';

export function FarLabels({ islands, cam, fontFamily, uppercase = false, square = false }: {
  islands: Island[];
  cam: Camera;
  fontFamily: string;
  uppercase?: boolean;
  /** Status marker shape: square (tactical) instead of circle (cartographic). */
  square?: boolean;
}) {
  return (
    <g pointerEvents="none">
      {islands.map((i) => {
        const sx = i.x * cam.z + cam.x;
        const sy = i.y * cam.z + cam.y;
        const ink = STATE_INK[i.state];
        return (
          <g key={i.slug} transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}>
            {square
              ? <rect x={-3.5} y={-16.5} width={7} height={7} fill={ink} />
              : <circle cy={-13} r={3.5} fill={ink} />}
            <text
              y={4}
              textAnchor="middle"
              fontSize={13.5}
              fontWeight={600}
              fontFamily={fontFamily}
              letterSpacing={uppercase ? '0.14em' : '0.02em'}
              fill="var(--foreground)"
              style={{ paintOrder: 'stroke', stroke: 'var(--background)', strokeWidth: 4, strokeLinejoin: 'round', ...(uppercase ? { textTransform: 'uppercase' as const } : {}) }}
            >
              {i.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}
