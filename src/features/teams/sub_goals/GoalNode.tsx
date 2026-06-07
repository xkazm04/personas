/**
 * Custom React Flow node for the goal map — three semantic-zoom bands so the
 * map is readable at every distance (v2 had two, and both rendered type too
 * small to read):
 *
 * - **Far** (zoom < 0.45): a status-coloured dot wearing its progress as an
 *   SVG ring sweep — progress reads graphically, no doomed tiny "42%" text.
 *   "Now"/"Next" goals float a counter-scaled title label (constant screen
 *   size) so the map's anchor points stay legible from orbit.
 * - **Mid** (0.45–0.9): a title-only card. The title's font size counter-
 *   scales with zoom (capped), holding ~13px on screen across the whole band
 *   — big type, instant scanning, no metadata noise.
 * - **Near** (≥ 0.9): the full metadata card — description preview, progress
 *   bar + %, status badge, target date (red when overdue), advancing team.
 *
 * "Now" (in-progress) and "Next" (unblocked open) keep a highlighted ring at
 * every band so the user can see where they are and what to start next.
 */
import { memo } from 'react';
import { Clock } from 'lucide-react';
import { Handle, Position, useViewport, type NodeProps } from '@xyflow/react';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { GoalStatusBadge } from './GoalStatusBadge';
import type { GoalNodeData } from './goalGraphLayout';

type Props = NodeProps & { data: GoalNodeData };

/** Below this zoom the node is a progress-ring dot (the 100-node overview). */
const DOT_ZOOM = 0.45;
/** Above this zoom the node expands from title-only to the full metadata card. */
const DETAIL_ZOOM = 0.9;

const clampPct = (p: number) => Math.max(0, Math.min(100, p));

/**
 * Status-tinted card chrome: soft tinted border + a solid status left edge.
 * A real border (not `goalAccentEdgeStyle`'s inset box-shadow) because the
 * here/next ring is a Tailwind ring — also box-shadow — and an inline
 * box-shadow would clobber it.
 */
const cardEdgeStyle = (fill: string) => ({
  borderColor: `${fill}66`,
  borderLeftColor: fill,
  borderLeftWidth: 3,
});

// --- Far band: progress-ring dot ------------------------------------------

const DOT_SIZE = 64;
const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

