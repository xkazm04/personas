// The whole right-click menu Server control opens on a server: the shared
// run/stop half (`serverMenuItems`, which the Fleet Monitor bay uses as is)
// plus the three items only this page offers, because only this page has the
// modals behind them.

import { Pencil, ScanSearch, Trash2 } from 'lucide-react';

import type { ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { serverMenuItems, type ServerMenuLabels } from './serverMenuItems';
import { isLive } from './serverTone';

export interface SectionMenuLabels extends ServerMenuLabels {
  edit: string;
  rescan: string;
  remove: string;
  /** Hint under a disabled Remove: the port is held, so stop it first. */
  removeLive: string;
}

export interface SectionMenuHandlers {
  onEdit: (server: DevServerView) => void;
  onRescan: (server: DevServerView) => void;
  onRemove: (server: DevServerView) => void;
}

export function sectionMenuItems(
  server: DevServerView,
  opts: { hostPort: number | null; labels: SectionMenuLabels } & SectionMenuHandlers,
): ContextMenuItem[] {
  const { labels } = opts;
  const scanning = server.state === 'scanning';
  const live = isLive(server.state);
  return [
    ...serverMenuItems(server, { hostPort: opts.hostPort, labels }),
    {
      id: 'edit',
      label: labels.edit,
      icon: <Pencil className="h-3.5 w-3.5" />,
      separatorBefore: true,
      disabled: scanning,
      testId: 'server-menu-edit',
      onSelect: () => opts.onEdit(server),
    },
    {
      id: 'rescan',
      label: labels.rescan,
      icon: <ScanSearch className="h-3.5 w-3.5" />,
      disabled: scanning,
      testId: 'server-menu-rescan',
      onSelect: () => opts.onRescan(server),
    },
    {
      id: 'remove',
      label: labels.remove,
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      separatorBefore: true,
      disabled: live,
      hint: live ? labels.removeLive : undefined,
      testId: 'server-menu-remove',
      onSelect: () => opts.onRemove(server),
    },
  ];
}
