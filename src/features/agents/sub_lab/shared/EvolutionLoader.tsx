import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

export interface EvolutionLoaderProps {
  /** 1-based current generation. Omit for an indeterminate climbing animation. */
  generation?: number;
  /** Total generations (number of rungs). Omit to use the default of 5. */
  total?: number;
  /** Visual size preset. */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label for screen readers (status region). */
  label?: string;
  /** Additional className applied to the wrapper. */
  className?: string;
}

const SIZE = {
  sm: { width: 28, height: 64,  stroke: 1.4, node: 2.4 },
  md: { width: 44, height: 104, stroke: 1.6, node: 3.0 },
  lg: { width: 60, height: 152, stroke: 2.0, node: 3.8 },
} as const;

const TURNS = 1.5;
const SAMPLES = 36;

function buildHelixPath(width: number, height: number, phase: number): string {
  const cx = width / 2;
  const amp = width * 0.32;
  const yPad = height * 0.06;
  const yRange = height - yPad * 2;
  let d = '';
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const y = yPad + t * yRange;
    const x = cx + Math.sin(t * TURNS * Math.PI * 2 + phase) * amp;
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' ';
  }
  return d.trim();
}

interface NodePos {
  y: number;
  xLeft: number;
  xRight: number;
}

function buildNodes(width: number, height: number, count: number): NodePos[] {
  const cx = width / 2;
  const amp = width * 0.32;
  const yPad = height * 0.06;
  const yRange = height - yPad * 2;
  const nodes: NodePos[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const y = yPad + t * yRange;
    const xLeft  = cx + Math.sin(t * TURNS * Math.PI * 2)              * amp;
    const xRight = cx + Math.sin(t * TURNS * Math.PI * 2 + Math.PI)    * amp;
    nodes.push({ y, xLeft, xRight });
  }
  return nodes;
}

/**
 * Branded DNA-helix loader for evolution / breeding runs.
 *
 * Two interlocking helix strands climb vertically with rung nodes that fill
 * sequentially as generations progress. Falls back to a static helix plus a
 * linear progress bar when the user prefers reduced motion.
 *
 * Inverted top-to-bottom: in indeterminate mode the wave travels upward, so
 * the bottom node is the "next" generation about to land.
 */
export function EvolutionLoader({
  generation,
  total,
  size = 'md',
  label,
  className = '',
}: EvolutionLoaderProps) {
  const { shouldAnimate } = useMotion();
  const dims = SIZE[size];
  const id = useId();

  const indeterminate = generation == null;
  const nodeCount = Math.max(2, Math.min(8, total ?? 5));
  const ratio = indeterminate || total == null
    ? 0
    : Math.max(0, Math.min(1, (generation ?? 0) / total));

  const helixA = useMemo(() => buildHelixPath(dims.width, dims.height, 0),       [dims.width, dims.height]);
  const helixB = useMemo(() => buildHelixPath(dims.width, dims.height, Math.PI), [dims.width, dims.height]);
  const nodes  = useMemo(() => buildNodes(dims.width, dims.height, nodeCount),   [dims.width, dims.height, nodeCount]);

  const gradId = `evo-grad-${id}`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`inline-flex flex-col items-center text-primary ${className}`}
    >
      <svg
        width={dims.width}
        height={dims.height}
        viewBox={`0 0 ${dims.width} ${dims.height}`}
        className="overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity={0.95} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0.25} />
          </linearGradient>
        </defs>

        {/* Helix strands */}
        <motion.path
          d={helixA}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={dims.stroke}
          strokeLinecap="round"
          initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : false}
          animate={shouldAnimate ? { pathLength: 1, opacity: 1 } : false}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <motion.path
          d={helixB}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={dims.stroke}
          strokeLinecap="round"
          initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : false}
          animate={shouldAnimate ? { pathLength: 1, opacity: 1 } : false}
          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.12 }}
        />

        {/* Rungs (subtle base layer) */}
        {nodes.map((n, i) => (
          <line
            key={`rung-${i}`}
            x1={n.xLeft}
            y1={n.y}
            x2={n.xRight}
            y2={n.y}
            stroke="currentColor"
            strokeOpacity={0.18}
            strokeWidth={dims.stroke * 0.55}
          />
        ))}

        {/* Nodes — light up sequentially from bottom (latest generation) up */}
        {nodes.map((n, i) => {
          // Reverse index so the bottom node is "first" (latest generation
          // sits at the top once the wave has climbed all the way).
          const reverseIdx = nodeCount - 1 - i;
          const nodeRatio = reverseIdx / Math.max(1, nodeCount - 1);
          const isLit = !indeterminate && nodeRatio < ratio + 1e-6;
          const restingOpacity = isLit ? 0.9 : 0.22;
          const animateOpacity = shouldAnimate
            ? indeterminate
              ? [0.18, 0.95, 0.18]
              : isLit
                ? [0.55, 1, 0.55]
                : restingOpacity
            : restingOpacity;
          const animateScale = shouldAnimate
            ? indeterminate
              ? [0.85, 1.1, 0.85]
              : isLit
                ? [1, 1.12, 1]
                : 1
            : 1;
          const dur = indeterminate ? 1.6 : isLit ? 2.4 : 0;
          const stagger = indeterminate ? 0.18 : 0.1;

          return (
            <g key={`node-${i}`}>
              <motion.circle
                cx={n.xLeft}
                cy={n.y}
                r={dims.node}
                fill="currentColor"
                style={{ opacity: restingOpacity }}
                animate={shouldAnimate ? { opacity: animateOpacity, scale: animateScale } : false}
                transition={shouldAnimate && dur > 0
                  ? { duration: dur, repeat: Infinity, delay: reverseIdx * stagger,        ease: 'easeInOut' }
                  : undefined}
              />
              <motion.circle
                cx={n.xRight}
                cy={n.y}
                r={dims.node}
                fill="currentColor"
                style={{ opacity: restingOpacity }}
                animate={shouldAnimate ? { opacity: animateOpacity, scale: animateScale } : false}
                transition={shouldAnimate && dur > 0
                  ? { duration: dur, repeat: Infinity, delay: reverseIdx * stagger + 0.35, ease: 'easeInOut' }
                  : undefined}
              />
            </g>
          );
        })}
      </svg>

      {/* Reduced-motion linear progress fallback (only when we have a known ratio) */}
      {!shouldAnimate && !indeterminate && total != null && total > 0 && (
        <div
          className="mt-1.5 h-1 w-full max-w-[5rem] rounded-full bg-primary/10 overflow-hidden"
          aria-hidden="true"
        >
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
