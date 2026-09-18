// QueueBoard — the board body's variant switch.
//
// `classic` is the existing team-column `GridBoard`: the queue boards are
// ANOTHER READ of the same fleet, not a replacement, and the operator who
// never touches the layout control sees the team columns. The two queue
// variants share one model (`useQueueModel`), one optimistic order
// (`useLocalOrder`), one verb set (`useQueueActions`) and one node; they
// differ only in what they put where.
//
// Loading and empty are decided HERE, once, for both: a ghost under the
// chrome while the first read has not landed and there is nothing to show
// (law 1 / law 3 — never a settled empty state before the first read), and
// the shared `ScenarioEmptyState` when the fleet holds nothing running or
// queued. A variant only ever paints rows.

import { ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { GridBoard, type GridBoardProps } from '../GridBoard';
import { QUEUE_TILE_H, QUEUE_TILE_W } from '../../gridGeometry';
import type { BoardVariant } from './boardVariant';
import type { QueueBoardProps } from './queueBoardTypes';
import { RunwayBoard } from './RunwayBoard';
import { LanesBoard } from './LanesBoard';

/** Geometry-matched ghost bars under the chrome — static, delayed, calm. */
export function QueueGhost({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className="flex min-h-0 flex-1 flex-wrap content-start gap-3 overflow-hidden p-3 animate-fade-in"
      style={{ animationDelay: '150ms' }}
      data-testid="fleet-queue-ghost"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex flex-col justify-center gap-1.5 rounded-input border border-dashed border-border bg-foreground/[0.02] px-2"
          style={{ width: QUEUE_TILE_W, height: QUEUE_TILE_H }}
        >
          <span className="h-[0.6em] w-28 rounded bg-primary/[0.06] typo-body" />
          <span className="h-[0.5em] w-16 rounded bg-primary/[0.05] typo-caption" />
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
    case 'runway': return <RunwayBoard {...queue} />;
    case 'lanes': return <LanesBoard {...queue} />;
  }
}

export default QueueBoard;
