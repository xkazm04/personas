/**
 * Shared types for the routing-view (Dispatch) subtree.
 *
 * Kept separate from routingHelpers.ts so imports inside ./routing/ don't
 * reach back up into sibling helpers just for a type.
 */
import type { LucideIcon } from 'lucide-react';
import type { EventRow } from '../routingHelpers';

/** Per-event-type activity derived from PersonaEvent[] timestamps. */
export interface ActivityEntry {
  count: number;
  /** Epoch ms of last emission, or null if the type has no recorded events. */
  lastTs: number | null;
}

export type SortMode = 'activity' | 'label' | 'listeners' | 'sources';

export const SORT_MODES: ReadonlyArray<{ key: SortMode; label: string }> = [
  { key: 'activity',  label: 'Recent activity' },
  { key: 'listeners', label: 'Listener count' },
  { key: 'sources',   label: 'Source count' },
  { key: 'label',     label: 'Alphabetical' },
];

/**
 * Shared grid template for the row spine AND the column-header bar, so the
 * header cells (Source / Event / Listeners filters) align with every row.
 * Columns: chevron · pulse · SOURCE · arrow · EVENT · arrow · LISTENERS · time · count.
 */
export const ROUTING_GRID_COLUMNS =
  'auto auto minmax(320px, 2.2fr) auto minmax(200px, 1.3fr) auto minmax(160px, 1fr) auto auto';

/** A category panel rendered by <GroupPanel />. */
export interface GroupDef {
  id: string;
  label: string;
  icon: LucideIcon;
  accentText: string;
  accentBg: string;
  accentBorder: string;
  rows: EventRow[];
}
