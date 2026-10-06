/** AnnotatedSheetLayout - WP1 "Annotated Sheet": the Cinema contact sheet,
 *  with the blueprint drawn onto it as a surgical overlay.
 *
 *  Everything Cinema does stays: the 3x3 sheet with the sigil under it, the
 *  casting call in the centre, the camera push into a frame, the question
 *  round, the honest film rail, the crowned accent. What the drawing adds:
 *   - the frames are drafted regions: dashed while unknown, hatched under the
 *     pen while their data arrives, inked solid in their colour (wiped on,
 *     ticked) when the pen reaches them;
 *   - the sheet is ANNOTATED as the build learns: margin notes on leader
 *     lines carry each frame's confirmed facts, and dimension lines run along
 *     the edges (eight dimensions and how many are inked; capabilities and
 *     build time once there is a draft);
 *   - a pen travels to whatever was drawn last and writes what it drew, or
 *     the build's latest line while the build works;
 *   - the crowned name is lettered in; a stamp lands when the draft passes
 *     its screening and again when it is issued (promoted);
 *   - a frame opens as a DETAIL drawing of itself (DetailSheet).
 *  The drawing is timed (useSheetDrawing) and never gates a control. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { useAgentStore } from "@/stores/agentStore";
import { recordPersonaCoreClose } from "@/features/agents/sub_glyph/personaCore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { BlueprintPen } from "../blueprint";
import { useSheetState } from "../cinema/useSheetState";
import { layerShot, type Layer } from "../cinema/SheetLayers";
import { FilmRail } from "../cinema/FilmRail";
import { SheetModals, type SheetModal } from "../cinema/SheetModals";
import { SHEET_MOVE, SHEET_MOVE_REDUCED, SHEET_PUSHED, SHEET_PUSHED_REDUCED, SHEET_REST, useCamera } from "../cinema/useCamera";
import { useSheetKeys } from "../cinema/useSheetKeys";
import { populatedDims, timecode } from "../cinema/sheetModel";
import { useSheetSleep } from "../cinema/stage/useSheetSleep";
import { COPY as CINEMA } from "../cinema/copy";
import { inkOf, notesFor, placeBlocks, type Ink, type Note } from "./annotationModel";
import { sheetGeometry } from "./sheetGeometry";
import { useSheetDrawing } from "./useSheetDrawing";
import { useStageSize, usePenCallout, useSheetRects } from "./useStage";
import { AnnotatedPrint } from "./AnnotatedPrint";
import { AnnotatedCentre } from "./AnnotatedCentre";
import { MarginNotes } from "./MarginNotes";
import { AnnotatedLayers } from "./AnnotatedLayers";
import { COPY } from "./copy";

const PAUSED = "[&_*]:[animation-play-state:paused]";
const SETTLED = new Set(["draft", "screening", "verdict", "premiere"]);
const NO_ROWS: GlyphFullLayoutProps["glyphRows"] = [];

export function AnnotatedSheetLayout(props: GlyphFullLayoutProps) {
  const s = useSheetState(props);
  const reduce = useReducedMotion();
  const dimText = useGlyphDimText();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const centreRef = useRef<HTMLDivElement | null>(null);
  const frameEls = useRef<Partial<Record<GlyphDimension, HTMLDivElement | null>>>({});
  const stepEls = useRef(new Map<string, HTMLElement>());
  const stage = useStageSize(stageRef);
  const geo = useMemo(() => sheetGeometry(stage), [stage]);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [modal, setModal] = useState<SheetModal | null>(null);
  const { act, flow } = s;
  const premiere = act === "premiere";
  const tight = geo.sheet.h > 0 && geo.sheet.h < 620;
  const sessionKey = s.sessionId ?? "compose";

  useEffect(() => { setLayer(null); setModal(null); }, [s.sessionId]);

  // -- what the drawing knows -------------------------------------------------
  const { values } = s;
  const rows = s.isCompose ? NO_ROWS : props.glyphRows;
  const populated = useMemo(() => populatedDims(values, props.cellStates, props.glyphRows), [values, props.cellStates, props.glyphRows]);
  const notes = useMemo(() => {
    const out = {} as Record<GlyphDimension, Note[]>;
    for (const dim of GLYPH_DIMENSIONS) out[dim] = notesFor(dim, values[dim], rows);
    return out;
  }, [values, rows]);
  const blocks = useMemo(() => placeBlocks(geo, notes), [geo, notes]);
  const caps = rows.length || values.task?.caps?.length || 0;
  const buildTime = SETTLED.has(act) && s.clock.elapsed >= 1 ? timecode(s.clock.elapsed) : null;
  const drawing = useSheetDrawing({ key: `${sessionKey}:annotated-sheet`, annotate: geo.annotate, premiere, populated, notes, labels: dimText.label, caps, buildTime });
  const inks = useMemo(() => {
    const out = {} as Record<GlyphDimension, Ink>;
    for (const dim of GLYPH_DIMENSIONS) out[dim] = inkOf(s.frameStates[dim], populated[dim], drawing.drawn.has(`ink:${dim}`));
    return out;
  }, [s.frameStates, populated, drawing.drawn]);
  const stamp = premiere ? COPY.stamp.issued : act === "verdict" && props.testPassed ? COPY.stamp.screened : null;

  // -- camera (Cinema's) ------------------------------------------------------
  const { centreRect, frameRect, clientRect } = useSheetRects({ stageRef, centreRef, frameEls, geo, stage });

  const { stage: flowStage, pullBack, open: openQuestion } = flow;
  const openFrame = useCallback((dim: GlyphDimension) => {
    if (flowStage === "asking") pullBack();
    setLayer({ kind: "frame", dim, from: frameRect(dim) });
  }, [flowStage, pullBack, frameRect]);
  const openRefine = useCallback((prefill: string | null) => setLayer({ kind: "refine", prefill, from: centreRect() }), [centreRect]);
  const coreRef = useRef(s.core);
  coreRef.current = s.core;
  const closeLayer = useCallback(() => {
    if (layer?.kind === "core") recordPersonaCoreClose(coreRef.current);
    setLayer(null);
  }, [layer]);
  const dropLayer = useCallback(() => setLayer(null), []);

  const questionOpen = act === "questions" && flow.stage === "asking" && !layer;
  const shot = useCamera(layerShot(layer, s, questionOpen, frameRect), reduce);
  const pushed = shot !== null;
  const sleep = useSheetSleep(shot, (reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE).duration * 1000);
  const scene = CINEMA.scene[act === "questions" && (flow.stage === "review" || flow.stage === "sending") ? "review" : act];

  const holdForTemplate = !!props.templateSuggestionShowing;
  useEffect(() => {
    if (act !== "questions" || flowStage !== "intro" || layer || holdForTemplate) return;
    const h = window.setTimeout(() => openQuestion(0), 2600);
    return () => window.clearTimeout(h);
  }, [act, flowStage, openQuestion, layer, holdForTemplate]);

  useSheetKeys({ act, flow, layer, confirm: modal, closeLayer });

  // -- the pen ----------------------------------------------------------------
  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) stepEls.current.set(id, el); else stepEls.current.delete(id);
  }, []);
  const frameRef = useCallback((dim: GlyphDimension, el: HTMLDivElement | null) => {
    frameEls.current[dim] = el;
    register(`ink:${dim}`, el);
  }, [register]);
  const pen = usePenCallout({ drawing, stepEls, sessionKey, lines: props.cliOutputLines ?? [], building: props.isBuilding, pushed });

  const billing = `${values.trigger?.caption ?? CINEMA.frame.runsOnAsk}${values.message?.caption ? ` · ${values.message.caption}` : ""}`;

  return (
    <div
      className="bp-root flex min-h-0 w-full flex-1 flex-col"
      data-testid="AnnotatedSheetLayout"
      data-drawn={drawing.count}
      style={{ ["--cinema-accent" as string]: s.cast.accent, ["--paper" as string]: "var(--background)" }}
    >
      <div ref={stageRef} className="bp-grid relative min-h-0 min-w-0 flex-1 overflow-clip rounded-card" style={{ outline: "1px solid var(--ink-faint)", outlineOffset: -4 }}>
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
          <AnnotatedPrint
            frozen={sleep.frozen} premiere={premiere} geo={geo} labels={dimText.label}
            inks={inks} values={s.frameValues} petalStates={s.petalStates} populated={populated}
            accent={s.cast.accent} presence={s.presence} stamp={stamp} onOpenFrame={openFrame} frameRef={frameRef} centreRef={centreRef}
            margins={geo.annotate && !premiere ? (
              <MarginNotes geo={geo} blocks={blocks} notes={notes} drawn={drawing.drawn} caps={caps} buildTime={buildTime} register={register} />
            ) : null}
            centre={
              <AnnotatedCentre
                p={props} s={s} tight={tight} billing={billing}
                a={{
                  openContext: (el) => setLayer({ kind: "context", from: clientRect(el) }),
                  openCore: (el) => setLayer({ kind: "core", from: clientRect(el) }),
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
        {!pushed && <BlueprintPen rootRef={stageRef} target={pen.target} working={pen.working} callout={pen.callout} />}
        <AnnotatedLayers
          p={props} s={s} layer={layer} shot={shot} scene={scene} dimText={dimText} populated={populated}
          sessionKey={sessionKey} close={closeLayer} drop={dropLayer} openRefine={openRefine}
        />
      </div>

      <FilmRail scene={scene} elapsed={s.clock.elapsed} marks={s.clock.marks} showWindow={act === "casting"} running={s.clock.running} partial={s.clock.partial} />

      {s.isCompose && s.cfg.modals}
      <SheetModals p={props} s={s} modal={modal} close={() => setModal(null)} />
    </div>
  );
}
