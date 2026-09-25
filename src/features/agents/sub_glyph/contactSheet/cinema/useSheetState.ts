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
import { deriveAct, deriveFrameState, frameStateFromPetal, populatedDims, type FrameState } from "./sheetModel";
import { useSheetClock } from "./useSheetClock";
import { useCinemaCast } from "./useCinemaCast";
import { useQuestionFlow } from "./useQuestionFlow";
import { useFrameValues } from "./useFrameValues";
import { useCinemaRecipes } from "./useCinemaRecipes";
import { provisionalDims, provisionalFrameValues } from "./provisionalFrames";
import type { FrameValue } from "./useFrameValues";
import { useTranslation } from "@/i18n/useTranslation";

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
  // First-turn streaming preview: develops frames, never lights them.
  const provisional = useAgentStore((s) => s.buildProvisional);
  const { t } = useTranslation();
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
  const recipes = useCinemaRecipes(intentText, onIntentChange, isCompose);

  // -- acts ------------------------------------------------------------------
  const [landed, setLanded] = useState(false);
  useEffect(() => { setLanded(false); }, [sessionId]);
  useEffect(() => { if (pendingCount > 0 || hasDesignResult) setLanded(true); }, [pendingCount, hasDesignResult]);
  const act = deriveAct({ isCompose, isBuilding, buildPhase, pendingCount, hasDesignResult, buildError, firstPassLanded: landed });

  const flow = useQuestionFlow(pendingQuestions, onAnswer);
  // The clock follows the store's phase, not the act: it runs only while the
  // machine works and survives remounts (see centre/buildClock.ts).
  const clock = useSheetClock(sessionId);

  const crown = !isCompose && (!!(coreRole || coreMission) || landed || hasDesignResult);
  const cast = useCinemaCast(sessionId, crown, act === "casting");

  // -- frames ----------------------------------------------------------------
  const values = useFrameValues({
    glyphRows,
    quickConfig: isCompose ? quickConfig : launched?.qc ?? null,
    toggles: isCompose ? liveToggles : launched?.toggles ?? NO_TOGGLES,
    intentText, answered: flow.answeredByDim, isCompose,
  });

  const preview = useMemo(
    () => ({ dims: provisionalDims(provisional), values: provisionalFrameValues(provisional, t) }),
    [provisional, t],
  );

  const frameStates = useMemo(() => {
    const pendingDims = new Set<GlyphDimension>();
    for (const q of pendingQuestions ?? []) { const d = CELL_KEY_TO_DIM[q.cellKey]; if (d) pendingDims.add(d); }
    const settled = act === "draft" || act === "verdict" || act === "screening" || act === "premiere";
    const out = {} as Record<GlyphDimension, FrameState>;
    for (const dim of GLYPH_DIMENSIONS) {
      out[dim] = deriveFrameState({
        isCompose, act,
        fromBuild: isCompose ? "blank" : frameStateFromPetal(derivePetalState(dim, cellStates, pendingDims, null), settled),
        answered: !!flow.answeredByDim[dim],
        hasValue: !!values[dim],
        previewing: preview.dims.has(dim),
      });
    }
    return out;
  }, [pendingQuestions, act, isCompose, values, cellStates, flow.answeredByDim, preview]);

  // What each frame SHOWS: confirmed values, plus the preview's picture on a
  // frame that is only developing. `values` stays confirmed-only, because it
  // is what populatedDims counts (full colour is never earned by a preview).
  const frameValues = useMemo(() => {
    const out = {} as Record<GlyphDimension, FrameValue | null>;
    for (const dim of GLYPH_DIMENSIONS) {
      out[dim] = values[dim] ?? (frameStates[dim] === "filling" ? preview.values[dim] : null);
    }
    return out;
  }, [values, frameStates, preview]);

  const petalStates = useMemo(() => {
    const out = {} as Record<GlyphDimension, PetalState>;
    for (const dim of GLYPH_DIMENSIONS) out[dim] = PETAL_OF[frameStates[dim]];
    return out;
  }, [frameStates]);
  // Only populated dimensions feed the core glow (same rule as the frames and petals).
  const populated = populatedDims(values, cellStates, glyphRows);
  const litCount = GLYPH_DIMENSIONS.filter((d) => populated[d]).length;

  return {
    sessionId, isCompose, act, core, cfg, launch, launching, recipes, flow, clock, cast,
    values, frameValues, frameStates, petalStates, presence: crown ? 0.4 + (litCount / 8) * 0.6 : litCount / 16,
  };
}

export type SheetState = ReturnType<typeof useSheetState>;
