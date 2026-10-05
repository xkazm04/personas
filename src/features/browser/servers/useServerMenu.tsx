// The right-click menu for Server control: anchor state, the items and the
// portal. Variants only call `onMenu` from `onContextMenu`; the menu itself is
// drawn here, at the pointer, on `document.body` (the Fleet Monitor Bay's
// pattern), so a variant's own overflow or transform can never clip it.
//
// The anchor holds a project id, not the server: the menu reads the server
// fresh from the store on every render, so a state change while it is open
// (a server that finishes starting) updates which items are enabled.

import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ContextMenu } from '@/features/shared/components/overlays/ContextMenu';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { sectionMenuItems, type SectionMenuHandlers } from './sectionMenuItems';

interface Anchor {
  x: number;
  y: number;
  projectId: string;
}

export function useServerMenu(opts: {
  byProject: ReadonlyMap<string, DevServerView>;
  hostPort: number | null;
} & SectionMenuHandlers): { onMenu: (e: MouseEvent, server: DevServerView) => void; menu: ReactNode } {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  const onMenu = useCallback((e: MouseEvent, server: DevServerView) => {
    e.preventDefault();
    setAnchor({ x: e.clientX, y: e.clientY, projectId: server.projectId });
  }, []);

  const labels = useMemo(
    () => ({
      start: s.menu_start,
      stop: s.menu_stop,
      restart: s.menu_restart,
      open: s.menu_open,
      hostGuard: s.host_guard,
      edit: s.menu_edit,
      rescan: s.menu_rescan,
      remove: s.menu_remove,
      removeLive: s.remove_live,
    }),
    [s],
  );

  const server = anchor ? (opts.byProject.get(anchor.projectId) ?? null) : null;
  const menu =
    anchor && server
      ? createPortal(
          <ContextMenu
            x={anchor.x}
            y={anchor.y}
            onClose={close}
            ariaLabel={`${s.menu_label}: ${server.projectName}`}
            widthClass="w-60"
            items={sectionMenuItems(server, {
              hostPort: opts.hostPort,
              labels,
              onEdit: opts.onEdit,
              onRescan: opts.onRescan,
              onRemove: opts.onRemove,
            })}
          />,
          document.body,
        )
      : null;

  return { onMenu, menu };
}
