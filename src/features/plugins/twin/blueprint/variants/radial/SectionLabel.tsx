/**
 * A segment's name outside the ring, at full type size, hung from the corner
 * nearest its quadrant: the name and its coverage on one line, two counts
 * under it. It grows away from the ring into the canvas corner, so it never
 * covers a mark. The segment is the keyboard control; the label is its
 * description (`id`) and a second pointer target.
 */
import type { CSSProperties } from 'react';

import type { SectionId } from '../../blueprintContract';
import type { LabelBox } from './radialLayout';
import type { RadialStat } from './radialModel';
import { RadialFigure } from './RadialFigure';

interface SectionLabelProps {
  id: string;
  section: SectionId;
  name: string;
  box: LabelBox;
  w: number;
  h: number;
  coverage: number | null;
  stats: RadialStat[];
  hot: boolean;
  onActivate: (section: SectionId) => void;
  onHot: (section: SectionId | null) => void;
}

/** Labels never run wider than this, however much corner there is. */
const LABEL_MAX_W = 300;

export function SectionLabel({ id, section, name, box, w, h, coverage, stats, hot, onActivate, onHot }: SectionLabelProps) {
  const style: CSSProperties = { maxWidth: Math.min(box.maxW, LABEL_MAX_W) };
  if (box.h === 'right') style.left = box.x;
  else style.right = w - box.x;
  if (box.v === 'top') style.bottom = h - box.y;
  else style.top = box.y;

  return (
    <div
      id={id}
      className="rd-label"
      data-testid={`radial-label-${section}`}
      data-h={box.h}
      data-v={box.v}
      data-hot={hot ? 'true' : undefined}
      style={style}
      onClick={() => onActivate(section)}
      onPointerEnter={() => onHot(section)}
      onPointerLeave={() => onHot(null)}
    >
      <div className="rd-label-head">
        <span className="typo-heading text-primary">{name}</span>
        <RadialFigure value={coverage} unit="ratio" className="typo-data-lg text-foreground" />
      </div>
      <div className="rd-label-stats">
        {stats.map((s) => (
          <span key={s.key} className="rd-stat">
            <span className="typo-caption">{s.label}</span>
            <RadialFigure value={s.value} className="typo-data text-foreground" />
          </span>
        ))}
      </div>
    </div>
  );
}
