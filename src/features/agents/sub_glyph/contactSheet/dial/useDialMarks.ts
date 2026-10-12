/** useDialMarks - the dial's timed build-up. Live data becomes an append-only
 *  log of drawing steps (dialMarks.growLog), and the shared kit's
 *  `useDraftSteps` draws them one per beat (1100 ms, 380 ms while more than
 *  four are queued), so a build whose data lands in bursts still reads as
 *  being drawn. The log is grown during render with the adjust-state-in-render
 *  pattern (as stage/useSheetSleep does), never in an effect, so a step and the
 *  data behind it land in the same render. The drawing never gates a control:
 *  it only decides which ink and which ticks are SHOWN. */
import { useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { useDraftSteps } from "../blueprint";
import { drawnState, emptyLog, growLog, type DialMark, type Ink, type MarkLog } from "./dialMarks";

export function useDialMarks(
  key: string,
  inks: Record<GlyphDimension, Ink>,
  ticks: readonly DialMark[],
  sectorText: (dim: GlyphDimension, ink: Ink) => string,
) {
  const [log, setLog] = useState<MarkLog>(() => growLog(emptyLog(key), inks, ticks, sectorText));
  const next = growLog(log.key === key ? log : emptyLog(key), inks, ticks, sectorText);
  if (next !== log) setLog(next);
  const count = useDraftSteps(key, next.marks.length);
  return { ...drawnState(next.marks, count), count, total: next.marks.length };
}

export type DialDrawing = ReturnType<typeof useDialMarks>;
