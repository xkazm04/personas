import { CX, CY } from '../../libs/visualizationHelpers';
import { ORBIT_R_OUTER, ORBIT_R_INNER, CORE_R } from './EventBusTypes';

export function EventBusSvgDefs({ uid, hasTraffic }: { uid: string; hasTraffic: boolean }) {
  return (
    <defs>
      <filter id={`${uid}-softGlow`}>
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`${uid}-cometGlow`}>
        <feGaussianBlur stdDeviation="1.2" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <radialGradient id={`${uid}-nebula`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={hasTraffic ? 'rgba(139,92,246,0.30)' : 'rgba(139,92,246,0.10)'} />
        <stop offset="50%" stopColor="rgba(6,182,212,0.05)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
      </radialGradient>
      <radialGradient id={`${uid}-coreGlow`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
        <stop offset="40%" stopColor="rgba(139,92,246,0.1)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
      </radialGradient>
    </defs>
  );
}

export function EventBusCoreElements({ uid, hasTraffic }: { uid: string; hasTraffic: boolean }) {
  return (
    <>
      {/* Nebula core */}
      <circle cx={CX} cy={CY} r={28} fill={`url(#${uid}-nebula)`} />

      {/* Orbit rings */}
      <circle cx={CX} cy={CY} r={ORBIT_R_OUTER} fill="none" stroke="rgba(139,92,246,0.06)" strokeWidth="0.15" strokeDasharray="1 2" />
      <circle cx={CX} cy={CY} r={ORBIT_R_INNER} fill="none" stroke="rgba(6,182,212,0.08)" strokeWidth="0.15" strokeDasharray="0.8 1.5" />

      {/* Central hub */}
      <circle cx={CX} cy={CY} r={CORE_R + 4} fill={`url(#${uid}-coreGlow)`} />
      <circle cx={CX} cy={CY} r={CORE_R} fill="rgba(255,255,255,0.02)" stroke={hasTraffic ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.2)'} strokeWidth="0.3" className="transition-all duration-700" />
      <circle cx={CX} cy={CY} r={CORE_R * 0.45} fill="rgba(139,92,246,0.25)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.15" className="transition-all duration-700" />
      <text x={CX} y={CY + 0.5} textAnchor="middle" dominantBaseline="middle" fill={hasTraffic ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'} fontSize="2" fontFamily="monospace" letterSpacing="0.2em" className="transition-all duration-700">HUB</text>
    </>
  );
}
