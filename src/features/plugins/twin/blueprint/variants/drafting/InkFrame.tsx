import { motion } from 'framer-motion';
import type { Ink } from './draftingTwinModel';

/**
 * A region's outline, drawn the way the section stands: a dashed pencil line
 * all round, inked over in solid ink clockwise from the top-left corner as far
 * as the section is drawn (its `sectionCoverage`), so a half-drawn section
 * carries half an inked frame and a finished one a solid frame with a tick.
 * `drawn` false keeps the ink at zero, so a sheet building up traces each
 * frame as its region arrives (a CSS transition, stopped under reduced motion).
 */
export default function InkFrame({
  coverage,
  ink,
  drawn,
  reduced,
}: {
  coverage: number | null;
  ink: Ink;
  drawn: boolean;
  reduced: boolean;
}) {
  const pct = drawn && coverage !== null ? Math.round(Math.min(1, Math.max(0, coverage)) * 100) : 0;
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="var(--ink-dim)" strokeWidth={1} strokeDasharray="5 4" />
        <rect
          className="twd-ink-trace"
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.5}
          pathLength={100}
          style={{ strokeDasharray: `${pct} 100` }}
        />
      </svg>
      {drawn && ink === 'done' && (
        <svg aria-hidden width={14} height={11} className="pointer-events-none absolute bottom-2.5 right-3 overflow-visible">
          <motion.path
            d="M1 6 L5 10 L13 1"
            fill="none"
            stroke="var(--ink-strong)"
            strokeWidth={1.75}
            initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.45, delay: reduced ? 0 : 0.8, ease: 'easeOut' }}
          />
        </svg>
      )}
    </>
  );
}
