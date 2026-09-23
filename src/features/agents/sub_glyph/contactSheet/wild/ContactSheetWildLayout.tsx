/**
 * ContactSheetWildLayout - V3 "Sheet · Wild": the Contact Sheet pushed as far as it goes.
 *
 * The build is a film shoot developed in a darkroom. The brief sits in the centre
 * frame of a 3x3 contact sheet; the eight dimension frames start as unexposed
 * negatives, glow up under the safelight while the engine fills them, and develop
 * into small prints from real data. The camera pushes into a frame for its inner
 * layer (question, settings, detail) and pulls back to the sheet. The bottom rail
 * is a strip of film exposed one real second at a time. Promotion is a premiere.
 *
 * Personas guidelines this variant breaks on purpose, and why each was worth it:
 *  1. Custom palette instead of semantic tokens (bg-*, text-foreground, primary):
 *     a warm darkroom (safelight red, silver paper, film-base orange) in dark, and a
 *     lightbox with grease pencil in light. The metaphor lives or dies on colour;
 *     the app's cool cyan would read as a dashboard, not a darkroom.
 *  2. A scoped <style> block with raw CSS (wildStyles.ts) instead of Tailwind
 *     utilities: crop marks, sprocket holes, SVG film grain and the vignette need
 *     layered backgrounds and pseudo-elements that utilities cannot express.
 *  3. Bespoke typography outside the typo-* scale: Bahnschrift Condensed (a
 *     Windows system font, offline) for slate and poster lettering, Georgia italic
 *     for taglines, mono edge print. Film title cards are typographic objects.
 *     Body text still stays at 14 px or larger.
 *  4. Hand-rolled buttons (WildButton) instead of Button / AsyncButton, keeping
 *     AsyncButton's contract (in-flight guard, real spinner, aria-busy) in this skin.
 *  5. Raw radii and shadows instead of rounded-card / shadow-elevation-*: prints
 *     are 2-3 px paper, not cards; depth comes from light, not elevation steps.
 *  6. Richer motion than the motion tokens allow: invert-and-blur development, a
 *     2.5x camera push, a projector flash and a FLIP of the whole sheet into a
 *     credits strip. Every one fires on a state change and settles; no idle loops.
 *
 * Everything runs on real props. Nothing is staged, faked or auto-submitted.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import { DIM_META, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { BuildSimulatePanel } from "@/features/agents/components/matrix/BuildSimulatePanel";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { usePersonaCore } from "../../personaCore";
import { useComposeConfig } from "../../useComposeConfig";
import { CELL_KEY_TO_DIM } from "../../glyphLayoutHelpers";
import { WILD_CSS } from "./wildStyles";
import { frameModels } from "./frameModel";
import { SheetFrame } from "./SheetFrame";
import { FilmRail } from "./FilmRail";
import { WildCentre } from "./WildCentre";
import { WildLoupe } from "./WildLoupe";
import { deriveAct, useAnswerLedger, useReelClock } from "./useReel";
import { focusKey, useWildFocus } from "./useWildFocus";
import { useWildKeys } from "./useWildKeys";

const SHEET = { cols: "minmax(0,1fr) minmax(0,1.8fr) minmax(0,1fr)", rows: "minmax(0,1fr) minmax(0,2.2fr) minmax(0,1fr)" };
const PREMIERE = { cols: "repeat(8, minmax(0,1fr))", rows: "minmax(0,1fr) 104px" };

export function ContactSheetWildLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, isBuilding, buildPhase, cellStates, pendingQuestions,
    onAnswer, hasDesignResult, glyphRows, onStartTest, onPromote, onPromoteForce, onViewAgent,
    buildError, testPassed, toolTestResults, testSummary, onQuickConfigChange, initialNotificationChannels,
    onLaunchCoreSnapshot,
  } = props;
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const buildDraft = useAgentStore((s) => s.buildDraft);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const pending = useMemo(() => pendingQuestions ?? [], [pendingQuestions]);

  // Compose backbone: the real pickers, the Persona Core codex, the launch augmentation.
  const core = usePersonaCore(buildSessionId);
  const [quick, setQuick] = useState<QuickConfigState | null>(null);
  const handleQuick = useCallback((c: QuickConfigState) => { setQuick(c); onQuickConfigChange?.(c); }, [onQuickConfigChange]);
  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange: handleQuick,
    initialNotificationChannels, resetKey: buildSessionId, coreAugmentation: core.launchAugmentation(),
  });
  const cfgLaunch = cfg.launch;
  const launch = useCallback(() => {
    onLaunchCoreSnapshot?.({ state: core.state, archetype: core.preset });
    cfgLaunch();
  }, [onLaunchCoreSnapshot, core.state, core.preset, cfgLaunch]);

  // Acts, the honest clock, the camera.
  const ledger = useAnswerLedger(buildSessionId);
  const act = deriveAct({ isCompose, isBuilding, buildPhase, hasPending: pending.length > 0, hasDesignResult, buildError, answeredAny: ledger.answered.length > 0 });
  const clock = useReelClock(act, buildSessionId);
  const cam = useWildFocus(act, buildSessionId, pending);
  const [promoting, setPromoting] = useState(false);
  const [refinePrefill, setRefinePrefill] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  useEffect(() => { setPromoting(false); }, [act]);
  useEffect(() => { setRefinePrefill(null); setShowReport(false); setShowSimulate(false); setQuick(null); }, [buildSessionId]);

  const memoryOn = cfg.items.find((i) => i.dim === "memory")?.active ?? false;
  const reviewOn = cfg.items.find((i) => i.dim === "review")?.active ?? false;
  const frames = useMemo(() => frameModels(
    t,
    isCompose ? { quick, memory: memoryOn, review: reviewOn, intent: intentText } : null,
    { cellStates, pending, rows: glyphRows, settled: hasDesignResult },
  ), [t, isCompose, quick, memoryOn, reviewOn, intentText, cellStates, pending, glyphRows, hasDesignResult]);
  const labelOf = useCallback((d: (typeof GLYPH_DIMENSIONS)[number]) => String(t.templates.chronology[DIM_META[d].labelKey]), [t]);

  // One answer per question, however fast the keys go.
  const answer = useCallback((cellKey: string, question: string, a: string): boolean => {
    const id = `${cellKey}::${question}`;
    if (ledger.has(id) || !pending.some((q) => q.cellKey === cellKey)) return false;
    ledger.mark(id);
    onAnswer(cellKey, a);
    cam.open(null);
    return true;
  }, [ledger, pending, onAnswer, cam]);

  const promote = useCallback(() => {
    if (promoting || testPassed !== true) return;
    setPromoting(true);
    onPromote();
  }, [promoting, testPassed, onPromote]);
  const promoteForce = useCallback(() => { setPromoting(true); onPromoteForce?.(); }, [onPromoteForce]);

  const enter = act === "draft" ? () => void onStartTest()
    : act === "verdict" && testPassed === true ? promote
      : act === "premiere" ? onViewAgent
        : act === "questions" && !cam.focus ? cam.resume
          : null;
  const openFrame = useCallback((d: (typeof GLYPH_DIMENSIONS)[number]) => cam.open({ kind: "dim", dim: d }), [cam]);
  useWildKeys({ layerOpen: cam.focus !== null, onEscape: cam.close, onFrame: openFrame, onEnter: enter });

  const premiere = act === "premiere";
  const grid = premiere ? PREMIERE : SHEET;
  const pushed = cam.focus !== null && !reduce;
  const pendingLabels = pending.map((q) => { const d = CELL_KEY_TO_DIM[q.cellKey]; return d ? labelOf(d) : q.cellKey; });

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col pb-2" data-testid="ContactSheetWildLayout">
      <style>{WILD_CSS}</style>
      <div className="csw flex-1 min-h-0 flex flex-col">
        <div className="relative flex-1 min-h-0">
          <motion.div
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: grid.cols, gridTemplateRows: grid.rows, gap: 12, padding: "14px 16px 6px", transformOrigin: cam.origin }}
            animate={pushed ? { scale: 2.5, opacity: 0.16, filter: "blur(5px)" } : { scale: 1, opacity: cam.focus ? 0.2 : 1, filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: [0.3, 0.7, 0.2, 1] }}
            inert={cam.focus ? true : undefined}
          >
            {GLYPH_DIMENSIONS.map((d, i) => (
              <SheetFrame
                key={d}
                index={i}
                label={labelOf(d)}
                model={frames[d]}
                premiere={premiere}
                dimmed={act === "questions" && frames[d].state !== "pending"}
                onOpen={() => openFrame(d)}
              />
            ))}
            <motion.div layout layoutDependency={premiere} className="csw-centre" data-premiere={premiere ? "true" : "false"} style={{ gridArea: premiere ? "1 / 1 / 2 / 9" : "2 / 2" }}>
              <AnimatePresence mode="wait">
                <WildCentre
                  key={act}
                  act={act}
                  props={props}
                  clock={clock}
                  frames={frames}
                  promoting={promoting}
                  pendingLabels={pendingLabels}
                  core={core}
                  onLaunch={launch}
                  onOpen={cam.open}
                  onResume={cam.resume}
                  onPromote={promote}
                  onPromoteForce={promoteForce}
                  onShowReport={() => setShowReport(true)}
                  onShowSimulate={() => setShowSimulate(true)}
                />
              </AnimatePresence>
            </motion.div>
          </motion.div>
          <AnimatePresence>
            {cam.focus && (
              <WildLoupe
                key={focusKey(cam.focus)}
                focus={cam.focus}
                origin={cam.origin}
                props={props}
                t={t}
                frames={frames}
                labelOf={labelOf}
                composeItems={isCompose ? cfg.items : null}
                question={cam.question}
                answeredCount={ledger.answered.length}
                refinePrefill={refinePrefill}
                onAnswer={answer}
                onClose={cam.close}
                onRefined={() => { setRefinePrefill(null); cam.open(null); }}
                onSplit={(prompt) => { setRefinePrefill(prompt); cam.open({ kind: "refine" }); }}
              />
            )}
          </AnimatePresence>
        </div>
        <FilmRail act={act} spans={clock.spans} total={clock.total} running={clock.running} />
      </div>

      {cfg.modals}
      <BuildSimulatePanel isOpen={showSimulate} onClose={() => setShowSimulate(false)} sessionId={buildSessionId} draft={buildDraft} />
      {showReport && (
        <TestReportModal
          results={toolTestResults ?? []}
          summary={testSummary ?? null}
          onClose={() => setShowReport(false)}
          onCredentialAdded={() => { void useAgentStore.getState().fetchPersonas(); }}
        />
      )}
    </div>
  );
}
