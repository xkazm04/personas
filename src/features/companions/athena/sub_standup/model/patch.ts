/**
 * Intent -> wire patch, plus the local apply the dev fixture uses in place of
 * `standup_update_item` (the backend applies the same patch for real).
 */
import type { Standup } from '@/lib/bindings/Standup';
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

/** Apply a patch the way the backend does: absent fields stay unchanged. */
export function applyPatch(standup: Standup, patch: StandupItemPatch): Standup {
  return {
    ...standup,
    plan: {
      items: standup.plan.items.map((item) => (item.id !== patch.id ? item : {
        ...item,
        ...(patch.state !== undefined && { state: patch.state }),
        ...(patch.chosen !== undefined && { chosen: patch.chosen }),
        ...(patch.window !== undefined && { window: patch.window }),
        ...(patch.priority !== undefined && { priority: patch.priority }),
        ...(patch.notBeforeMs !== undefined && { notBeforeMs: patch.notBeforeMs }),
      })),
    },
  };
}
