/** useSheetState — every derived fact the Cinema contact sheet renders from,
 *  in one place: which act the build is in, the honest clock, the casting
 *  call, the question round, and each frame's state and value. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { PetalState } from "@/features/shared/glyph/persona-sigil";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { useAgentStore } from "@/stores/agentStore";
import { CELL_KEY_TO_DIM, derivePetalState } from "@/features/agents/sub_glyph/glyphLayoutHelpers";
import { usePersonaCore } from "@/features/agents/sub_glyph/personaCore";
import { useComposeConfig } from "@/features/agents/sub_glyph/useComposeConfig";
import type { GlyphFullLayoutProps } from "@/features/agents/sub_glyph/glyphLayoutTypes";
import { deriveAct, frameStateFromPetal, type FrameState } from "./sheetModel";
import { useSheetClock, type ClockMode } from "./useSheetClock";
import { useCinemaCast } from "./useCinemaCast";
import { useQuestionFlow } from "./useQuestionFlow";
import { useFrameValues } from "./useFrameValues";

const NO_TOGGLES = { memory: false, review: false };

const PETAL_OF: Record<FrameState, PetalState> = {
  lit: "resolved", pending: "pending", filling: "filling", error: "error", blank: "idle", unset: "idle",
};

export function useSheetState(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, isBuilding, buildPhase, cellStates, pendingQuestions, onAnswer,
    hasDesignResult, glyphRows, buildError, onQuickConfigChange, initialNotificationChannels, onLaunchCoreSnapshot,
  } = props;

  const sessionId = useAgentStore((s) => s.buildSessionId);
  const coreRole = useAgentStore((s) => s.buildBehaviorCore?.identity?.role ?? null);
  const coreMission = useAgentStore((s) => s.buildBehaviorCore?.mission ?? null);
  const isCompose = sessionId === null && !hasDesignResult;
  const pendingCount = pendingQuestions?.length ?? 0;

  // -- compose plumbing (shared with the other compose surfaces) -------------
  const core = usePersonaCore(sessionId);
  const [quickConfig, setQuickConfig] = useState<QuickConfigState | null>(null);
  const handleQc = useCallback((c: QuickConfigState) => { setQuickConfig(c); onQuickConfigChange?.(c); }, [onQuickConfigChange]);
  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange: handleQc,
    initialNotificationChannels, resetKey: sessionId, coreAugmentation: core.launchAugmentation(),
  });
  const [launching, setLaunching] = useState(false);
  useEffect(() => { setLaunching(false); }, [sessionId]);
  useEffect(() => {
    if (!launching) return;
    const h = window.setTimeout(() => setLaunching(false), 15000);
    return () => window.clearTimeout(h);
  }, [launching]);
  const cfgLaunch = cfg.launch;
  // The composer's picks reset with the session (useComposeConfig's resetKey), so
  // the frames keep a snapshot of what was launched to show while the build runs.
  const [launched, setLaunched] = useState<{ qc: QuickConfigState | null; toggles: { memory: boolean; review: boolean } } | null>(null);
  const liveToggles = useMemo(() => ({
    memory: cfg.items.find((i) => i.dim === "memory")?.active ?? false,
    review: cfg.items.find((i) => i.dim === "review")?.active ?? false,
  }), [cfg.items]);
  const launch = useCallback(() => {
    onLaunchCoreSnapshot?.({ state: core.state, archetype: core.preset });
    setLaunched({ qc: quickConfig, toggles: liveToggles });
    setLaunching(true);
    cfgLaunch();
  }, [onLaunchCoreSnapshot, core.state, core.preset, cfgLaunch, quickConfig, liveToggles]);

  // -- acts ------------------------------------------------------------------
  const [landed, setLanded] = useState(false);
  useEffect(() => { setLanded(false); }, [sessionId]);
  useEffect(() => { if (pendingCount > 0 || hasDesignResult) setLanded(true); }, [pendingCount, hasDesignResult]);
  const act = deriveAct({ isCompose, isBuilding, buildPhase, pendingCount, hasDesignResult, buildError, firstPassLanded: landed });

  const flow = useQuestionFlow(pendingQuestions, onAnswer);
  const clockMode: ClockMode =
    (act === "casting" && isBuilding) || act === "wiring" ? "build"
    : act === "questions" ? (flow.stage === "sending" ? "build" : "you")
    : act === "screening" ? "test" : null;
  const clock = useSheetClock(sessionId, clockMode);

  const crown = !isCompose && (!!(coreRole || coreMission) || landed || hasDesignResult);
  const cast = useCinemaCast(sessionId, crown, act === "casting");

  // -- frames ----------------------------------------------------------------
  const values = useFrameValues({
    glyphRows,
    quickConfig: isCompose ? quickConfig : launched?.qc ?? null,
    toggles: isCompose ? liveToggles : launched?.toggles ?? NO_TOGGLES,
    intentText, answered: flow.answeredByDim, isCompose,
  });

  const frameStates = useMemo(() => {
    const pendingDims = new Set<GlyphDimension>();
    for (const q of pendingQuestions ?? []) { const d = CELL_KEY_TO_DIM[q.cellKey]; if (d) pendingDims.add(d); }
    const settled = act === "draft" || act === "verdict" || act === "screening" || act === "premiere";
    const out = {} as Record<GlyphDimension, FrameState>;
    for (const dim of GLYPH_DIMENSIONS) {
      let st: FrameState;
      if (isCompose) st = values[dim] ? "lit" : "blank";
      else {
        st = frameStateFromPetal(derivePetalState(dim, cellStates, pendingDims, null), settled);
        if (flow.answeredByDim[dim]) st = "lit";
        else if ((st === "blank" || st === "unset") && values[dim]) st = "lit";
        if (act === "stopped" && st === "filling") st = "blank";
        if (act === "premiere" && st !== "lit") st = "unset";
      }
      out[dim] = st;
    }
    return out;
  }, [pendingQuestions, act, isCompose, values, cellStates, flow.answeredByDim]);

  const petalStates = useMemo(() => {
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) out[dim] = PETAL_OF[frameStates[dim]];
    return out;
  }, [frameStates]);
  const litCount = GLYPH_DIMENSIONS.filter((d) => frameStates[d] === "lit").length;

  return {
    sessionId, isCompose, act, core, cfg, launch, launching, flow, clock, cast,
    values, frameStates, petalStates, presence: crown ? 0.4 + (litCount / 8) * 0.6 : litCount / 16,
  };
}

export type SheetState = ReturnType<typeof useSheetState>;
