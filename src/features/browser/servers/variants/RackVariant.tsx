/**
 * Server control prototype: Rack. Every app is a 1U rack unit, mounted under a
 * thin rail in its workspace's colour. Hardware metaphor, dense. Owns
 * presentation only; see `../serverVariantProps.ts`.
 *
 * `onAdd` is deliberately unused: the page header already carries Add app, and
 * a blank "add" panel at the foot of the rack repeated it.
 */
import { useTranslation } from '@/i18n/useTranslation';

import { groupByWorkspace, useNowSeconds, useWorkspaceIndex } from '../serverModel';
import { isLive } from '../serverTone';
import type { ServerVariantProps } from '../serverVariantProps';
import { RackGhost, RackRail } from './rack/RackRail';
import { RackUnit } from './rack/RackUnit';
import './rack/rack.css';

export default function RackVariant({ servers, loading, hostPort, onMenu, onToggle }: ServerVariantProps) {
  const { t } = useTranslation();
  const workspaces = useWorkspaceIndex();
  const ticking = servers.some((server) => server.startedAt != null && isLive(server.state));
  const now = useNowSeconds(ticking);

  if (loading) return <RackGhost />;

  return (
    <ul className="rk-root" data-testid="rack" aria-label={t.browser.servers.rack.rack_label}>
      {groupByWorkspace(servers).map((group) => (
        <li key={group.workspaceId ?? 'none'} className="flex flex-col gap-0.5">
          <RackRail
            workspace={group.workspaceId ? (workspaces.get(group.workspaceId) ?? null) : null}
            hasWorkspace={group.workspaceId != null}
            units={group.servers.length}
            live={group.servers.filter((server) => server.state === 'running').length}
          />
          <ul className="flex flex-col gap-0.5">
            {group.servers.map((server) => (
              <RackUnit
                key={server.projectId}
                server={server}
                hostPort={hostPort}
                now={now}
                onMenu={onMenu}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
