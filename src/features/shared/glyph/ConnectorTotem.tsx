import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { GlyphConnector } from './types';
import { stackOffset } from './helpers';

interface ConnectorTotemProps {
  connectors: GlyphConnector[];
  tileSize: number;
  spacing: number;
  max?: number;
}

/** Right-side vertical stack of connector brand tiles for a capability card.
 *  First connector anchors at mid-height; the rest alternate above / below. */
export function ConnectorTotem({ connectors, tileSize, spacing, max = 6 }: ConnectorTotemProps) {
  const shown = connectors.slice(0, max);
  const overflow = connectors.length - shown.length;
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ right: 10, width: tileSize }}>
      {shown.map((cn, i) => {
        const offset = stackOffset(i);
        const meta = getConnectorMeta(cn.name);
        return (
          <div
            key={`${cn.name}-${i}`}
            className="absolute rounded-md bg-card-bg/90 backdrop-blur border border-card-border flex items-center justify-center shadow-elevation-1"
            style={{
              top: `calc(50% + ${offset * spacing}px)`,
              width: tileSize,
              height: tileSize,
              transform: 'translateY(-50%)',
              boxShadow: `0 0 10px ${(meta?.color ?? '#60a5fa')}33, 0 1px 2px rgba(0,0,0,0.25)`,
            }}
            title={`${cn.label || cn.name}${cn.purpose ? ` — ${cn.purpose}` : ''}`}
          >
            <ConnectorIcon meta={meta} size={tileSize >= 44 ? 'w-6 h-6' : 'w-4 h-4'} />
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          className="absolute rounded-md bg-card-bg/90 backdrop-blur border border-dashed border-card-border flex items-center justify-center text-foreground/65 typo-label tabular-nums"
          style={{
            top: `calc(50% + ${stackOffset(max) * spacing}px)`,
            width: tileSize,
            height: tileSize,
            transform: 'translateY(-50%)',
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
