// Circuit leaf — the SVG wire layer. Fixed geometry: every project node row
// is PITCH px tall, so wire endpoints are computed, not measured. Wires run
// from the source node's mid-height to each node row's center as gentle
// beziers. Entrance is a ONE-SHOT pathLength draw keyed by the selected
// skill; adopting wires play a one-shot dash slide on state change. Neutral
// `currentColor` picks up the status tone from each path's text-status-*.
import { motion } from 'framer-motion';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import type { ProjectLaunchCell } from './launchTypes';

/** Fixed row geometry shared with CircuitVariant's node column. */
export const NODE_H = 72;
export const ROW_GAP = 16;
export const PITCH = NODE_H + ROW_GAP;
export const WIRE_W = 120;

const TONE: Record<ProjectLaunchCell['status'], string> = {
  ready: 'text-status-success',
  running: 'text-status-info',
  adopting: 'text-status-warning',
  needs_adopt: 'text-foreground/25',
};

export default function CircuitWires({ cells, selectedSkill }: {
  cells: ProjectLaunchCell[];
  selectedSkill: string;
}) {
  const reduced = useReducedMotion();
  const height = Math.max(NODE_H, cells.length * PITCH - ROW_GAP);
  const midY = height / 2;
  const midX = WIRE_W / 2;

  return (
    <svg
      width={WIRE_W}
      height={height}
      viewBox={`0 0 ${WIRE_W} ${height}`}
      className="flex-shrink-0"
      aria-hidden
    >
      {cells.map((cell, i) => {
        const y = i * PITCH + NODE_H / 2;
        const { status } = cell;

        if (status === 'needs_adopt') {
          // No live wire — a faint dashed stub leaves the source and stops.
          const stubY = midY + (y - midY) * 0.18;
          return (
            <path
              key={cell.project.id}
              d={`M 4 ${midY} C 18 ${midY}, 24 ${stubY}, 32 ${stubY}`}
              className={TONE[status]}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="3 5"
              strokeLinecap="round"
              fill="none"
            />
          );
        }

        const d = `M 4 ${midY} C ${midX} ${midY}, ${midX} ${y}, ${WIRE_W - 4} ${y}`;
        const dashed = status === 'adopting';
        return (
          <motion.path
            // Keyed by skill + status: entrance redraws when the skill
            // changes; the dash slide replays once when adopting starts.
            key={`${selectedSkill}:${cell.project.id}:${status}`}
            d={d}
            className={TONE[status]}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={dashed ? '6 6' : undefined}
            initial={reduced ? false : dashed ? { strokeDashoffset: 48, opacity: 0.4 } : { pathLength: 0 }}
            animate={dashed ? { strokeDashoffset: 0, opacity: 1 } : { pathLength: 1 }}
            transition={{ duration: 0.55, delay: i * 0.06, ease: 'easeOut' }}
          />
        );
      })}
    </svg>
  );
}
