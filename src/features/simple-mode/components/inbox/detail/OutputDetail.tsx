/**
 * OutputDetail — detail pane for `kind: 'output'` items.
 *
 * Phase 16 Topic B: output items are now emitted by `useUnifiedInbox` via
 * the message-classification heuristic (see `outputAdapter.ts`). This
 * component renders the produced artifact as read-only prose.
 *
 * Layout mirrors ApprovalDetail / MessageDetail / HealthDetail:
 *   - Shared DetailHeader (emerald kind badge + persona illustration wash)
 *   - A single soft card containing the "Output" label + the body
 *
 * Body rendering: a `<pre>` with `whitespace-pre-wrap break-words` and a
 * serif display face preserves markdown newlines and long tokens without
 * pulling in a markdown renderer. Full markdown rendering (react-markdown /
 * remark) is a deferred v1.3 concern — the pre-wrapped text is legible for
 * the typical short-to-medium artifact the heuristic catches.
 */
import { FileOutput } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { UnifiedInboxItem } from '../../../types';
import { DetailHeader } from './DetailHeader';

export interface OutputDetailProps {
  item: Extract<UnifiedInboxItem, { kind: 'output' }>;
}

export function OutputDetail({ item }: OutputDetailProps) {
  const { t } = useTranslation();
  const inb = t.simple_mode.inbox;

  return (
    <div className="flex flex-col min-h-0">
      <DetailHeader
        item={item}
        kindIcon={<FileOutput className="w-3.5 h-3.5" />}
        kindTone="emerald"
      />
      <div className="flex-1 overflow-auto px-6 py-5">
        <section className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-5">
          <div className="typo-label text-foreground/55 mb-2">{inb.the_output_label}</div>
          <pre className="typo-body-lg simple-display text-foreground whitespace-pre-wrap break-words font-serif">
            {item.body}
          </pre>
        </section>
      </div>
    </div>
  );
}
