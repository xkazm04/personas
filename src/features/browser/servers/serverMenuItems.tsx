// The run/stop half of a server's right-click menu. Server control and every
// Fleet Monitor bay build their menu from this, so "Stop" is disabled for the
// same reasons on both surfaces. Labels come from the caller because the bay
// lives in the Monitor overlay, where the `browser` i18n section is not loaded.

import { ExternalLink, Play, RotateCw, Square } from 'lucide-react';

import * as browserApi from '@/api/browser';
import type { ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { serverAction } from './devServerStore';
import { canStart, canStop, isLive } from './serverTone';

export interface ServerMenuLabels {
  start: string;
  stop: string;
  restart: string;
  open: string;
  /** Hint under a disabled Stop/Restart on the server serving Personas itself. */
  hostGuard: string;
}

/** Open a server's URL in the embedded Webview and switch to it. */
export async function openServerInWebview(server: DevServerView): Promise<void> {
  try {
    await browserApi.openTab(server.url);
    const { setSidebarSection, setTeamsTab } = useSystemStore.getState();
    setSidebarSection('teams');
    setTeamsTab('webview');
  } catch (err) {
    toastCatch('dev server open')(err);
  }
}

/**
 * Start / Stop / Restart / Open in Webview for one server. Testids are
 * `server-menu-<id>` on both surfaces.
 */
export function serverMenuItems(
  server: DevServerView,
  opts: { hostPort: number | null; labels: ServerMenuLabels },
): ContextMenuItem[] {
  const { labels } = opts;
  const isHost = opts.hostPort !== null && server.devPort === opts.hostPort;
  const stoppable = canStop(server.state);
  return [
    stoppable
      ? {
          id: 'stop',
          label: labels.stop,
          icon: <Square className="h-3.5 w-3.5" />,
          danger: true,
          disabled: isHost,
          hint: isHost ? labels.hostGuard : undefined,
          testId: 'server-menu-stop',
          onSelect: () => void serverAction('stop', server.projectId),
        }
      : {
          id: 'start',
          label: labels.start,
          icon: <Play className="h-3.5 w-3.5" />,
          disabled: !canStart(server.state),
          testId: 'server-menu-start',
          onSelect: () => void serverAction('start', server.projectId),
        },
    {
      id: 'restart',
      label: labels.restart,
      icon: <RotateCw className="h-3.5 w-3.5" />,
      disabled: isHost || !(server.state === 'running' || server.state === 'starting' || server.state === 'failed'),
      hint: isHost ? labels.hostGuard : undefined,
      testId: 'server-menu-restart',
      onSelect: () => void serverAction('restart', server.projectId),
    },
    {
      id: 'open',
      label: labels.open,
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      disabled: !isLive(server.state),
      testId: 'server-menu-open',
      onSelect: () => void openServerInWebview(server),
    },
  ];
}
