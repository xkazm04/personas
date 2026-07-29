/**
 * CockpitStates — the two moments where there is no case to read.
 *
 * Both keep the three-pane silhouette rather than collapsing to a centred
 * message, because a surface that changes shape while you're waiting on it
 * reads as broken. The loading state is the golden calm placeholder (static,
 * low-contrast, no pulse); the drained state distinguishes "you're done" from
 * "you filtered everything away", which are the same empty list and very
 * different news.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import { RotateCcw } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';

const GHOST = 'bg-primary/[0.06]';

export function CockpitLoading() {
  return (
    <div className="flex-1 min-h-0 flex">
      <div className="w-[286px] shrink-0 border-r border-primary/12 bg-secondary/10 pt-3">
        <ListSkeleton rows={7} rowHeight={56} calm />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden px-10 py-9">
        <div className="mx-auto w-full max-w-[736px] flex flex-col gap-5" aria-hidden="true">
          <span className={`block h-4 w-40 rounded-pill ${GHOST}`} />
          <span className={`block h-10 w-4/5 rounded-card ${GHOST}`} />
          <span className={`block h-3 w-1/3 rounded-pill ${GHOST}`} />
          <span className="block h-px w-full bg-primary/10" />
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`block h-3.5 rounded-pill ${GHOST}`}
              style={{ width: `${100 - i * 7}%` }}
            />
          ))}
        </div>
      </div>
      <div className="w-[300px] shrink-0 border-l border-primary/12 bg-secondary/10" />
      <span role="status" className="sr-only">
        Loading the triage queue…
      </span>
    </div>
  );
}

export function CockpitEmpty({
  filteredOut,
  onReload,
}: {
  /** True when items exist but every one of them is behind a switched-off kind
   *  filter — "you're done" would be a lie. */
  filteredOut: boolean;
  onReload: () => void;
}) {
  return (
    <div className="flex-1 min-w-0 flex items-center justify-center px-10 py-12">
      <div className="w-full max-w-[440px] flex flex-col items-center gap-5">
        <IllustratedEmptyState
          variant="todos"
          heading={filteredOut ? 'Nothing matches these filters' : 'The queue is clear'}
          description={
            filteredOut
              ? 'Every waiting item is behind a switched-off kind. Turn one back on in the rail to see it.'
              : 'Nothing is waiting on a human right now. New reviews, ideas, practices and build questions land here as they are raised.'
          }
        />
        {!filteredOut && (
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={onReload}
            title="Re-fetch every source and restore anything you deferred"
          >
            Reload the queue
          </Button>
        )}
      </div>
    </div>
  );
}
