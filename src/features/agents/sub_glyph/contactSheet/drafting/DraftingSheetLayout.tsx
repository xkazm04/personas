/** DraftingSheetLayout - WP2 "Drafting Sheet" (spark onboarding-blueprint):
 *  Studio's drafting sheet transplanted onto the Cinema stage.
 *
 *  Sheet 1 of 9 is the persona as a drafted object: eight dimension regions
 *  around the sigil in line work, leader lines to the petals they name, a
 *  dimension line under it, and Studio's title block beside it (project,
 *  status with the honest clock, the lettered brief, the dimensions as
 *  numbered goals, the build's notes, a stamp, and Cinema's action panel
 *  docked as its last cell). The sheet is BUILT UP on a timer, one step a
 *  beat (useDraftingSequence), and the pen follows what is being drawn.
 *  Nothing in the build-up gates a control.
 *
 *  A region (or a goal row) opens that dimension's own sheet, "Sheet n of 9",
 *  in the same shell one level down; the sheets turn like pages (transform and
 *  opacity only) and Esc turns back. Every other inner layer (questions,
 *  context, persona core, refine, capabilities, log) is Cinema's, reached by
 *  Cinema's camera push, with the sheet asleep under it. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { useAgentStore } from "@/stores/agentStore";
import { recordPersonaCoreClose } from "@/features/agents/sub_glyph/personaCore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { useSheetState } from "../cinema/useSheetState";
import { SheetLayers, layerShot, type Layer } from "../cinema/SheetLayers";
import { SheetModals, type SheetModal } from "../cinema/SheetModals";
import { SHEET_MOVE, SHEET_MOVE_REDUCED, useCamera, type Rect } from "../cinema/useCamera";
import { useSheetKeys } from "../cinema/useSheetKeys";
import { useSheetSleep } from "../cinema/stage/useSheetSleep";
import { populatedDims } from "../cinema/sheetModel";
import { ActPanel, type CentreActions } from "../cinema/centre/ActPanel";
import { COPY as CINEMA } from "../cinema/copy";
import { inkOf, type Ink } from "./sheetGeometry";
import { useDraftingSequence } from "./useDraftingSequence";
import { useDrawingEpoch, useElRegistry } from "./useElRegistry";
import { offsetRect, useBoxSize } from "./useBoxSize";
import { MainSheet } from "./MainSheet";
import { NestedSheet } from "./NestedSheet";
import { CAM, TURN, TURN_VARIANTS, TURN_VARIANTS_REDUCED, stampOf } from "./layoutMotion";
import "../blueprint";
import "./drafting-sheet.css";

type Turn = { dim: GlyphDimension | null; dir: 1 | -1 };

export function DraftingSheetLayout(props: GlyphFullLayoutProps) {
  const s = useSheetState(props);
  const reduce = useReducedMotion();
  const dimText = useGlyphDimText();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useBoxSize(stageRef);
  const { els, refFor } = useElRegistry();
  const [layer, setLayer] = useState<Layer | null>(null);
  const [turn, setTurn] = useState<Turn>({ dim: null, dir: 1 });
  const [modal, setModal] = useState<SheetModal | null>(null);
  const { act, flow } = s;
  const core = useAgentStore((st) => st.buildBehaviorCore);

  useEffect(() => { setLayer(null); setModal(null); setTurn({ dim: null, dir: 1 }); }, [s.sessionId]);

  // -- the build-up ----------------------------------------------------------
  const drawKey = `drafting:${useDrawingEpoch(s.sessionId)}`;
  const populated = useMemo(() => populatedDims(s.values, props.cellStates, props.glyphRows), [s.values, props.cellStates, props.glyphRows]);
  const hasBrief = !s.isCompose && !!(core?.identity?.role || core?.mission);
  const seq = useDraftingSequence(drawKey, populated, hasBrief);
  const inks = useMemo(() => {
    const out = {} as Record<GlyphDimension, Ink>;
    for (const dim of GLYPH_DIMENSIONS) out[dim] = inkOf(s.frameStates[dim], populated[dim] && seq.inked.has(dim));
    return out;
  }, [s.frameStates, populated, seq.inked]);

  // -- the camera (Cinema's layers) and the page turn (our sheets) -----------
  const rel = useCallback((el: HTMLElement | null | undefined): Rect | null => offsetRect(el, stageRef.current), []);
  const centreRect = useCallback((): Rect => rel(els["figure"]) ?? { x: stage.w / 2 - 40, y: stage.h / 2 - 30, w: 80, h: 60 }, [rel, els, stage]);
  const frameRect = useCallback((dim: GlyphDimension | null): Rect => (dim && rel(els[`region:${dim}`])) || centreRect(), [rel, els, centreRect]);
  const clientRect = (el: HTMLElement): Rect => rel(el) ?? centreRect();

  const { stage: flowStage, pullBack, open: openQuestion } = flow;
  const openSheet = useCallback((dim: GlyphDimension) => {
    if (flowStage === "asking") pullBack();
    setTurn({ dim, dir: 1 });
  }, [flowStage, pullBack]);
  const closeSheet = useCallback(() => setTurn((t) => ({ dim: null, dir: t.dir === 1 ? -1 : t.dir })), []);
  const turnSheet = useCallback((dir: 1 | -1) => setTurn((t) => {
    const i = t.dim ? GLYPH_DIMENSIONS.indexOf(t.dim) : 0;
    return { dim: GLYPH_DIMENSIONS[(i + dir + GLYPH_DIMENSIONS.length) % GLYPH_DIMENSIONS.length]!, dir };
  }), []);
  const openRefine = useCallback((prefill: string | null) => setLayer({ kind: "refine", prefill, from: centreRect() }), [centreRect]);
  const coreRef = useRef(s.core);
  coreRef.current = s.core;
  const closeLayer = useCallback(() => {
    if (layer?.kind === "core") recordPersonaCoreClose(coreRef.current);
    setLayer(null);
  }, [layer]);
  const dropLayer = useCallback(() => setLayer(null), []);

  const away = turn.dim !== null;
  const questionOpen = act === "questions" && flow.stage === "asking" && !layer && !away;
  const shot = useCamera(layerShot(layer, s, questionOpen, frameRect), reduce);
  const pushed = shot !== null;
  const sleep = useSheetSleep(shot, (reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE).duration * 1000);
  const scene = CINEMA.scene[act === "questions" && (flow.stage === "review" || flow.stage === "sending") ? "review" : act];

  // Cinema's beat: let the crowning land before the camera pushes into the
  // first question; held while the "Faster path" row shows, or a sheet is turned.
  const holdForTemplate = !!props.templateSuggestionShowing;
  useEffect(() => {
    if (act !== "questions" || flowStage !== "intro" || layer || away || holdForTemplate) return;
    const h = window.setTimeout(() => openQuestion(0), 2600);
    return () => window.clearTimeout(h);
  }, [act, flowStage, openQuestion, layer, away, holdForTemplate]);

  useSheetKeys({ act, flow, layer: layer ?? turn.dim, confirm: modal, closeLayer: layer ? closeLayer : closeSheet });

  const actions: CentreActions = {
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
  };
  const tight = stage.h > 0 && stage.h < 700;
  const dock = s.isCompose ? null : <ActPanel p={props} s={s} a={actions} tight={tight} />;
  const cam = pushed ? (reduce ? CAM.fade : CAM.pushed) : away ? (reduce ? CAM.fade : CAM.away) : CAM.rest;

  return (
    <div className="bp-root dsh-root flex-1 min-h-0 w-full flex flex-col" data-testid="DraftingSheetLayout" style={{ ["--cinema-accent" as string]: s.cast.accent }}>
      <div ref={stageRef} className="relative flex-1 min-h-0 min-w-0 overflow-clip">
        <motion.div
          className={`absolute inset-0 ${sleep.frozen ? "[&_*]:[animation-play-state:paused]" : ""}`}
          style={{ transformOrigin: sleep.origin, willChange: sleep.frozen || away ? "transform, opacity" : undefined, visibility: sleep.hidden ? "hidden" : undefined }}
          initial={false}
          animate={cam}
          transition={reduce ? SHEET_MOVE_REDUCED : pushed || sleep.phase === "waking" ? SHEET_MOVE : TURN}
          onAnimationComplete={sleep.onMoveEnd}
          inert={pushed || away ? true : undefined}
          aria-hidden={pushed || away ? true : undefined}
        >
          <MainSheet
            p={props} s={s} a={actions} seq={seq} inks={inks} labels={dimText.label} refFor={refFor} els={els}
            onOpen={openSheet} scene={scene} stamp={stampOf(act, props.testPassed)} dock={dock} frozen={sleep.frozen || away}
          />
        </motion.div>
        <AnimatePresence initial={false} custom={turn.dir}>
          {turn.dim && (
            <motion.div
              key={turn.dim}
              custom={turn.dir}
              variants={reduce ? TURN_VARIANTS_REDUCED : TURN_VARIANTS}
              initial="enter" animate="center" exit="exit"
              transition={reduce ? SHEET_MOVE_REDUCED : TURN}
              className="absolute inset-0 z-20"
            >
              <NestedSheet
                dim={turn.dim} p={props} s={s} dimText={dimText} populated={populated[turn.dim]}
                drawKey={drawKey} onBack={closeSheet} onTurn={turnSheet}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <SheetLayers p={props} s={s} layer={layer} shot={shot} scene={scene} dimText={dimText} close={closeLayer} drop={dropLayer} openRefine={openRefine} />
      </div>
      {s.isCompose && s.cfg.modals}
      <SheetModals p={props} s={s} modal={modal} close={() => setModal(null)} />
    </div>
  );
}
