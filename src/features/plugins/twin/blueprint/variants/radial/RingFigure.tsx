/**
 * The whole anatomy as one SVG drawn 1:1 on the measured canvas: the four
 * coverage segments with their glyph bands, the hub with the twin's initial
 * and readiness, then whatever the caller overlays (L1 leaders, the stage's
 * delta and orbit). Used by L1 (interactive) and by stage (inert, the
 * answered segment lit and the rest receded).
 */
import type { ReactNode } from 'react';

import { SECTION_IDS, type SectionId, type TopicId, type TwinBlueprintModel } from '../../blueprintContract';
import { Guides } from './glyphs/Guides';
import { Hub } from './glyphs/Hub';
import { RadialDefs, type RadialIds } from './glyphs/primitives';
import { SectionGlyph } from './glyphs/SectionGlyph';
import { glyphBand } from './radialGeometry';
import { monogram } from './radialModel';
import { RingSegment } from './RingSegment';

interface RingFigureProps {
  model: TwinBlueprintModel;
  coverage: Record<SectionId, number | null>;
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
  ids: RadialIds;
  /** Section names: present = the segments are controls (L1). */
  labels: Record<SectionId, string> | null;
  /** The figure's accessible name when interactive. */
  name?: string;
  describedBy?: (section: SectionId) => string;
  hot: SectionId | null;
  /** Stage: the segment the delta landed on; the other three recede. */
  lead?: SectionId | null;
  litTopic?: TopicId | null;
  litChannel?: string | null;
  onActivate?: (section: SectionId) => void;
  onHot?: (section: SectionId | null) => void;
  children?: ReactNode;
}

export function RingFigure(props: RingFigureProps) {
  const { model, coverage, w, h, cx, cy, R, ids, labels, name, describedBy, hot, lead, litTopic, litChannel } = props;
  const interactive = labels !== null;
  return (
    <svg
      className="rd-svg"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role={interactive ? 'group' : undefined}
      aria-label={interactive ? name : undefined}
      aria-hidden={interactive ? undefined : true}
      focusable="false"
    >
      <RadialDefs ids={ids} />
      <Guides cx={cx} cy={cy} R={R} />
      {SECTION_IDS.map((s) => (
        <RingSegment
          key={s}
          section={s}
          cx={cx}
          cy={cy}
          R={R}
          coverage={coverage[s]}
          ids={ids}
          label={labels ? labels[s] : null}
          describedBy={describedBy?.(s)}
          hot={hot === s}
          dim={lead != null && lead !== s}
          onActivate={props.onActivate}
          onHot={props.onHot}
        >
          <SectionGlyph
            section={s}
            model={model}
            band={glyphBand(cx, cy, R, s)}
            ids={ids}
            litTopic={lead === s ? litTopic : null}
            litChannel={lead === s ? litChannel : null}
          />
        </RingSegment>
      ))}
      <Hub cx={cx} cy={cy} R={R} initial={monogram(model.identity.name)} readiness={model.readiness.score} ids={ids} />
      {props.children}
    </svg>
  );
}
