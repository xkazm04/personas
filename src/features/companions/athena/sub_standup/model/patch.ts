/** Intent -> wire patch (`standup_update_item` applies it). */
import type { StandupItemPatch } from '@/lib/bindings/StandupItemPatch';
import type { RowView } from './types';

export function pickPatch(row: RowView, index: number): StandupItemPatch | null {
  const proposal = row.proposals[index];
  if (!row.itemId || !proposal) return null;
  return { id: row.itemId, state: 'accepted', chosen: proposal.text };
}

export function typedPatch(row: RowView, text: string): StandupItemPatch | null {
  const chosen = text.trim();
  if (!row.itemId || !chosen) return null;
  return { id: row.itemId, state: 'edited', chosen };
}

export function statePatch(row: RowView, state: 'accepted' | 'skipped' | 'proposed'): StandupItemPatch | null {
  return row.itemId ? { id: row.itemId, state } : null;
}
