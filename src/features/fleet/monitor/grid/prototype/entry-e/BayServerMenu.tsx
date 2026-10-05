// The project bay's right-click menu and its dev-server chip. The menu is the
// project switch, then the run half of Server control's own menu
// (`serverMenuItems`), so Start / Stop / Restart / Open are disabled for the
// same reasons on both surfaces. A project with no server configured gets the
// switch alone. The chip is the server's lamp and port on the nameplate,
// drawn only while something holds the port.

import { createPortal } from 'react-dom';
import { Power, PowerOff } from 'lucide-react';

import { serverMenuItems } from '@/features/browser/servers/serverMenuItems';
import { readHostPort } from '@/features/browser/servers/serverTone';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { useToggleProject } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import type { ColumnMenuAnchor } from '../../board/WorkspaceGroup';
import { Lamp } from './parts';
import { toneClass, type Lamp as LampModel } from './tone';

/** The server's tooltip line while it holds its port, else null. */
export function useServerHint(server: DevServerView | null): string | null {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  if (!server) return null;
  const port = { port: server.devPort };
  if (server.state === 'running') return tx(m.server_running_hint, port);
  if (server.state === 'starting') return tx(m.server_starting_hint, port);
  if (server.state === 'external') return tx(m.server_external_hint, port);
  return null;
}

const CHIP_LAMP: Partial<Record<DevServerView['state'], LampModel>> = {
  running: { tone: 'run', lit: true },
  starting: { tone: 'run', lit: false },
  external: { tone: 'info', lit: true },
};

/**
 * Lamp plus port in a socket on the nameplate, so it does not read as one more
 * live-session count beside it. Its words ride the nameplate's own tooltip.
 */
export function BayServerChip({ server, hint }: { server: DevServerView | null; hint: string | null }) {
  const lamp = server ? CHIP_LAMP[server.state] : undefined;
  if (!server || !lamp || !hint) return null;
  return (
    <span
      className={`ae-port ${toneClass(lamp.tone)} ${server.state === 'starting' ? 'is-dim' : ''} inline-flex flex-shrink-0 items-center gap-1.5 typo-data tabular-nums ${lamp.tone === 'info' ? 'text-status-info' : 'text-primary'}`}
      data-testid="fleet-grid-column-server"
      data-server-state={server.state}
    >
      <Lamp lamp={lamp} label={hint} />
      {server.devPort}
    </span>
  );
}

export function BayProjectMenu({
  menu, onClose, name, project, server,
}: {
  menu: ColumnMenuAnchor;
  onClose: () => void;
  name: string;
  project: DevProject;
  server: DevServerView | null;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const toggleProject = useToggleProject();
  const items: ContextMenuItem[] = [{
    id: 'toggle-project',
    label: project.enabled ? t.plugins.dev_projects.project_switch_off : t.plugins.dev_projects.project_switch_on,
    icon: project.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />,
    onSelect: () => { void toggleProject(project); },
  }];
  if (server) {
    const run = serverMenuItems(server, {
      hostPort: readHostPort(),
      labels: {
        start: m.server_menu_start, stop: m.server_menu_stop, restart: m.server_menu_restart,
        open: m.server_menu_open, hostGuard: m.server_host_guard,
      },
    });
    items.push(...run.map((item, i) => (i === 0 ? { ...item, separatorBefore: true } : item)));
  }
  return createPortal(
    <ContextMenu x={menu.x} y={menu.y} onClose={onClose} ariaLabel={name} widthClass="w-56" items={items} />,
    document.body,
  );
}
