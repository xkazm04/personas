/**
 * Live tiles: one app as a card. Big name, the port in large figures beside
 * the tech wells, the dev command in mono, and the state block at its foot.
 * The top edge is the tile's lamp: running pulses in the theme primary.
 * Right-click anywhere on the tile, or the Menu key / Shift+F10 while it has
 * focus, opens the shared server menu.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { techTokens } from '../../serverModel';
import type { ServerVariantProps } from '../../serverVariantProps';
import { openMenuFromKey, tileControl, tileTone } from './tileModel';
import { TileStateBlock } from './TileStateBlock';
import { TileTech } from './TileTech';

interface Props extends Pick<ServerVariantProps, 'hostPort' | 'onMenu' | 'onToggle'> {
  server: DevServerView;
  uptime: string | null;
}

export function TileCard({ server, uptime, hostPort, onMenu, onToggle }: Props) {
  const { t, tx } = useTranslation();
  const s = t.browser.servers;
  const control = tileControl(server, hostPort);
  const tone = tileTone(server);
  const stateWord = s[`state_${server.state}`];
  const classes = [
    'lt-card',
    `lt-t-${tone}`,
    server.state === 'running' && 'is-run',
    server.state === 'starting' && 'is-starting',
    control === 'host' && 'is-host',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classes}
      tabIndex={0}
      aria-label={tx(s.tiles.card_label, { name: server.projectName, port: server.devPort, state: stateWord })}
      data-testid="server-item"
      data-project-id={server.projectId}
      data-state={server.state}
      onContextMenu={(e) => onMenu(e, server)}
      onKeyDown={openMenuFromKey}
    >
      <div className="lt-card__body">
        <div className="lt-card__top">
          <h4 className="lt-name typo-heading-lg">{server.projectName}</h4>
          {control === 'host' && (
            <Tooltip content={s.host_guard}>
              <span className="lt-host typo-caption" data-testid="server-item-host-guard">
                {s.tiles.host_chip}
              </span>
            </Tooltip>
          )}
        </div>
        <span className="lt-port" aria-label={`${s.port_label} ${server.devPort}`}>
          <span className="lt-port__colon" aria-hidden="true">:</span>
          {server.devPort}
        </span>
        <TileTech tokens={techTokens(server)} label={s.tech_label} />
        {/* No command: the state block already says so, so the body does not repeat it. */}
        {server.devCommand && (
          <code className="lt-cmd typo-code" aria-label={s.command_label}>
            {server.devCommand}
          </code>
        )}
      </div>
      <TileStateBlock server={server} control={control} uptime={uptime} onToggle={onToggle} />
    </article>
  );
}
