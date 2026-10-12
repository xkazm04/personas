/** DialReadouts - the two readout columns beside the dial, one chip per
 *  sector at the end of its leader line: the numbered caption badge in the
 *  sector's ink, the engraved label, where it stands, and the value caption.
 *  The pen writes its callout INTO the readout of the step it just drew
 *  ("CONNECTOR  Gmail", lettered in), which settles back to the caption after
 *  4.2 s. A chip opens the same exploded view as its sector. */
import { memo, useEffect, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { LETTERING } from "../blueprint";
import type { FrameValue } from "../cinema/useFrameValues";
import { frameNumber } from "../cinema/sheetModel";
import { CHIP_H, type Readout } from "./dialGeometry";
import type { DialMark, Ink } from "./dialMarks";
import { InkBadge } from "./InkBadge";
import { Lettered } from "./Lettered";
import { COPY } from "./copy";

const CALLOUT_MS = 4200;

/** The newest step, for as long as its callout stays written. */
export function useCallout(latest: DialMark | null): DialMark | null {
  const [shown, setShown] = useState<string | null>(null);
  const id = latest?.id ?? null;
  useEffect(() => {
    if (!id) return;
    setShown(id);
    const h = window.setTimeout(() => setShown(null), CALLOUT_MS);
    return () => window.clearTimeout(h);
  }, [id]);
  return latest && shown === latest.id ? latest : null;
}

/** Below this column width the "by the build / set by you" word is dropped
 *  for a finished part (its inked badge already says it is done), so the
 *  name and the caption keep the room and nothing runs off the stage. */
const ROOMY = 210;

function stateWord(ink: Ink, value: FrameValue | null): string {
  if (ink === "done" && value?.by) return COPY.by[value.by];
  return COPY.ink[ink];
}

interface DialReadoutsProps {
  readouts: Record<GlyphDimension, Readout>;
  colW: number;
  labels: Record<GlyphDimension, string>;
  ink: Record<GlyphDimension, Ink>;
  populated: Record<GlyphDimension, boolean>;
  values: Record<GlyphDimension, FrameValue | null>;
  callout: DialMark | null;
  onOpen: (dim: GlyphDimension) => void;
}

export const DialReadouts = memo(function DialReadouts({ readouts, colW, labels, ink, populated, values, callout, onOpen }: DialReadoutsProps) {
  return (
    <>
      {GLYPH_DIMENSIONS.map((dim) => {
        const r = readouts[dim];
        const left = r.side < 0;
        const color = DIM_META[dim].color;
        const value = ink[dim] === "pending" ? null : values[dim];
        const writing = callout?.dim === dim ? callout : null;
        const vivid = populated[dim] && ink[dim] === "done";
        return (
          <Button
            key={dim}
            variant="ghost"
            size="sm"
            data-testid={`dial-readout-${dim}`}
            onClick={() => onOpen(dim)}
            className={`dial-readout absolute !px-1.5 !py-1 [&>span]:w-full [&>span]:min-w-0 ${left ? "text-right" : "text-left"}`}
            style={{ left: left ? r.end.x - colW - 6 : r.end.x + 6, top: r.end.y - CHIP_H / 2, width: colW, height: CHIP_H }}
          >
            {/* Button wraps its label in a bare span; this column is the chip's real body. */}
            <span className={`flex w-full min-w-0 flex-col justify-center gap-0.5 ${left ? "items-end" : "items-start"}`}>
            <span className={`flex w-full min-w-0 items-center gap-2 ${left ? "flex-row-reverse" : ""}`}>
              <InkBadge num={frameNumber(dim)} ink={ink[dim]} color={color} populated={populated[dim]} size={18} />
              <span className="dial-readout-label min-w-0 truncate" style={{ ...LETTERING, color: vivid ? color : colorWithAlpha(color, ink[dim] === "pending" ? 0.62 : 0.85) }}>
                {labels[dim]}
              </span>
              {(colW >= ROOMY || ink[dim] !== "done") && (
                <span className={`typo-caption shrink-0 whitespace-nowrap ${left ? "mr-auto" : "ml-auto"}`}>{stateWord(ink[dim], value)}</span>
              )}
            </span>
            <span className="block w-full truncate typo-body text-foreground">
              {writing ? (
                <span key={writing.id}>
                  <span style={{ ...LETTERING, color }}>{writing.kind === "sector" ? (writing.ink && COPY.ink[writing.ink]) || COPY.kind.sector : COPY.kind[writing.kind]}</span>{" "}
                  <Lettered text={writing.text} />
                </span>
              ) : value?.caption ?? " "}
            </span>
            </span>
          </Button>
        );
      })}
    </>
  );
});
