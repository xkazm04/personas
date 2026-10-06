/** DialSector - one dimension's segment of the sector ring: its ink, its
 *  engraved label running along the arc (on the lower half the arc runs
 *  backwards so the lettering reads upright), the angle dimension under it
 *  (a hairline arc with end ticks, drawn only once the sector has something),
 *  and its tick when inked, all in the dimension's own colour. The whole
 *  segment is the control that explodes it. */
import { memo, useId } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, PETAL_ANGLES } from "@/features/shared/glyph";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { LETTERING } from "../../blueprint";
import { RADII, annulus, arc, polar, radial, readsBackwards, sectorSpan, type Pt } from "../dialGeometry";
import type { Ink } from "../dialMarks";
import { COPY } from "../copy";
import { InkTick, SectorInk } from "./SectorInk";

interface DialSectorProps {
  dim: GlyphDimension;
  c: Pt;
  R: number;
  ink: Ink;
  populated: boolean;
  label: string;
  num: string;
  onOpen: (dim: GlyphDimension) => void;
}

export const DialSector = memo(function DialSector({ dim, c, R, ink, populated, label, num, onOpen }: DialSectorProps) {
  const id = useId().replace(/:/g, "");
  const [a0, a1] = sectorSpan(dim);
  const theta = PETAL_ANGLES[dim];
  const color = DIM_META[dim].color;
  const r0 = R * RADII.sectorIn, r1 = R * RADII.sectorOut;
  const d = annulus(c, r0, r1, a0, a1);
  const mid = polar(c, (r0 + r1) / 2, theta);
  const size = (r1 - r0) + 2 * r1 * Math.sin((Math.PI / 180) * (a1 - a0) / 2);
  const box = { x: mid.x - size / 2, y: mid.y - size / 2, size };
  const back = readsBackwards(theta);
  // Lettering sits on the band's midline: outward of the path when it runs
  // clockwise, inward when it runs backwards.
  const textR = (r0 + r1) / 2 + (back ? 4.5 : -4.5);
  const drawn = ink !== "pending";
  const vivid = populated && ink === "done";
  const tickAt = polar(c, (r0 + r1) / 2, a1 - 4);
  const stateWord = COPY.ink[ink];

  return (
    <g
      className="dial-sector"
      style={{ ["--sector" as string]: color }}
      role="button"
      tabIndex={0}
      aria-label={COPY.sectorAria(label, stateWord)}
      data-testid={`dial-sector-${dim}`}
      onClick={() => onOpen(dim)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(dim); } }}
    >
      <SectorInk d={d} ink={ink} color={color} populated={populated} box={box} />
      <path className="dial-sector-hit" d={d} />
      <defs><path id={`${id}-label`} d={arc(c, textR, a0, a1, back)} /></defs>
      <text style={{ ...LETTERING, fontSize: 11 }} fill={drawn ? color : colorWithAlpha(color, 0.62)} pointerEvents="none">
        <textPath href={`#${id}-label`} startOffset="50%" textAnchor="middle">{`${num} ${label}`}</textPath>
      </text>
      {drawn && (
        <path
          d={`${arc(c, R * RADII.dimArc, a0 + 1, a1 - 1)}${radial(c, R * RADII.dimArc - 3, R * RADII.dimArc + 3, a0 + 1)}${radial(c, R * RADII.dimArc - 3, R * RADII.dimArc + 3, a1 - 1)}`}
          fill="none" stroke={colorWithAlpha(color, vivid ? 1 : 0.5)} strokeWidth={1} pointerEvents="none"
        />
      )}
      {ink === "done" && <InkTick x={tickAt.x} y={tickAt.y} color={color} />}
    </g>
  );
});
