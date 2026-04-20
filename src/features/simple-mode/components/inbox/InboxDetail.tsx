/**
 * InboxDetail — routes the right-pane body to the correct kind-specific
 * detail component for the selected `UnifiedInboxItem`.
 *
 * This file is a thin switch; each kind has its own file under `./detail/`.
 * Keeping the dispatch here means the Inbox variant doesn't need to import
 * four detail components directly — just this one.
 *
 * The notes textarea lives HERE (not inside ApprovalDetail) because the
 * variant owns the `notes` state (the action zone reads it to pass to
 * `actions.primary.run(notes)`). Only approval kinds show the notes input.
 */
import type { UnifiedInboxItem } from '../../types';

import { ApprovalDetail } from './detail/ApprovalDetail';
import { HealthDetail } from './detail/HealthDetail';
import { MessageDetail } from './detail/MessageDetail';
import { OutputDetail } from './detail/OutputDetail';

export interface InboxDetailProps {
  item: UnifiedInboxItem;
  notes: string;
  onNotesChange: (next: string) => void;
}

/**
 * Dispatch by `item.kind`. The switch is exhaustive — TypeScript will
 * complain if a new kind is added to the union without being handled here.
 */
export function InboxDetail({ item, notes, onNotesChange }: InboxDetailProps) {
  switch (item.kind) {
    case 'approval':
      return <ApprovalDetail item={item} notes={notes} onNotesChange={onNotesChange} />;
    case 'message':
      return <MessageDetail item={item} />;
    case 'health':
      return <HealthDetail item={item} />;
    case 'output':
      return <OutputDetail item={item} />;
  }
}
