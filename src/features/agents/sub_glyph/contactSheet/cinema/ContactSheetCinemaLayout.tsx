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
 *     slide down into a credits strip. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LayoutGroup, motion } from "framer-motion";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { useGlyphDimText } from "@/features/shared/glyph/persona-sigil";
import { ConfirmDialog } from "@/features/shared/components/feedback/ConfirmDialog";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import { useAgentStore } from "@/stores/agentStore";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { CELL_KEY_TO_DIM } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import { useSheetState } from "./useSheetState";
import { SheetFrame } from "./SheetFrame";
import { SheetSigil } from "./SheetSigil";
import { SheetCentre } from "./SheetCentre";
import { SheetLayers, type Layer } from "./SheetLayers";
import { FilmRail } from "./FilmRail";
import type { Rect } from "./PushLayer";
import { useSheetKeys } from "./useSheetKeys";
import { FRAME_CELL } from "./sheetModel";
import { EASE } from "./cinemaMotion";
import { COPY } from "./copy";

const GAP = 12;
const STRIP_H = 92;

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
  const dimText = useGlyphDimText();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const centreRef = useRef<HTMLDivElement | null>(null);
  const frameEls = useRef<Partial<Record<GlyphDimension, HTMLDivElement | null>>>({});
  const stage = useSize(stageRef);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [confirm, setConfirm] = useState<"force" | "reject" | null>(null);
  const [showReport, setShowReport] = useState(false);
  const { act, flow } = s;
  const premiere = act === "premiere";
  const tight = stage.h > 0 && stage.h < 700;

  useEffect(() => { setLayer(null); setConfirm(null); setShowReport(false); }, [s.sessionId]);

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
  const questionDim = flow.current ? CELL_KEY_TO_DIM[flow.current.cellKey] ?? null : null;
  const pushedFrom: Rect | null = layer ? layer.from : questionOpen ? frameRect(questionDim) : null;
  const sourceDim = layer?.kind === "frame" ? layer.dim : questionOpen ? questionDim : null;

  // Cinema's beat: let the coronation land before the camera pushes into the first question.
  useEffect(() => {
    if (act !== "questions" || flowStage !== "intro" || layer) return;
    const h = window.setTimeout(() => openQuestion(0), 2600);
    return () => window.clearTimeout(h);
  }, [act, flowStage, openQuestion, layer]);

  useSheetKeys({ act, flow, layer, confirm, closeLayer });

  // Sigil geometry: centred on the centre cell, petals reaching into the frames.
  const sigilCy = premiere ? (stage.h - STRIP_H - GAP) / 2 : stage.h / 2;
  const sigilSize = premiere ? Math.min(stage.h - STRIP_H - GAP, stage.w * 0.5) : Math.min(stage.h * 0.98, stage.w * 0.62);
  const values = s.values;
  const billing = `${values.trigger?.caption ?? COPY.frame.runsOnAsk}${values.message?.caption ? ` · ${values.message.caption}` : ""}`;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col" data-testid="ContactSheetCinemaLayout" style={{ ["--cinema-accent" as string]: s.cast.accent }}>
      <div ref={stageRef} className="relative flex-1 min-h-0">
        <SheetSigil size={sigilSize} cx={stage.w / 2} cy={sigilCy} petalStates={s.petalStates} activeDim={sourceDim} accent={s.cast.accent} presence={s.presence} onPetal={openFrame} />
        <motion.div
          className="absolute inset-0 grid"
          style={{
            gap: GAP,
            gridTemplateColumns: premiere ? "repeat(8, minmax(0, 1fr))" : "minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr)",
            gridTemplateRows: premiere ? `minmax(0, 1fr) ${STRIP_H}px` : "minmax(0, 1fr) minmax(0, 2.3fr) minmax(0, 1fr)",
            transformOrigin: pushedFrom ? `${pushedFrom.x + pushedFrom.w / 2}px ${pushedFrom.y + pushedFrom.h / 2}px` : "50% 50%",
          }}
          animate={{ scale: pushedFrom ? 1.035 : 1, filter: pushedFrom ? "blur(1.5px)" : "blur(0px)" }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <LayoutGroup id="sheet-cinema-grid">
            {GLYPH_DIMENSIONS.map((dim, i) => (
              <motion.div
                key={dim}
                layout
                transition={{ duration: 0.9, ease: EASE, delay: premiere ? i * 0.04 : 0 }}
                ref={(el) => { frameEls.current[dim] = el; }}
                className="min-w-0 min-h-0"
                style={premiere ? { gridColumn: i + 1, gridRow: 2 } : { gridColumn: FRAME_CELL[dim][0], gridRow: FRAME_CELL[dim][1] }}
              >
                <SheetFrame
                  dim={dim} label={dimText.label[dim]} state={s.frameStates[dim]} value={s.values[dim]}
                  dimmed={!!pushedFrom && sourceDim !== dim} compact={premiere} onOpen={openFrame}
                />
              </motion.div>
            ))}
            <motion.div
              ref={centreRef}
              layout
              transition={{ duration: 0.9, ease: EASE }}
              className="min-w-0 min-h-0 flex items-center justify-center px-2"
              style={{ gridArea: premiere ? "1 / 1 / 2 / 9" : "2 / 2 / 3 / 3", opacity: pushedFrom ? 0.12 : 1, transition: "opacity 0.4s ease" }}
            >
              <SheetCentre
                p={props} s={s} tight={tight} billing={billing}
                a={{
                  openContext: (el) => setLayer({ kind: "context", from: clientRect(el) }),
                  openRefine: () => openRefine(null),
                  openCaps: () => setLayer({ kind: "caps", from: centreRect() }),
                  openReport: () => setShowReport(true),
                  askForce: () => setConfirm("force"),
                  askReject: () => setConfirm("reject"),
                  startOver: () => useAgentStore.getState().resetBuildSession(),
                }}
              />
            </motion.div>
          </LayoutGroup>
        </motion.div>
        {stage.w > 0 && (
          <SheetLayers p={props} s={s} layer={layer} questionOpen={questionOpen} stage={stage} dimText={dimText} frameRect={frameRect} close={closeLayer} openRefine={openRefine} />
        )}
      </div>

      <FilmRail scene={COPY.scene[act === "questions" && (flow.stage === "review" || flow.stage === "sending") ? "review" : act]} elapsed={s.clock.elapsed} marks={s.clock.marks} showWindow={act === "casting"} />

      {s.isCompose && s.cfg.modals}
      {confirm && (
        <ConfirmDialog
          danger
          title={confirm === "force" ? COPY.promoteAnywayTitle : COPY.rejectTitle}
          body={confirm === "force" ? COPY.promoteAnywayBody : COPY.rejectBody}
          confirmLabel={confirm === "force" ? COPY.promoteAnyway.replace("...", "") : COPY.reject}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); if (confirm === "force") props.onPromoteForce?.(); else props.onRejectTest?.(); }}
        />
      )}
      {showReport && (
        <TestReportModal
          results={props.toolTestResults ?? []}
          summary={props.testSummary ?? null}
          onClose={() => setShowReport(false)}
          onCredentialAdded={() => { void useAgentStore.getState().fetchPersonas(); }}
        />
      )}
    </div>
  );
}
