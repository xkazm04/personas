/**
 * Region label for a status cluster on the goal map — the far-zoom answer to
 * "what's in there?". The force layout pulls same-status goals into shared
 * regions (forceLayout group gravity); this node floats one counter-scaled
 * label (status + count) above each region. It renders ONLY in the dot band
 * (zoom < DOT_ZOOM): past that, titles are readable and the label would be
 * clutter. Four labels max — orientation without the per-node label soup.
 */
import { memo } from 'react';
import { useViewport, type NodeProps } from '@xyflow/react';
import { useTranslation } from '@/i18n/useTranslation';
import { goalStatusLabel } from './goalStatus';
import type { GoalClusterData } from './goalGraphLayout';
import { DOT_ZOOM } from './GoalNode';

type Props = NodeProps & { data: GoalClusterData };

function GoalClusterNodeImpl({ data }: Props) {
  const { t } = useTranslation();
  const { zoom } = useViewport();
  if (zoom >= DOT_ZOOM) return null;

  // Counter-scale so the label holds ~11px on screen across the dot band
  // (minZoom 0.25 → scale 3.6 → ~10.8px; band ceiling 0.45 → scale 2 → ~10.8px).
  const scale = Math.min(4, 0.9 / zoom);

  return (
    <div
      className="pointer-events-none flex items-center gap-2"
      style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: data.fill }} aria-hidden />
      <span className="typo-caption font-semibold uppercase tracking-[0.14em] text-foreground whitespace-nowrap">
        {goalStatusLabel(t.plugins.dev_lifecycle, data.status)}
      </span>
      <span className="typo-caption text-foreground tabular-nums">{data.count}</span>
    </div>
  );
}

export const GoalClusterNode = memo(GoalClusterNodeImpl);
