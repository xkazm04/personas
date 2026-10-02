import type { Ink } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';

/**
 * A region's outline in pencil: dashed all round, traced with the first wave
 * of frames (depth 0). The region is the box this frame makes.
 */
export function RegionOutline() {
  return <DrawFrame stroke="var(--ink-dim)" dash="5 4" edge={0} />;
}

/**
 * The same outline inked over in solid ink, clockwise from the top-left
 * corner, as far as the section is drawn (its `sectionCoverage`), so a
 * half-drawn section carries half an inked frame and a finished one a solid
 * frame and a tick. It is the region's CONTENT, drawn right after its share is
 * written: the share first, then the ink runs out to it. A later change in the
 * share (the stage's delta) runs along the frame (`.twd-ink-trace`).
 */
export function RegionInk({ coverage, ink }: { coverage: number | null; ink: Ink }) {
  const pct = coverage !== null ? Math.round(Math.min(1, Math.max(0, coverage)) * 100) : 0;
  return (
    <>
      {pct > 0 && (
        <svg
          aria-hidden
          className="pointer-events-none absolute overflow-visible"
          style={{ left: 0.75, top: 0.75, width: 'calc(100% - 1.5px)', height: 'calc(100% - 1.5px)' }}
        >
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
            data-draw="ink"
          />
        </svg>
      )}
      {ink === 'done' && (
        <svg aria-hidden width={14} height={11} className="twd-done-tick pointer-events-none absolute bottom-2.5 right-3 overflow-visible">
          <path d="M1 6 L5 10 L13 1" fill="none" stroke="var(--ink-strong)" strokeWidth={1.75} pathLength={100} data-draw="stroke" />
        </svg>
      )}
    </>
  );
}
