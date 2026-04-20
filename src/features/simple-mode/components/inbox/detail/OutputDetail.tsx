/**
 * OutputDetail — detail pane for `kind: 'output'` items.
 *
 * Output items are RESERVED in the UnifiedInboxItem union (see
 * `src/features/simple-mode/types.ts`) — they are declared so renderers can
 * pattern-match exhaustively, but `useUnifiedInbox()` does not emit them in
 * v1. This component must therefore compile cleanly and render something
 * sensible in case a future hook change flips the switch.
 *
 * Renders the shared DetailHeader + the raw body wrapped in a soft card.
 * Action zone provides a harmless no-op "Mark as read" primary button.
 */
import { FileOutput } from 'lucide-react';

import type { UnifiedInboxItem } from '../../../types';
import { DetailHeader } from './DetailHeader';

export interface OutputDetailProps {
  item: Extract<UnifiedInboxItem, { kind: 'output' }>;
}

export function OutputDetail({ item }: OutputDetailProps) {
  return (
    <div className="flex flex-col min-h-0 overflow-auto">
      <DetailHeader
        item={item}
        kindIcon={<FileOutput className="w-3.5 h-3.5" />}
        kindTone="emerald"
      />

      <div className="px-6 pb-6">
        <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] px-5 py-4">
          <p className="typo-body text-foreground whitespace-pre-wrap">{item.body}</p>
        </div>
      </div>
    </div>
  );
}