function DotNode({ data, ring, zoom }: { data: GoalNodeData; ring: string; zoom: number }) {
  const pct = clampPct(data.progress);
  // Counter-scale so the label holds ~11px on screen down to zoom ≈ 0.2.
  const labelScale = Math.min(5, 1 / zoom);
  return (
    <div className={`relative rounded-full ${ring}`} title={`${data.title} — ${pct}%`}>
      <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !border-0 !bg-primary/30" />
      <svg width={DOT_SIZE} height={DOT_SIZE} className="-rotate-90">
        {/* status-tinted body */}
        <circle cx={DOT_SIZE / 2} cy={DOT_SIZE / 2} r={RING_R - 4} fill={`${data.fill}2E`} />
        {/* progress as a ring sweep — graphic, so it reads at any zoom */}
        <circle cx={DOT_SIZE / 2} cy={DOT_SIZE / 2} r={RING_R} fill="none" stroke={`${data.fill}33`} strokeWidth={5} />
        <circle
          cx={DOT_SIZE / 2}
          cy={DOT_SIZE / 2}
          r={RING_R}
          fill="none"
          stroke={data.fill}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${(RING_C * pct) / 100} ${RING_C}`}
        />
      </svg>
      {/* "Now"/"Next" anchors float a constant-screen-size title label */}
      {(data.here || data.next) && (
        <div className="pointer-events-none absolute top-full left-0 mt-1 w-full flex justify-center">
          <span
            className={`text-[11px] font-semibold whitespace-nowrap ${data.here ? 'text-amber-300' : 'text-blue-300'}`}
            style={{ transform: `scale(${labelScale})`, transformOrigin: 'top center' }}
          >
            {data.title.length > 26 ? `${data.title.slice(0, 25)}…` : data.title}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!w-1.5 !h-1.5 !border-0 !bg-primary/30" />
    </div>
  );
}

// --- Mid band: title-only card with counter-scaled large type --------------

function TitleNode({ data, ring, zoom }: { data: GoalNodeData; ring: string; zoom: number }) {
  const pct = clampPct(data.progress);
  // Inverse-scaled, capped, quantized to 2px steps (avoids re-layout thrash
  // while zooming). Holds the title at ~13px on screen across the band.
  const fontSize = Math.min(32, Math.round(13 / zoom / 2) * 2);
  return (
    <div
      className={`rounded-card border bg-secondary/70 backdrop-blur-sm px-4 py-3 w-[240px] shadow-elevation-1 ${ring}`}
      style={cardEdgeStyle(data.fill)}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary/40" />
      <p className="font-semibold text-foreground leading-[1.2] line-clamp-2" style={{ fontSize }}>
        {data.title}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-primary/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: data.fill }} />
        </div>
        <span
          className="text-foreground font-medium tabular-nums"
          style={{ fontSize: Math.min(20, Math.max(11, Math.round(fontSize * 0.6))) }}
        >
          {pct}%
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary/40" />
    </div>
  );
}

// --- Near band: full metadata card -----------------------------------------

function DetailNode({ data, ring }: { data: GoalNodeData; ring: string }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const pct = clampPct(data.progress);
  return (
    <div
      className={`rounded-card border bg-secondary/80 backdrop-blur-sm px-3.5 py-3 w-[260px] shadow-elevation-2 ${ring}`}
      style={cardEdgeStyle(data.fill)}
    >
      <Handle type="target" position={Position.Left} className="!bg-primary/40" />
      {(data.here || data.next) && (
        <div className="flex items-center gap-1 mb-1">
          {data.here && (
            <span className="px-1.5 py-px rounded-[3px] text-[9px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-300">
              {dl.goal_map_here}
            </span>
          )}
          {data.next && (
            <span className="px-1.5 py-px rounded-[3px] text-[9px] font-semibold uppercase tracking-wide bg-blue-500/20 text-blue-300">
              {dl.goal_map_next}
            </span>
          )}
        </div>
      )}
      <p className="typo-card-label text-foreground leading-snug line-clamp-2">{data.title}</p>
      {data.description && (
        <p className="mt-1 text-[11px] text-foreground leading-snug line-clamp-2">{data.description}</p>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-primary/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: data.fill }} />
        </div>
        <span className="text-[10px] text-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <GoalStatusBadge status={data.status} />
        {data.targetDate && (
          <span className={`text-[10px] flex items-center gap-1 ${data.overdue ? 'text-red-400 font-medium' : 'text-foreground'}`}>
            <Clock className="w-3 h-3" />
            <RelativeTime timestamp={data.targetDate} />
          </span>
        )}
      </div>
      {data.advancingTeam && (
        <div
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-emerald-300"
          title={`${data.advancingTeam} is advancing this goal`}
        >
          <span aria-hidden>▶</span>
          <span className="truncate max-w-[210px]">{data.advancingTeam}</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-primary/40" />
    </div>
  );
}

function GoalNodeImpl({ data, selected }: Props) {
  const { zoom } = useViewport();

  const ring = data.here
    ? 'ring-2 ring-amber-400/70 animate-pulse'
    : data.next
      ? 'ring-2 ring-blue-400/60'
      : selected
        ? 'ring-2 ring-primary/60'
        : '';

  if (zoom < DOT_ZOOM) return <DotNode data={data} ring={ring} zoom={zoom} />;
  if (zoom < DETAIL_ZOOM) return <TitleNode data={data} ring={ring} zoom={zoom} />;
  return <DetailNode data={data} ring={ring} />;
}

export const GoalNode = memo(GoalNodeImpl);
