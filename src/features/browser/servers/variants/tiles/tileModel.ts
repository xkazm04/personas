// Pure read-side helpers for the Live tiles prototype: what a tile's primary
// control does, and the keyboard door to the shared right-click menu. Kept out
// of the components so the decision table is tested without rendering.

import type { KeyboardEvent } from 'react';

import type { DevServerView } from '@/lib/bindings/DevServerView';

import { canStart, canStop, SERVER_TONE, type ServerTone } from '../../serverTone';

/**
 * What the tile's power control means right now.
 * - `start` / `stop`: pressable, calls `onToggle`.
 * - `host`: this server serves Personas itself; inert, explained by the host guard.
 * - `unconfigured`: no dev command yet; inert, the menu's Edit or Rescan fixes it.
 * - `busy`: a scan or a stop is in flight; inert until it settles.
 */
export type TileControl = 'start' | 'stop' | 'host' | 'unconfigured' | 'busy';

export function tileControl(server: Pick<DevServerView, 'state' | 'devPort'>, hostPort: number | null): TileControl {
  if (hostPort != null && server.devPort === hostPort) return 'host';
  if (canStop(server.state)) return 'stop';
  if (canStart(server.state)) return 'start';
  if (server.state === 'unconfigured') return 'unconfigured';
  return 'busy';
}

/** The tone a tile paints with: its top border, lamp, port ink and state block. */
export function tileTone(server: Pick<DevServerView, 'state'>): ServerTone {
  return SERVER_TONE[server.state].tone;
}

/**
 * Menu key and Shift+F10 open the same menu as a right-click. A real
 * `contextmenu` MouseEvent is dispatched on the tile, so the caller's
 * `onContextMenu` receives a genuine React MouseEvent anchored on the tile's
 * corner instead of a hand-built object posing as one.
 */
export function isMenuKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

export function openMenuFromKey(e: KeyboardEvent<HTMLElement>): void {
  if (!isMenuKey(e)) return;
  e.preventDefault();
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + 24),
      clientY: Math.round(rect.top + 24),
    }),
  );
}
