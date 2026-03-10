import type { DiscoveredSource } from '../../libs/visualizationHelpers';

// ── SVG status badges at the bottom of the visualization ─────────

interface BadgesProps {
  inFlightCount: number;
  discoveredSourcesRef: React.RefObject<Map<string, DiscoveredSource>>;
  agentCount: number;
}

export function EventBusBadges({ inFlightCount, discoveredSourcesRef, agentCount }: BadgesProps) {
  return (
    <>
      {/* In-flight events (right) */}
      <rect x={72} y={91} width={24} height={5} rx={2.5} fill="rgba(6,182,212,0.08)" stroke="rgba(6,182,212,0.15)" strokeWidth="0.3" />
      <text
        x={84} y={93.8} textAnchor="middle" dominantBaseline="middle"
        fill={inFlightCount > 0 ? 'rgba(6,182,212,0.9)' : 'rgba(6,182,212,0.4)'}
        fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em"
      >
        {inFlightCount} in-flight
      </text>

      {/* Source count (center) */}
      {discoveredSourcesRef.current.size > 0 && (
        <>
          <rect x={38} y={91} width={24} height={5} rx={2.5} fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.15)" strokeWidth="0.3" />
          <text x={50} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(245,158,11,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">
            {discoveredSourcesRef.current.size} sources
          </text>
        </>
      )}

      {/* Agent count (left) */}
      <rect x={4} y={91} width={24} height={5} rx={2.5} fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.15)" strokeWidth="0.3" />
      <text x={16} y={93.8} textAnchor="middle" dominantBaseline="middle" fill="rgba(168,85,247,0.6)" fontSize="2.2" fontFamily="monospace" letterSpacing="0.06em">
        {agentCount} agents
      </text>
    </>
  );
}
