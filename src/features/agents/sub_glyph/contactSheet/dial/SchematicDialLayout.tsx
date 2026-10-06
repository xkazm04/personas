/** SchematicDialLayout - "Schematic Dial" (spark onboarding-blueprint WP3):
 *  the persona as a precision instrument, on Cinema's stage and in its accent.
 *
 *  One radial schematic fills the stage: eight SECTORS at the sigil's petal
 *  angles, each in an ink state (dashed still to draw, hatched while drafted,
 *  inked in its dimension's colour with a tick), a RIM that collects one tick
 *  per thing the build learns, a degree scale for its construction grid, and a
 *  sweep arm (the pen) that swings to the part drawn last and writes its
 *  callout into that sector's readout at the end of a leader line. The drawing
 *  is TIMED (the kit's useDraftSteps, keyed per build session) and never gates
 *  a control. The hub carries Cinema's act surfaces; through casting the crowd
 *  orbits it and the winner flies in to be crowned. A sector click EXPLODES it
 *  (explode/ExplodedLayer); every other layer is Cinema's camera, unchanged. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { useAgentStore } from "@/stores/agentStore";
import { recordPersonaCoreClose } from "@/features/agents/sub_glyph/personaCore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import "../blueprint";
import { useSheetState } from "../cinema/useSheetState";
import { SheetLayers, layerShot, type Layer } from "../cinema/SheetLayers";
import { FilmRail } from "../cinema/FilmRail";
import { SheetModals, type SheetModal } from "../cinema/SheetModals";
import { SHEET_MOVE, SHEET_MOVE_REDUCED, SHEET_PUSHED, SHEET_PUSHED_REDUCED, SHEET_REST, useCamera, type Rect } from "../cinema/useCamera";
import { useSheetKeys } from "../cinema/useSheetKeys";
import { populatedDims } from "../cinema/sheetModel";
import { useSheetSleep } from "../cinema/stage/useSheetSleep";
import { COPY as CINEMA } from "../cinema/copy";
import { dialLayout, sectorPoint } from "./dialGeometry";
import { inkOf, rimTicks, type Ink } from "./dialMarks";
import { useDialMarks } from "./useDialMarks";
import { useStageSize } from "./useStageSize";
import { DialPrint } from "./DialPrint";
import { DialHub } from "./DialHub";
import { DialLegend, DialPlate } from "./DialPlate";
import { ExplodedLayer } from "./explode/ExplodedLayer";
import { COPY } from "./copy";
import "./dial.css";

const PAUSED = "[&_*]:[animation-play-state:paused]";
const DIMMED = { transform: "scale(0.95)", opacity: 0.14 };

export function SchematicDialLayout(props: GlyphFullLayoutProps) {
  const s = useSheetState(props);
  const reduce = useReducedMotion();
  const dimText = useGlyphDimText();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useStageSize(stageRef);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [exploded, setExploded] = useState<GlyphDimension | null>(null);
  const [modal, setModal] = useState<SheetModal | null>(null);
  const { act, flow } = s;
  const tight = stage.h > 0 && stage.h < 700;
  const L = useMemo(() => dialLayout(stage.w, stage.h), [stage.w, stage.h]);
  useEffect(() => { setLayer(null); setModal(null); setExploded(null); }, [s.sessionId]);

  const hubBox = useMemo<Rect>(() => (L ? { x: L.c.x - L.hub.w / 2, y: L.c.y - L.hub.h / 2, w: L.hub.w, h: L.hub.h } : { x: 0, y: 0, w: stage.w, h: stage.h }), [L, stage.w, stage.h]);
  const centreRect = useCallback((): Rect => hubBox, [hubBox]);
  const frameRect = useCallback((dim: GlyphDimension | null): Rect => {
    if (!dim || !L) return hubBox;
    const p = sectorPoint(L.c, L.R, dim);
    return { x: p.x - 20, y: p.y - 20, w: 40, h: 40 };
  }, [L, hubBox]);
  const clientRect = (el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect();
    const o = stageRef.current?.getBoundingClientRect();
    return { x: r.left - (o?.left ?? 0), y: r.top - (o?.top ?? 0), w: r.width, h: r.height };
  };

  const { stage: flowStage, pullBack, open: openQuestion } = flow;
  const explode = useCallback((dim: GlyphDimension) => {
    if (flowStage === "asking") pullBack();
    setLayer(null);
    setExploded(dim);
  }, [flowStage, pullBack]);
  const openRefine = useCallback((prefill: string | null) => setLayer({ kind: "refine", prefill, from: centreRect() }), [centreRect]);
  const coreRef = useRef(s.core);
  coreRef.current = s.core;
  const closeLayer = useCallback(() => {
    if (layer?.kind === "core") recordPersonaCoreClose(coreRef.current);
    setLayer(null);
    setExploded(null);
  }, [layer]);
  const dropLayer = useCallback(() => setLayer(null), []);

  const questionOpen = act === "questions" && flow.stage === "asking" && !layer && !exploded;
  const shot = useCamera(layerShot(layer, s, questionOpen, frameRect), reduce);
  const pushed = shot !== null;
  const explodeShot = exploded && L ? { key: `x-${exploded}`, x: L.c.x, y: L.c.y } : null;
  const sleep = useSheetSleep(shot ?? explodeShot, (reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE).duration * 1000);
  const scene = CINEMA.scene[act === "questions" && (flow.stage === "review" || flow.stage === "sending") ? "review" : act];

  // Cinema's beat into the first question, held while a template is offered or a sector is out.
  const hold = !!props.templateSuggestionShowing || !!exploded;
  useEffect(() => {
    if (act !== "questions" || flowStage !== "intro" || layer || hold) return;
    const h = window.setTimeout(() => openQuestion(0), 2600);
    return () => window.clearTimeout(h);
  }, [act, flowStage, openQuestion, layer, hold]);

  useSheetKeys({ act, flow, layer: layer ?? exploded, confirm: modal, closeLayer });

  // -- the drawing ------------------------------------------------------------
  const { values, frameValues, frameStates } = s;
  const populated = useMemo(() => populatedDims(values, props.cellStates, props.glyphRows), [values, props.cellStates, props.glyphRows]);
  const inks = useMemo(() => {
    const out = {} as Record<GlyphDimension, Ink>;
    for (const dim of GLYPH_DIMENSIONS) out[dim] = inkOf(frameStates[dim]);
    return out;
  }, [frameStates]);
  const ticks = useMemo(() => rimTicks(values, flow.answeredByDim, props.toolTestResults ?? []), [values, flow.answeredByDim, props.toolTestResults]);
  const sectorText = (dim: GlyphDimension, ink: Ink) => (ink === "done" && frameValues[dim]?.caption) || dimText.label[dim];
  const drawKey = `${s.sessionId ?? "compose"}:dial`;
  const drawing = useDialMarks(drawKey, inks, ticks, sectorText);
  const working = act === "casting" || act === "wiring" || act === "screening" || drawing.count < drawing.total;
  const stamp = act === "premiere" ? COPY.stamp.issued : act === "verdict" && props.testPassed ? COPY.stamp.passed : act === "stopped" ? COPY.stamp.stopped : null;
  const billing = `${values.trigger?.caption ?? CINEMA.frame.runsOnAsk}${values.message?.caption ? ` · ${values.message.caption}` : ""}`;

  const hub = (
    <DialHub
      p={props} s={s} tight={tight} billing={billing} box={hubBox}
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
  );

  return (
    <div className="bp-root flex-1 min-h-0 w-full flex flex-col" data-testid="SchematicDialLayout" style={{ ["--cinema-accent" as string]: s.cast.accent, ["--paper" as string]: "var(--background)" }}>
      <div ref={stageRef} className="bp-grid relative flex-1 min-h-0 min-w-0 overflow-clip" aria-label={COPY.root}>
        <motion.div
          className={`absolute inset-0 ${sleep.frozen ? PAUSED : ""}`}
          style={{ transformOrigin: sleep.origin, willChange: sleep.frozen ? "transform, opacity" : undefined, visibility: sleep.hidden && !exploded ? "hidden" : undefined }}
          initial={false}
          animate={pushed ? (reduce ? SHEET_PUSHED_REDUCED : SHEET_PUSHED) : exploded ? DIMMED : SHEET_REST}
          transition={reduce ? SHEET_MOVE_REDUCED : SHEET_MOVE}
          onAnimationComplete={sleep.onMoveEnd}
          inert={pushed || exploded ? true : undefined}
          aria-hidden={pushed || exploded ? true : undefined}
        >
          {L ? (
            <DialPrint
              frozen={sleep.frozen} stage={stage} layout={L} labels={dimText.label} drawing={drawing}
              populated={populated} values={frameValues} cast={s.cast} accent={s.cast.accent} presence={s.presence}
              orbiting={act === "casting" || act === "questions" || act === "wiring"} working={working}
              sweepKey={drawKey} onOpen={explode} hub={hub}
              furniture={
                <>
                  <DialLegend room={L.legendRoom} />
                  {!s.isCompose && (
                    <DialPlate
                      top={L.plateTop} width={L.colW} stageH={stage.h} name={props.agentName.trim() || CINEMA.yourAgent}
                      serial={s.sessionId ? s.sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() : null}
                      brief={props.intentText.trim()} rimCount={drawing.rimCount} stamp={stamp}
                    />
                  )}
                </>
              }
            />
          ) : hub}
        </motion.div>
        <AnimatePresence>
          {exploded && L && (
            <ExplodedLayer
              key={exploded} dim={exploded} s={s} rows={s.isCompose ? [] : props.glyphRows}
              label={dimText.label[exploded]} desc={dimText.desc[exploded]} scene={scene} layout={L} stage={stage}
              ink={drawing.ink[exploded]} populated={populated[exploded]} drawKey={drawKey} onClose={closeLayer}
            />
          )}
        </AnimatePresence>
        <SheetLayers p={props} s={s} layer={layer} shot={shot} scene={scene} dimText={dimText} close={closeLayer} drop={dropLayer} openRefine={openRefine} />
      </div>

      <FilmRail scene={scene} elapsed={s.clock.elapsed} marks={s.clock.marks} showWindow={act === "casting"} running={s.clock.running} partial={s.clock.partial} />

      {s.isCompose && s.cfg.modals}
      <SheetModals p={props} s={s} modal={modal} close={() => setModal(null)} />
    </div>
  );
}
