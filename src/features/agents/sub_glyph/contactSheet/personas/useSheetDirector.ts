/** useSheetDirector - turns the real build props into the sheet's story:
 *  which act is playing, what each frame shows, whose time the clock is
 *  counting, and the compose-time plumbing (quick config, persona core). */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import { usePersonaCore } from "../../personaCore";
import { useComposeConfig } from "../../useComposeConfig";
import { CELL_KEY_TO_DIM } from "../../glyphLayoutHelpers";
import type { GlyphFullLayoutProps } from "../../glyphLayoutTypes";
import { deriveFrames, fromQuickConfig, SHEET_ORDER, type FrameValue } from "./sheetModel";
import { useBuildClock, type ClockKind } from "./useBuildClock";
import { useQuestionRound } from "./useQuestionRound";

export type Act =
  | "compose" | "exposure" | "questions" | "wiring" | "waiting"
  | "draft" | "testing" | "verdict" | "promoted" | "failed";

type ComposeValues = Partial<Record<GlyphDimension, FrameValue>>;

export function useSheetDirector(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, isBuilding, buildPhase, hasDesignResult,
    pendingQuestions, onAnswer, buildError, cellStates, glyphRows,
    onQuickConfigChange, initialNotificationChannels, onLaunchCoreSnapshot,
  } = props;
  const { t } = useTranslation();
  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const isCompose = buildSessionId === null && !hasDesignResult;

  // ── compose plumbing: the same hooks every compose surface uses ──
  const [quickConfig, setQuickConfig] = useState<QuickConfigState | null>(null);
  const handleQuickConfig = useCallback((c: QuickConfigState) => {
    setQuickConfig(c);
    onQuickConfigChange?.(c);
  }, [onQuickConfigChange]);
  const core = usePersonaCore(buildSessionId);
  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange: handleQuickConfig,
    initialNotificationChannels, resetKey: buildSessionId,
    coreAugmentation: core.launchAugmentation(),
  });

  const toggles = useMemo(() => ({
    memory: cfg.items.some((i) => i.dim === "memory" && i.active),
    review: cfg.items.some((i) => i.dim === "review" && i.active),
  }), [cfg.items]);
  const liveComposeValues = useMemo(() => {
    const out: ComposeValues = {};
    for (const dim of SHEET_ORDER) {
      const v = fromQuickConfig(dim, quickConfig, toggles);
      if (v) out[dim] = v;
    }
    return out;
  }, [quickConfig, toggles]);

  // useComposeConfig resets itself when the session id lands, so the choices
  // made before launch are snapshotted here and keep their frames lit.
  const [launchedValues, setLaunchedValues] = useState<ComposeValues>({});
  const [launching, setLaunching] = useState(false);
  const cfgLaunch = cfg.launch;
  const launch = useCallback(() => {
    setLaunchedValues(liveComposeValues);
    setLaunching(true);
    onLaunchCoreSnapshot?.({ state: core.state, archetype: core.preset });
    cfgLaunch();
  }, [liveComposeValues, onLaunchCoreSnapshot, core.state, core.preset, cfgLaunch]);
  useEffect(() => {
    if (!launching) return;
    if (!isCompose || buildError) { setLaunching(false); return; }
    const id = window.setTimeout(() => setLaunching(false), 8000);
    return () => window.clearTimeout(id);
  }, [launching, isCompose, buildError]);

  // ── the question round ──
  const round = useQuestionRound(pendingQuestions, onAnswer, buildSessionId);
  const [sawQuestions, setSawQuestions] = useState(false);
  useEffect(() => { setSawQuestions(false); }, [buildSessionId]);
  useEffect(() => { if (round.questions.length > 0) setSawQuestions(true); }, [round.questions.length]);

  // ── the act ──
  const act: Act = useMemo(() => {
    if (buildPhase === "promoted") return "promoted";
    if (buildPhase === "test_complete") return "verdict";
    if (buildPhase === "testing") return "testing";
    if (hasDesignResult) return "draft";
    if (isCompose) return "compose";
    if (buildPhase === "failed" || (buildError && !isBuilding)) return "failed";
    if (round.questions.length > 0) return "questions";
    if (isBuilding) return sawQuestions || buildPhase === "resolving" ? "wiring" : "exposure";
    return "waiting";
  }, [buildPhase, hasDesignResult, isCompose, buildError, isBuilding, round.questions.length, sawQuestions]);

  const clockKind: ClockKind | null = isBuilding ? "llm" : act === "questions" ? "you" : act === "testing" ? "test" : null;
  const clock = useBuildClock(clockKind, buildSessionId);

  const pendingDims = useMemo(() => {
    const s = new Set<GlyphDimension>();
    for (const q of round.questions) { const d = CELL_KEY_TO_DIM[q.cellKey]; if (d) s.add(d); }
    return s;
  }, [round.questions]);

  const frames = useMemo(() => deriveFrames({
    compose: act === "compose",
    postDraft: act === "draft" || act === "testing" || act === "verdict" || act === "promoted",
    failed: act === "failed",
    composeValues: act === "compose" ? liveComposeValues : launchedValues,
    cellStates, pendingDims, answered: round.answeredByDim, rows: glyphRows, t,
  }), [act, liveComposeValues, launchedValues, cellStates, pendingDims, round.answeredByDim, glyphRows, t]);

  return { act, isCompose, buildSessionId, cfg, core, launch, launching, round, clock, frames };
}

export type SheetDirector = ReturnType<typeof useSheetDirector>;
