/**
 * Server control's app servers as live tiles (spark server-control; the
 * winner of the 2026-10-06 prototype round over Rack, Port map, Switchboard).
 *
 * One large card per app, grouped
 * under a heading in the workspace's colour. A running tile pulses along its
 * top edge in the theme primary (the motif the Monitor bay shares); its state
 * block washes the foot of the tile in the state's tone; hover or focus grows
 * the power control into a large lit disc. Owns presentation only; see
 * `./serverTilesProps.ts`.
 */
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { formatUptime, groupByWorkspace, useNowSeconds, useWorkspaceIndex } from './serverModel';
import { isLive } from './serverTone';
import type { ServerTilesProps } from './serverTilesProps';
import { TileCard } from './tiles/TileCard';
import { TilesGhost } from './tiles/TilesGhost';
import './tiles/tiles.css';

export default function ServerTiles({ servers, loading, hostPort, onMenu, onToggle }: ServerTilesProps) {
  const { t, tx } = useTranslation();
  const lt = t.browser.servers.tiles;
  const workspaces = useWorkspaceIndex();
  const ticking = servers.some((s) => s.state === 'running' || s.state === 'starting');
  const now = useNowSeconds(ticking);

  if (loading) return <TilesGhost />;

  return (
    <div className="lt-root" role="group" aria-label={lt.grid_label}>
      {groupByWorkspace(servers).map((group) => {
        const ws = group.workspaceId ? workspaces.get(group.workspaceId) : undefined;
        const live = group.servers.filter((s) => isLive(s.state)).length;
        // The workspace colour is user data (a stored hex), so it enters as a
        // custom property and every paint over it stays a color-mix in tiles.css.
        const style = ws ? ({ '--ws': ws.color } as CSSProperties) : undefined;
        return (
          <section
            key={group.workspaceId ?? 'none'}
            className="lt-group"
            style={style}
            data-testid="server-tiles-group"
            data-workspace-id={group.workspaceId ?? ''}
          >
            <header className="lt-group__head">
              <span className="lt-group__swatch" aria-hidden="true" />
              <h3 className="lt-group__name typo-heading">{ws?.name ?? lt.no_workspace}</h3>
              <span className="typo-caption text-foreground">{tx(group.servers.length === 1 ? lt.group_apps_one : lt.group_apps_other, { count: group.servers.length })}</span>
              {live > 0 && <span className="typo-caption text-primary">{tx(lt.group_live, { count: live })}</span>}
              <span className="lt-group__rule" aria-hidden="true" />
            </header>
            <div className="lt-grid">
              {group.servers.map((server) => (
                <TileCard
                  key={server.projectId}
                  server={server}
                  uptime={formatUptime(server.startedAt, now)}
                  hostPort={hostPort}
                  onMenu={onMenu}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
