/**
 * L1: the full anatomy. The ring sits centred at the largest radius that
 * still leaves its four diagonal labels full-size room in the canvas corners;
 * short leaders join each quadrant to its label. Choosing a segment zooms the
 * whole figure into it (a CSS transform from the segment's centroid onto the
 * L2 ring's centre) while it fades; reduced motion fades only.
 */
import { SECTION_IDS, type SectionId, type TwinBlueprintModel } from '../../blueprintContract';
import { useTranslation } from '@/i18n/useTranslation';

import type { RadialIds } from './glyphs/primitives';
import { polar, segmentAngles } from './radialGeometry';
import { focusRingCentre, overviewLayout, zoomStyle } from './radialLayout';
import { sectionStats } from './radialModel';
import { RingFigure } from './RingFigure';
import { SectionLabel } from './SectionLabel';

interface RadialOverviewProps {
  model: TwinBlueprintModel;
  coverage: Record<SectionId, number | null>;
  w: number;
  h: number;
  uid: string;
  ids: RadialIds;
  hot: SectionId | null;
  /** The segment L2 is zoomed into; `null` = this overview is live. */
  zoom: SectionId | null;
  reduced: boolean;
  onActivate: (section: SectionId) => void;
  onHot: (section: SectionId | null) => void;
}

export function RadialOverview({ model, coverage, w, h, uid, ids, hot, zoom, reduced, onActivate, onHot }: RadialOverviewProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const layout = overviewLayout(w, h);
  const { cx, cy, R } = layout;
  const hidden = zoom !== null;
  const style = zoom && !reduced ? zoomStyle(layout, zoom, focusRingCentre(w, h)) : undefined;
  const labelId = (s: SectionId) => `${uid}-label-${s}`;

  return (
    <div className="rd-l1" data-zoom={zoom ?? undefined} aria-hidden={hidden || undefined} inert={hidden} style={style}>
      <RingFigure
        model={model}
        coverage={coverage}
        w={w}
        h={h}
        cx={cx}
        cy={cy}
        R={R}
        ids={ids}
        labels={hidden ? null : tb.sections}
        name={tb.variants.radial}
        describedBy={labelId}
        hot={hot}
        onActivate={onActivate}
        onHot={onHot}
      >
        {SECTION_IDS.map((s) => {
          const from = polar(cx, cy, R + 4, segmentAngles(s).mid);
          const box = layout.labels[s];
          return (
            <g key={s} className="rd-leader" data-hot={hot === s ? 'true' : undefined}>
              <line x1={from.x} y1={from.y} x2={box.x} y2={box.y} />
              <circle cx={from.x} cy={from.y} r={3} />
            </g>
          );
        })}
      </RingFigure>
      {SECTION_IDS.map((s) => (
        <SectionLabel
          key={s}
          id={labelId(s)}
          section={s}
          name={tb.sections[s]}
          box={layout.labels[s]}
          w={w}
          h={h}
          coverage={coverage[s]}
          stats={sectionStats(model, s, tb.metrics)}
          hot={hot === s}
          onActivate={onActivate}
          onHot={onHot}
        />
      ))}
      {layout.hintY !== null && (
        <p className="rd-hint typo-caption" style={{ top: layout.hintY }}>
          {tb.variantCopy.radial.centerHint}
        </p>
      )}
    </div>
  );
}
