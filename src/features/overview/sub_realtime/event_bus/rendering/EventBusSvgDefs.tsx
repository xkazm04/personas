import { CX, CY, CORE_OUTER_R, CORE_INNER_R } from '../../libs/visualizationHelpers';

// ── SVG <defs> and central core hub ──────────────────────────────

interface SvgDefsProps {
  uid: string;
  hasTraffic: boolean;
}

export function EventBusSvgDefs({ uid, hasTraffic }: SvgDefsProps) {
  return (
    <>
      <defs>
        <filter id={`${uid}-glow`}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={`${uid}-pGlow`}>
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id={`${uid}-coreGrad`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={hasTraffic ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.2)'} />
          <stop offset="40%" stopColor={hasTraffic ? 'rgba(168,85,247,0.2)' : 'rgba(168,85,247,0.08)'} />
          <stop offset="100%" stopColor="rgba(6,182,212,0)" />
        </radialGradient>
      </defs>

      {/* Central Core */}
      <circle cx={CX} cy={CY} r={CORE_OUTER_R} fill={`url(#${uid}-coreGrad)`} />
      <circle
        cx={CX} cy={CY} r={CORE_INNER_R}
        fill="rgba(255,255,255,0.03)"
        stroke={hasTraffic ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.15)'}
        strokeWidth="0.4"
        className="transition-all duration-700"
      />
      {/* Slow idle pulse */}
      <circle cx={CX} cy={CY} r={CORE_INNER_R + 2} fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="0.15">
        <animate attributeName="r" values={`${CORE_INNER_R + 1};${CORE_INNER_R + 2.5};${CORE_INNER_R + 1}`} dur="5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.12;0.03;0.12" dur="5s" repeatCount="indefinite" />
      </circle>
      <text
        x={CX} y={CY + 0.6} textAnchor="middle" dominantBaseline="middle"
        fill={hasTraffic ? 'rgba(6,182,212,0.8)' : 'rgba(6,182,212,0.4)'}
        fontSize="2.4" fontFamily="monospace" letterSpacing="0.15em"
        className="transition-all duration-700"
      >
        BUS
      </text>
    </>
  );
}
