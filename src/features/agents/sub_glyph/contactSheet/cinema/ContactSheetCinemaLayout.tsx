/** ContactSheetCinemaLayout — V1 "Sheet · Cinema": the Contact Sheet shot in
 *  the Cinema's language.
 *
 *  The 3x3 sheet stays: the prompt in the centre cell, eight frames around it
 *  that develop from unexposed negatives into small pictures of their value,
 *  the camera push into a frame's inner layer and the pull back out, and the
 *  film rail of honest build time along the bottom. What Cinema brings:
 *   • the persona sigil lies UNDER the sheet, centred on the centre cell; the
 *     frames are placed where its petals point, so each petal reaches into its
 *     frame and lights in that frame's colour as the frame develops;
 *   • the silent first pass is Cinema's casting call, inside the centre cell
 *     under a clapperboard slate; the real identity crowns a finalist, whose
 *     colour then becomes the whole sheet's accent;
 *   • connectors and capabilities arrive one per beat with Cinema's springs,
 *     docking into their frames and onto the title card's film strip;
 *   • the premiere turns the crowned persona into a poster while the frames
 *     slide down into a credits strip.
 *  The camera itself (useCamera + Loupe) is the Wild cut's: the sheet pushes
 *  2.5x into the frame and fades behind a stage-sized layer that grows out of
 *  that frame. The sheet is put to sleep for the move (stage/useSheetSleep):
 *  frozen, loops paused, then hidden under the layer; the camera moves one
 *  static picture with transform + opacity only and wakes it on pull-out. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { useSheetState } from "./useSheetState";
import { SheetCentre } from "./SheetCentre";
import { SheetLayers, layerShot, type Layer } from "./SheetLayers";
import { FilmRail } from "./FilmRail";
import { SheetModals, type SheetModal } from "./SheetModals";
import { SHEET_MOVE, SHEET_MOVE_REDUCED, SHEET_PUSHED, SHEET_PUSHED_REDUCED, SHEET_REST, useCamera, type Rect } from "./useCamera";
import { useSheetKeys } from "./useSheetKeys";
import { populatedDims } from "./sheetModel";
import { SheetPrint } from "./stage/SheetPrint";
import { useSheetSleep } from "./stage/useSheetSleep";
import { COPY } from "./copy";

/** Paused CSS loops (petal pulses) on everything under a sleeping sheet. */
const PAUSED = "[&_*]:[animation-play-state:paused]";

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const layoutRect = (el: HTMLElement | null | undefined): Rect | null =>
  el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;

