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
