/** DialPrint - the instrument under the camera: the figure (scale, sectors,
 *  rim, leaders), the sweep arm, the casting orbit, the hub, the readout
 *  columns and the corner furniture, all in one stage-sized coordinate space.
 *
 *  Memoised like Cinema's SheetPrint: while a layer is open the print sleeps
 *  (`frozen`) and React keeps its last awake render, so the clock ticking in
 *  the hub never walks the figure under a camera move. */
import { memo } from "react";
import { LayoutGroup } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS, PETAL_ANGLES } from "@/features/shared/glyph";
import type { CinemaCast } from "../cinema/useCinemaCast";
import type { FrameValue } from "../cinema/useFrameValues";
import { frameNumber } from "../cinema/sheetModel";
import { RADII, type DialLayout } from "./dialGeometry";
import type { DialDrawing } from "./useDialMarks";
import { DialScale } from "./figure/DialScale";
import { DialSector } from "./figure/DialSector";
import { DialRim, rimAngle } from "./figure/DialRim";
import { DialLeaders } from "./figure/DialLeaders";
import { SweepArm } from "./figure/SweepArm";
import { DialReadouts, useCallout } from "./DialReadouts";
import { DialOrbit } from "./DialCasting";

interface DialPrintProps {
  frozen: boolean;
  stage: { w: number; h: number };
  layout: DialLayout;
  labels: Record<GlyphDimension, string>;
  drawing: DialDrawing;
  populated: Record<GlyphDimension, boolean>;
  values: Record<GlyphDimension, FrameValue | null>;
  cast: CinemaCast;
  orbiting: boolean;
  presence: number;
  working: boolean;
  sweepKey: string;
  onOpen: (dim: GlyphDimension) => void;
  /** The hub's act surface and the corner furniture, built by the layout. */
  hub: React.ReactNode;
  furniture: React.ReactNode;
}

function armAngle(d: DialDrawing): number | null {
  const m = d.latest;
  if (!m) return null;
  if (m.kind === "sector") return PETAL_ANGLES[m.dim];
  const list = d.ticks[m.dim];
  return rimAngle(m.dim, Math.max(0, list.findIndex((t) => t.id === m.id)), list.length);
}

function DialPrintImpl(p: DialPrintProps) {
  const { layout: L, drawing: d } = p;
  const callout = useCallout(d.latest);
  return (
    <LayoutGroup id="dial-cast">
      <svg width={p.stage.w} height={p.stage.h} className="absolute inset-0 overflow-visible" data-testid="dial-figure">
        <DialScale c={L.c} R={L.R} presence={p.presence} sweepKey={p.sweepKey} />
        <DialRim c={L.c} R={L.R} ticks={d.ticks} />
        <DialLeaders readouts={L.readouts} ink={d.ink} populated={p.populated} callout={callout ? { id: callout.id, dim: callout.dim } : null} />
        {GLYPH_DIMENSIONS.map((dim) => (
          <DialSector
            key={dim} dim={dim} c={L.c} R={L.R} ink={d.ink[dim]} populated={p.populated[dim]}
            label={p.labels[dim]} num={frameNumber(dim)} onOpen={p.onOpen}
          />
        ))}
      </svg>
      <SweepArm
        pivot={L.c} r0={L.R * RADII.face} r1={L.R * 0.955} angle={armAngle(d)} working={p.working}
        color={d.latest ? DIM_META[d.latest.dim].color : undefined}
      />
      {p.orbiting && <DialOrbit cast={p.cast} c={L.c} R={L.R} />}
      {p.hub}
      <DialReadouts
        readouts={L.readouts} colW={L.colW} labels={p.labels} ink={d.ink} populated={p.populated}
        values={p.values} callout={callout} onOpen={p.onOpen}
      />
      {p.furniture}
    </LayoutGroup>
  );
}

/** Asleep: keep the last awake render, whatever the props say. */
export const DialPrint = memo(DialPrintImpl, (_prev, next) => next.frozen);
