/**
 * One quadrant of the anatomy ring: the coverage arc (track + fill to the
 * section's `sectionCoverage`, a pen line at the fill's end; hatched and
 * dashed when nothing is measured yet) and, outside it, the section's glyph
 * band. On L1 the whole quadrant is the section's control (Tab, Enter/Space,
 * click), named from `t.twin.blueprint.sections`; in stage it is inert.
 */
import type { KeyboardEvent, ReactNode } from 'react';

import type { SectionId } from '../../blueprintContract';
import type { RadialIds } from './glyphs/primitives';
import { RING, arcPath, sectorPath, segmentAngles, spokePath } from './radialGeometry';

interface RingSegmentProps {
  section: SectionId;
  cx: number;
  cy: number;
  R: number;
  coverage: number | null;
  ids: RadialIds;
  /** The control's name; `null` = inert (stage). */
  label: string | null;
  describedBy?: string;
  hot: boolean;
  dim?: boolean;
  onActivate?: (section: SectionId) => void;
  onHot?: (section: SectionId | null) => void;
  children?: ReactNode;
}

export function RingSegment(props: RingSegmentProps) {
  const { section, cx, cy, R, coverage, ids, label, describedBy, hot, dim, onActivate, onHot, children } = props;
  const { a0, a1 } = segmentAngles(section);
  const r0 = RING.main0 * R;
  const r1 = RING.main1 * R;
  const measured = coverage !== null;
  const end = a0 + (coverage ?? 0) * (a1 - a0);
  const track = sectorPath(cx, cy, r0, r1, a0, a1);
  const whole = sectorPath(cx, cy, r0 - 4, R + 4, a0 - 1.5, a1 + 1.5);
  const interactive = label !== null;

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate?.(section);
    }
  };

  return (
    <g
      className="rd-seg"
      data-testid={`radial-seg-${section}`}
      data-section={section}
      data-measured={measured ? 'true' : 'false'}
      data-coverage={measured ? String(Math.round(coverage * 1000) / 1000) : 'none'}
      data-hot={hot ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label ?? undefined}
      aria-describedby={interactive ? describedBy : undefined}
      onClick={interactive ? () => onActivate?.(section) : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      onPointerEnter={interactive ? () => onHot?.(section) : undefined}
      onPointerLeave={interactive ? () => onHot?.(null) : undefined}
      onFocus={interactive ? () => onHot?.(section) : undefined}
      onBlur={interactive ? () => onHot?.(null) : undefined}
    >
      {interactive && <path className="rd-hit" d={whole} />}
      {measured ? (
        <path className="rd-seg-track" d={track} />
      ) : (
        <g data-measured="false" data-testid={`radial-unmeasured-${section}`}>
          <path d={track} fill={`url(#${ids.hatch})`} />
          <path className="rd-dash" d={track} />
        </g>
      )}
      {measured && end > a0 && (
        <>
          <path className="rd-seg-fill" d={sectorPath(cx, cy, r0, r1, a0, end)} />
          <path className="rd-seg-edge" d={arcPath(cx, cy, r1, a0, end)} />
        </>
      )}
      {measured && <path className="rd-seg-pen" d={spokePath(cx, cy, r0 - 4, r1 + 4, end)} />}
      <g className="rd-seg-band">{children}</g>
      {interactive && <path className="rd-seg-outline" d={whole} />}
    </g>
  );
}
