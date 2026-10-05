import type { ComponentType, MouseEvent } from 'react';

import type { DevServerView } from '@/lib/bindings/DevServerView';

/**
 * The four Server control prototypes. Every variant receives the identical
 * props and owns ONLY presentation: the page owns the data, the right-click
 * menu and the modals, so no variant can quietly become a fifth product.
 */
export const SERVER_VARIANT_IDS = ['rack', 'portmap', 'switchboard', 'tiles'] as const;
export type ServerVariantId = (typeof SERVER_VARIANT_IDS)[number];

export interface ServerVariantProps {
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

export type ServerVariant = ComponentType<ServerVariantProps>;