export function ContactSheetCinemaLayout(props: GlyphFullLayoutProps) {
  const s = useSheetState(props);
  const reduce = useReducedMotion();
  const dimText = useGlyphDimText();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const centreRef = useRef<HTMLDivElement | null>(null);
  const frameEls = useRef<Partial<Record<GlyphDimension, HTMLDivElement | null>>>({});
  const stage = useSize(stageRef);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [modal, setModal] = useState<SheetModal | null>(null);
  const { act, flow } = s;
  const premiere = act === "premiere";
  const tight = stage.h > 0 && stage.h < 700;

  useEffect(() => { setLayer(null); setModal(null); }, [s.sessionId]);

  const centreRect = useCallback((): Rect => layoutRect(centreRef.current) ?? { x: stage.w / 2 - 40, y: stage.h / 2 - 30, w: 80, h: 60 }, [stage]);
  const frameRect = useCallback((dim: GlyphDimension | null): Rect => (dim && layoutRect(frameEls.current[dim])) || centreRect(), [centreRect]);
  const clientRect = (el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect();
    const o = stageRef.current?.getBoundingClientRect();
    return { x: r.left - (o?.left ?? 0), y: r.top - (o?.top ?? 0), w: r.width, h: r.height };
  };

  const { stage: flowStage, pullBack, open: openQuestion } = flow;
  const openFrame = useCallback((dim: GlyphDimension) => {
    if (flowStage === "asking") pullBack();
    setLayer({ kind: "frame", dim, from: frameRect(dim) });
  }, [flowStage, pullBack, frameRect]);
  const openRefine = useCallback((prefill: string | null) => setLayer({ kind: "refine", prefill, from: centreRect() }), [centreRect]);
  const closeLayer = useCallback(() => setLayer(null), []);

  const questionOpen = act === "questions" && flow.stage === "asking" && !layer;
  const shot = useCamera(layerShot(layer, s, questionOpen, frameRect), reduce);
  const pushed = shot !== null;
  const sleep = useSheetSleep(shot, (reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE).duration * 1000);
  const scene = COPY.scene[act === "questions" && (flow.stage === "review" || flow.stage === "sending") ? "review" : act];

  // Cinema's beat: let the coronation land before the camera pushes into the first question.
  useEffect(() => {
    if (act !== "questions" || flowStage !== "intro" || layer) return;
    const h = window.setTimeout(() => openQuestion(0), 2600);
    return () => window.clearTimeout(h);
  }, [act, flowStage, openQuestion, layer]);

  useSheetKeys({ act, flow, layer, confirm: modal, closeLayer });

  const values = s.values;
  const billing = `${values.trigger?.caption ?? COPY.frame.runsOnAsk}${values.message?.caption ? ` · ${values.message.caption}` : ""}`;
  const populated = useMemo(() => populatedDims(values, props.cellStates, props.glyphRows), [values, props.cellStates, props.glyphRows]);
  const frameRef = useCallback((dim: GlyphDimension, el: HTMLDivElement | null) => { frameEls.current[dim] = el; }, []);

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col" data-testid="ContactSheetCinemaLayout" style={{ ["--cinema-accent" as string]: s.cast.accent }}>
      <div ref={stageRef} className="relative flex-1 min-h-0">
        {/* The camera: sigil and sheet move as one sleeping print under the lens. */}
        <motion.div
          className={`absolute inset-0 ${sleep.frozen ? PAUSED : ""}`}
          style={{ transformOrigin: sleep.origin, willChange: sleep.frozen ? "transform, opacity" : undefined, visibility: sleep.hidden ? "hidden" : undefined }}
          initial={false}
          animate={pushed ? (reduce ? SHEET_PUSHED_REDUCED : SHEET_PUSHED) : SHEET_REST}
          transition={reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE}
          onAnimationComplete={sleep.onMoveEnd}
          inert={pushed ? true : undefined}
          aria-hidden={pushed ? true : undefined}
        >
          <SheetPrint
            frozen={sleep.frozen} premiere={premiere} stage={stage} labels={dimText.label}
            frameStates={s.frameStates} petalStates={s.petalStates} values={values} populated={populated}
            accent={s.cast.accent} presence={s.presence} onOpenFrame={openFrame} frameRef={frameRef} centreRef={centreRef}
            centre={
              <SheetCentre
                p={props} s={s} tight={tight} billing={billing}
                a={{
                  openContext: (el) => setLayer({ kind: "context", from: clientRect(el) }),
                  openRefine: () => openRefine(null),
                  openCaps: () => setLayer({ kind: "caps", from: centreRect() }),
                  openReport: () => setModal("report"),
                  openSimulate: () => setModal("simulate"),
                  openLog: (el) => setLayer({ kind: "log", from: clientRect(el) }),
                  askForce: () => setModal("force"),
                  askReject: () => setModal("reject"),
                  startOver: () => useAgentStore.getState().resetBuildSession(),
                }}
              />
            }
          />
        </motion.div>
        <SheetLayers p={props} s={s} layer={layer} shot={shot} scene={scene} dimText={dimText} close={closeLayer} openRefine={openRefine} />
      </div>

      <FilmRail scene={scene} elapsed={s.clock.elapsed} marks={s.clock.marks} showWindow={act === "casting"} running={s.clock.running} partial={s.clock.partial} />

      {s.isCompose && s.cfg.modals}
      <SheetModals p={props} s={s} modal={modal} close={() => setModal(null)} />
    </div>
  );
}
