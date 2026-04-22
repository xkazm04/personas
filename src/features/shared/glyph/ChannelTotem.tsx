import { channelIcon, channelTint } from './channels';
import { stackOffset } from './helpers';
import type { ParsedChannel } from './types';

interface ChannelTotemProps {
  channels: ParsedChannel[];
  tileSize: number;
  spacing: number;
  max?: number;
}

/** Left-side vertical stack of notification-channel tiles. Mirrors the
 *  ConnectorTotem's center-out layout so the card's two flanks read as a
 *  matched pair of emblem strips. */
export function ChannelTotem({ channels, tileSize, spacing, max = 5 }: ChannelTotemProps) {
  const shown = channels.slice(0, max);
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ left: 10, width: tileSize }}>
      {shown.map((ch, i) => {
        const offset = stackOffset(i);
        const Icon = channelIcon(ch.type);
        const tint = channelTint(ch.type);
        return (
          <div
            key={`${ch.type}-${i}`}
            className="absolute rounded-md bg-card-bg/90 backdrop-blur border border-card-border flex items-center justify-center"
            style={{
              top: `calc(50% + ${offset * spacing}px)`,
              width: tileSize,
              height: tileSize,
              transform: 'translateY(-50%)',
              background: `linear-gradient(135deg, ${tint}22 0%, transparent 100%)`,
              boxShadow: `0 0 10px ${tint}44, 0 1px 2px rgba(0,0,0,0.25)`,
            }}
            title={`${ch.type}${ch.description ? ` — ${ch.description}` : ''}`}
          >
            <Icon className={tileSize >= 44 ? 'w-5 h-5' : 'w-4 h-4'} style={{ color: tint }} />
          </div>
        );
      })}
    </div>
  );
}
