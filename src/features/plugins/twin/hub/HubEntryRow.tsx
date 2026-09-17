/**
 * One entry as a compact, actionable row — the shape History and Knowledge
 * both render.
 *
 * It exists because two surfaces revealed the SAME row and the alternative was
 * two drifting copies of the kind glyph, the status pip, the channel mark and
 * the inline affordances. The Queue lane keeps its own frame: it shows ONE
 * entry at full length with keyboard verdicts, which is a different reading.
 */

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { RevealItem, type RevealItemProps } from '@/features/shared/components/display/RevealItem';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { HUB_KIND_META, HUB_STATUS_META, HubEntryActions } from './HubEntryActions';
import type { HubEntry, HubFeedApi } from './hubContract';

/** The per-id entrance guard from `useRevealTracker`, passed through verbatim. */
export type HubRevealTracker = Pick<RevealItemProps, 'hasEntered' | 'markEntered'>;

export function HubEntryRow({ entry, feed, order, enter }: {
  entry: HubEntry;
  feed: HubFeedApi;
  order: number;
  enter: HubRevealTracker;
}) {
  const { t: tRoot, tx } = useTranslation();
  const t = tRoot.twin.hub;
  const meta = HUB_KIND_META[entry.kind];
  const status = entry.status ? HUB_STATUS_META[entry.status] : null;

  return (
    <RevealItem
      as="li"
      revealId={entry.id}
      order={order}
      {...enter}
      className="group flex items-start gap-2 rounded-card border border-border bg-card/40 px-3 py-2 transition-colors hover:border-primary/30"
    >
      <Tooltip content={t.kinds[entry.kind]}>
        <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center ${meta.bg} ${meta.border}`}>
          <meta.Icon className={`w-3 h-3 ${meta.text}`} />
        </span>
      </Tooltip>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          {status && entry.status && (
            <Tooltip content={t.status[entry.status]}>
              <span className={`w-4 h-4 rounded-full flex items-center justify-center ${status.bg} ${status.text}`}>
                <status.Icon className="w-2.5 h-2.5" />
              </span>
            </Tooltip>
          )}
          {entry.channel && (
            <span className="px-1.5 rounded-full border border-border bg-secondary/40 typo-label text-foreground">
              {entry.channel}
            </span>
          )}
          <RelativeTime timestamp={entry.at} className="typo-caption text-foreground tabular-nums" />
          <span className="ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <HubEntryActions entry={entry} feed={feed} />
          </span>
        </span>
        {entry.title && <span className="block typo-card-label text-foreground mt-0.5">{entry.title}</span>}
        <span className="block typo-body text-foreground leading-relaxed line-clamp-2">{entry.body}</span>
        {entry.reviewerNotes && (
          <span className="block typo-caption text-status-error mt-0.5">
            {tx(t.entry.reasonLabel, { reason: entry.reviewerNotes })}
          </span>
        )}
      </span>
    </RevealItem>
  );
}
