/**
 * MessageDetail — detail pane for `kind: 'message'` items.
 *
 * Simple body render: just the full message text inside a soft card, with
 * the shared DetailHeader on top. The variant's ActionZone provides the
 * "Mark as read" primary action; nothing kind-specific happens here.
 *
 * `typo-body-lg` is used for the body so long-form messages are more
 * readable than the default `typo-body`. Whitespace is preserved with
 * `whitespace-pre-wrap` so multi-paragraph messages keep their shape.
 */
import { MessageSquare } from 'lucide-react';

import type { UnifiedInboxItem } from '../../../types';
import { DetailHeader } from './DetailHeader';

export interface MessageDetailProps {
  item: Extract<UnifiedInboxItem, { kind: 'message' }>;
}

export function MessageDetail({ item }: MessageDetailProps) {
  return (
    <div className="flex flex-col min-h-0 overflow-auto">
      <DetailHeader
        item={item}
        kindIcon={<MessageSquare className="w-3.5 h-3.5" />}
        kindTone="violet"
      />

      <div className="px-6 pb-6">
        <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] px-5 py-4">
          <p className="typo-body-lg text-foreground whitespace-pre-wrap">{item.body}</p>
        </div>
      </div>
    </div>
  );
}
