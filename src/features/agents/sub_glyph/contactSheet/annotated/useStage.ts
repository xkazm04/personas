/** Stage helpers for the annotated sheet: the stage's measured size, and where
 *  the pen is and what it writes. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { Rect } from "../cinema/useCamera";
import type { SheetGeometry } from "./sheetGeometry";
import type { SheetDrawing } from "./useSheetDrawing";
import { COPY } from "./copy";

export function useStageSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

interface RectArgs {
  stageRef: React.RefObject<HTMLElement | null>;
  centreRef: React.RefObject<HTMLElement | null>;
  frameEls: React.RefObject<Partial<Record<GlyphDimension, HTMLElement | null>>>;
  geo: SheetGeometry;
  stage: { w: number; h: number };
}

/** Where the camera pushes about, in stage pixels: a frame or the centre cell
 *  (laid out inside the sheet's margins, so offset by the sheet's origin), or
 *  any control's client rect. */
export function useSheetRects({ stageRef, centreRef, frameEls, geo, stage }: RectArgs) {
  const at = useCallback((el: HTMLElement): Rect => ({ x: el.offsetLeft + geo.sheet.x, y: el.offsetTop + geo.sheet.y, w: el.offsetWidth, h: el.offsetHeight }), [geo]);
  const centreRect = useCallback((): Rect => {
    const el = centreRef.current;
    return el ? at(el) : { x: stage.w / 2 - 40, y: stage.h / 2 - 30, w: 80, h: 60 };
  }, [centreRef, at, stage]);
  const frameRect = useCallback((dim: GlyphDimension | null): Rect => {
    const el = dim ? frameEls.current?.[dim] : null;
    return el ? at(el) : centreRect();
  }, [frameEls, at, centreRect]);
  const clientRect = useCallback((el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect();
    const o = stageRef.current?.getBoundingClientRect();
    return { x: r.left - (o?.left ?? 0), y: r.top - (o?.top ?? 0), w: r.width, h: r.height };
  }, [stageRef]);
  return { centreRect, frameRect, clientRect };
}

interface PenArgs {
  drawing: SheetDrawing;
  stepEls: React.RefObject<Map<string, HTMLElement>>;
  sessionKey: string;
  lines: string[];
  building: boolean;
  /** A layer is open: the pen is not on the sheet. */
  pushed: boolean;
}

/** The pen sits at the part drawn last and, while the sheet builds up, writes
 *  "DRAW <what>"; once the drawing has caught up it writes the build's newest
 *  line instead, while the build works. Lifted (dimmed) otherwise. */
export function usePenCallout({ drawing, stepEls, sessionKey, lines, building, pushed }: PenArgs) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const latestId = drawing.latest?.id ?? null;
  // After commit: the part just drawn has registered its element by now.
  useEffect(() => {
    if (pushed) return;
    setTarget(latestId ? stepEls.current?.get(latestId) ?? null : null);
  }, [latestId, pushed, stepEls]);

  const tail = lines.length ? (lines[lines.length - 1] ?? "").trim() : "";
  const writing = drawing.drawing && !!drawing.latest;
  const id = writing ? `${sessionKey}#${drawing.count}` : building && tail ? `log#${lines.length}` : null;
  const kind = writing ? COPY.pen.draw : COPY.pen.build;
  const text = writing ? drawing.latest?.label ?? "" : tail;
  // One object per callout: the pen restarts its timer whenever this changes.
  const callout = useMemo(() => (id ? { id, kind, text } : null), [id, kind, text]);

  return { target, callout, working: drawing.drawing || building };
}
