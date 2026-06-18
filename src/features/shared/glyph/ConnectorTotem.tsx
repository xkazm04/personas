import { ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { GlyphConnector } from './types';
import { stackOffset } from './helpers';

interface ConnectorTotemProps {
  connectors: GlyphConnector[];
  tileSize: number;
  spacing: number;
  max?: number;
}

/** Right-side vertical stack of connector brand tiles for a capability card.
 *  First connector anchors at mid-height; the rest alternate above / below.
 *
 *  The container stays `pointer-events-none` (it spans the card's full
 *  height over the sigil); each tile opts back in so its Tooltip can fire —
 *  the old `title=` never showed because hover couldn't reach the tiles. */
export function ConnectorTotem({ connectors, tileSize, spacing, max = 6 }: ConnectorTotemProps) {
  const shown = connectors.slice(0, max);
  const hidden = connectors.slice(max);
  const overflow = hidden.length;
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ right: 10, width: tileSize }}>
      {shown.map((cn, i) => {
        const offset = stackOffset(i);
        const meta = getConnectorMeta(cn.name);
        const label = cn.label || cn.name;
        return (
          <Tooltip
            key={`${cn.name}-${i}`}
            content={`${label}${cn.purpose ? ` — ${cn.purpose}` : ''}`}
            placement="left"
          >
            <div
              role="img"
              aria-label={label}
              className="absolute rounded-input bg-card-bg/90 backdrop-blur border border-card-border flex items-center justify-center shadow-elevation-1 pointer-events-auto cursor-default"
              style={{
                top: `calc(50% + ${offset * spacing}px)`,
                width: tileSize,
                height: tileSize,
                transform: 'translateY(-50%)',
                boxShadow: `0 0 10px ${(meta?.color ?? '#60a5fa')}33, 0 1px 2px rgba(0,0,0,0.25)`,
              }}
            >
              <ConnectorIcon meta={meta} size={tileSize >= 44 ? 'w-6 h-6' : 'w-4 h-4'} />
            </div>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <Tooltip
          content={hidden.map((cn) => cn.label || cn.name).join(', ')}
          placement="left"
        >
          <div
            className="absolute rounded-input bg-card-bg/90 backdrop-blur border border-dashed border-card-border flex items-center justify-center text-foreground typo-label tabular-nums pointer-events-auto cursor-default"
            style={{
              top: `calc(50% + ${stackOffset(max) * spacing}px)`,
              width: tileSize,
              height: tileSize,
              transform: 'translateY(-50%)',
            }}
          >
            +{overflow}
          </div>
        </Tooltip>
      )}
    </div>
  );
}
