/**
 * Custom React Flow node for the goal map. Level-of-detail: zoomed out (the
 * 100-node overview) each goal collapses to a colour-coded progress dot; zoomed
 * in it expands to a titled card with a progress bar. "Now" (in-progress) and
 * "Next" (unblocked open) goals get a highlighted ring + badge so the user can
 * see where they are and what to start next at any zoom.
 */
import { memo } from 'react';
import { Handle, Position, useViewport, type NodeProps } from '@xyflow/react';
import { useTranslation } from '@/i18n/useTranslation';
import type { GoalNodeData } from './goalGraphLayout';

type Props = NodeProps & { data: GoalNodeData };

/** Below this zoom the node renders as a compact dot (overview); above it, full card. */
const DETAIL_ZOOM = 0.55;

function GoalNodeImpl({ data, selected }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { zoom } = useViewport();
  const compact = zoom < DETAIL_ZOOM;

  const ring = data.here
    ? 'ring-2 ring-amber-400/70 animate-pulse'
    : data.next
      ? 'ring-2 ring-blue-400/60'
      : selected
        ? 'ring-2 ring-primary/60'
        : '';

  if (compact) {
    return (
      <div className={`rounded-full ${ring}`}>
        <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !border-0 !bg-primary/30" />
        <div
          className="w-11 h-11 rounded-full border flex items-center justify-center"
          style={{ backgroundColor: `${data.fill}33`, borderColor: data.fill }}
        >
          <span className="text-[9px] font-semibold tabular-nums" style={{ color: data.stroke }}>
            {data.progress}%
          </span>
        </div>
        <Handle type="source" position={Position.Right} className="!w-1.5 !h-1.5 !border-0 !bg-primary/30" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-card border bg-secondary/70 backdrop-blur-sm px-3 py-2 min-w-[170px] max-w-[210px] shadow-elevation-1 transition-shadow ${ring}`}
      style={{ borderColor: `${data.fill}66` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary/40" />
      <div className="flex items-start gap-2">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: data.fill }} aria-hidden />
        <div className="min-w-0 flex-1">
          {(data.here || data.next) && (
            <div className="flex items-center gap-1 mb-0.5">
              {data.here && (
                <span className="px-1 py-px rounded-[3px] text-[8px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-300">
                  {dl.goal_map_here}
                </span>
              )}
              {data.next && (
                <span className="px-1 py-px rounded-[3px] text-[8px] font-semibold uppercase tracking-wide bg-blue-500/20 text-blue-300">
                  {dl.goal_map_next}
                </span>
              )}
            </div>
          )}
          <p className="typo-caption text-foreground font-medium leading-snug line-clamp-2">{data.title}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${data.progress}%`, backgroundColor: data.fill }} />
            </div>
            <span className="text-[8px] text-foreground/60 tabular-nums">{data.progress}%</span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary/40" />
    </div>
  );
}

export const GoalNode = memo(GoalNodeImpl);
