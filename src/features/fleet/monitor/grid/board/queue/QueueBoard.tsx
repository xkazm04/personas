// QueueBoard — the board body's variant switch.
//
// `classic` is the existing team-column `GridBoard`, byte-for-byte: the queue
// boards are ANOTHER READ of the same fleet, not a replacement, and the
// operator who never touches the layout control sees exactly what shipped
// before the queue existed. The four queue variants share one model
// (`useQueueModel`), one optimistic order (`useLocalOrder`), one verb set
// (`useQueueActions`) and one tile; they differ only in what they put where.
//
// Loading and empty are decided HERE, once, for all four: a ghost under the
// chrome while the first read has not landed and there is nothing to show
// (law 1 / law 3 — never a settled empty state before the first read), and
// the shared `ScenarioEmptyState` when the fleet holds nothing running or
// queued. A variant only ever paints rows.

import { ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { GridBoard, type GridBoardProps } from '../GridBoard';
import type { BoardVariant } from './boardVariant';
import type { QueueBoardProps } from './queueBoardTypes';
import { QUEUE_TILE_H, QUEUE_TILE_W } from './QueueTile';
import { RankedGridBoard } from './RankedGridBoard';
import { RunwayBoard } from './RunwayBoard';
import { LanesBoard } from './LanesBoard';
import { HorizonBoard } from './HorizonBoard';

/** Geometry-matched ghost bars under the chrome — static, delayed, calm. */
export function QueueGhost({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-hidden p-3 animate-fade-in"
      style={{ animationDelay: '150ms' }}
      data-testid="fleet-queue-ghost"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-input border border-dashed border-border bg-foreground/[0.02] px-2"
          style={{ width: QUEUE_TILE_W, height: QUEUE_TILE_H }}
        >
          <span className="h-3.5 w-5 rounded-full bg-primary/[0.06]" />
          <span className="h-[0.6em] w-24 rounded bg-primary/[0.06] typo-caption" />
        </div>
      ))}
    </div>
  );
}

export function QueueBoard({
  variant, isLoading, classic, queue,
}: {
  variant: BoardVariant;
  /** The first-ever read has not landed and there is nothing warm to show. */
  isLoading: boolean;
  /** The classic board's own props — rendered untouched for `classic`. */
  classic: GridBoardProps;
  queue: QueueBoardProps;
}) {
  const { t } = useTranslation();
  if (variant === 'classic') return <GridBoard {...classic} />;

  // The queue read may lag the roster read by one IPC: a board with rows
  // already in the registry but no snapshot yet still paints its rows (law 1
  // — a fetch never hides rendered rows); only a board with NOTHING ghosts.
  if (isLoading && queue.model.empty) return <QueueGhost />;

  if (queue.model.empty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" data-testid="fleet-queue-empty">
        <ScenarioEmptyState icon={ListOrdered} title={t.monitor.queue_empty_title} description={t.monitor.queue_empty_hint} />
      </div>
    );
  }

  switch (variant) {
    case 'ranked': return <RankedGridBoard {...queue} />;
    case 'runway': return <RunwayBoard {...queue} />;
    case 'lanes': return <LanesBoard {...queue} />;
    case 'horizon': return <HorizonBoard {...queue} />;
  }
}

export default QueueBoard;
