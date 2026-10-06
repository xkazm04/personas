import type { MouseEvent } from 'react';

import type { DevServerView } from '@/lib/bindings/DevServerView';

/**
 * What the server tiles receive. The tiles own only presentation: the section
 * owns the data, the right-click menu and the modals. Live tiles won the
 * four-way prototype round (Rack, Port map, Switchboard, Live tiles) on
 * 2026-10-06; the other three were deleted.
 */
export interface ServerTilesProps {
  servers: readonly DevServerView[];
  /** First load only: render the ghost under the chrome, not a spinner. */
  loading: boolean;
  /** Port of the dev server serving THIS window, or null. Its Stop and Restart are disabled. */
  hostPort: number | null;
  /** Opens the shared right-click menu at the pointer. Call it from `onContextMenu`. */
  onMenu: (e: MouseEvent, server: DevServerView) => void;
  /** Primary control: start a stopped/failed server, stop a running/starting/external one. */
  onToggle: (server: DevServerView) => void;
  /** Opens Add app. */
  onAdd: () => void;
}
