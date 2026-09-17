/**
 * The Hub desk — the ONE Hub surface, with four lanes over one feed.
 *
 * The Desk won the prototype round and the River, Map and Contacts renderers
 * were deleted with their switcher; what they could reach did not go with them.
 * Everything they showed is a lane here, and every lane derives from the single
 * `HubFeedApi` snapshot the shell already loaded (`desk/laneModel.ts`) — no lane
 * issues a query of its own except Replies, whose rows are not feed entries.
 *
 * The lane control is a real tab strip: `SegmentedTabs` with an `idPrefix`, and
 * the swapped region declares `role="tabpanel"` with the matching id, so the
 * `aria-controls` every tab emits resolves to a node that exists.
 */

import { useState } from 'react';
import { BookHeart, History, Inbox, MessagesSquare, type LucideIcon } from 'lucide-react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { HistoryLane } from './desk/HistoryLane';
import { KnowledgeLane } from './desk/KnowledgeLane';
import { QueueLane } from './desk/QueueLane';
import { RepliesLane } from './desk/RepliesLane';
import { HUB_LANES, laneCount, type HubLaneId } from './desk/laneModel';
import type { HubDeskProps } from './hubContract';

/** Tab and panel ids are both derived from this, so the pair cannot drift. */
const LANE_PREFIX = 'hub-lane';

const LANE_ICON: Record<HubLaneId, LucideIcon> = {
  queue: Inbox,
  history: History,
  knowledge: BookHeart,
  replies: MessagesSquare,
};

export function HubDesk({ feed }: HubDeskProps) {
  const t = useTranslation().t.twin.hub;
  const [lane, setLane] = useState<HubLaneId>('queue');

  const tabs = HUB_LANES.map((id) => {
    const Icon = LANE_ICON[id];
    const count = laneCount(id, feed.counts);
    return {
      id,
      ariaLabel: t.lanes[id],
      label: (
        <span data-testid={`${LANE_PREFIX}-${id}`} className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          <span>{t.lanes[id]}</span>
          {count !== null && <span className="typo-label text-foreground tabular-nums">{count}</span>}
        </span>
      ),
    };
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="hub-desk">
      <div className="flex-shrink-0 px-4 md:px-6 xl:px-8 py-2 border-b border-border bg-card/40">
        <SegmentedTabs
          tabs={tabs}
          activeTab={lane}
          onTabChange={setLane}
          idPrefix={LANE_PREFIX}
          ariaLabel={t.lanes.ariaLabel}
          fullWidth={false}
          size="sm"
          className="w-fit"
        />
      </div>

      <div
        role="tabpanel"
        id={`${LANE_PREFIX}-panel-${lane}`}
        aria-labelledby={`${LANE_PREFIX}-tab-${lane}`}
        className="flex-1 min-h-0 flex flex-col"
      >
        {lane === 'queue' && <QueueLane feed={feed} />}
        {lane === 'history' && <HistoryLane feed={feed} />}
        {lane === 'knowledge' && <KnowledgeLane feed={feed} />}
        {lane === 'replies' && <RepliesLane feed={feed} />}
      </div>
    </div>
  );
}
