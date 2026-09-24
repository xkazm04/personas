import { Suspense } from 'react';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { lazyRetry } from '@/lib/lazyRetry';
import type { ReleaseItemPriority } from '@/data/releases';
import type { ReleasesTranslation } from './i18n/useReleasesTranslation';
import type { DisplayItem } from './roadmapItems';
import { ITEM_STATUS_TONE, PRIORITY_TONE, TONE_CHIP, TONE_FILL, TONE_TEXT, type RevealTracker } from './releaseTones';

// The module's own art (a traced waypoint on the roadmap trail), not a generic
// empty state: a lane with nothing in it sits beside two full ones, so it stays
// a small inline mark rather than a ScenarioEmptyState block. Lazy because the
// traced path data is ~10KB gzipped; it animates itself in, so the one-frame
// Suspense gap is invisible.
const RoadmapLaneEmptyGlyph = lazyRetry(() => import('./RoadmapLaneEmptyGlyph'));

/** How far a lane is from now, drawn rather than coloured: a filled mark for the
 * current horizon, an open ring for the next one, a dashed ring for later. */
const HORIZON_MARK: Record<ReleaseItemPriority, string> = {
  now: 'bg-role-highlight',
  next: 'border-2 border-role-highlight',
  later: 'border-2 border-dashed border-foreground/40',
};

export function RoadmapLane({ priority, items, enter, t }: { priority: ReleaseItemPriority; items: DisplayItem[]; enter: RevealTracker; t: ReleasesTranslation }) {
  const tone = PRIORITY_TONE[priority];
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between border-b border-primary/10 pb-2">
        <span className="flex items-center gap-2.5">
          <span aria-hidden className={`h-3 w-3 rounded-full ${HORIZON_MARK[priority]}`} />
          <h2 className={`typo-heading ${TONE_TEXT[tone]}`}>{t.priority[priority]}</h2>
        </span>
        <span className={`rounded-full border px-2.5 typo-data ${TONE_CHIP[tone]}`}>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-primary/10 p-3">
          <Suspense fallback={<div className="h-12 w-12" />}>
            <RoadmapLaneEmptyGlyph />
          </Suspense>
          <span className="typo-caption">{t.laneEmpty}</span>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const status = ITEM_STATUS_TONE[item.status];
            return (
              <RevealItem key={item.id} revealId={item.id} order={index} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
                <div className="relative overflow-hidden rounded-card border border-card-border bg-card-bg p-4 pl-6">
                  <div aria-hidden className={`absolute inset-y-3 left-2 w-1 rounded-full ${TONE_FILL[status]}`} />
                  <h3 className="typo-title">{item.title}</h3>
                  <div className={`typo-label mt-1 ${TONE_TEXT[status]}`}>{t.itemStatus[item.status]}</div>
                  {item.description && <p className="typo-body mt-2 text-foreground">{item.description}</p>}
                </div>
              </RevealItem>
            );
          })}
        </div>
      )}
    </div>
  );
}
