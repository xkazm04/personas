/** GlyphPrototypeLayout — third build view (compose-prototype, 2026-05-05).
 *
 *  A simplified initial-input surface explored as an alternative to
 *  GlyphFullLayout's CommandPanel during compose. Shape:
 *    • Center — single textarea + launch button. No quick-config rows.
 *    • Glyph sigil — petals double as quick-setup affordances during
 *      compose: click Memory/Review to toggle on/off, click Connector
 *      or Event to open a picker modal. Once toggled/selected, the
 *      petal lights up so the build prompt knows the user's
 *      preferences before the first turn even runs.
 *    • Refine phase — questionnaire UI matches GlyphFullLayout exactly
 *      (same GlyphAnswerCard inside the sigil canvas, same SIZE = 640).
 *
 *  Not in this prototype: scheduled trigger picker, message-channel
 *  picker, sample-output picker. The build flow asks for those
 *  via the gate machinery; the prototype only pre-seeds the dims
 *  with the highest "ask vs assume" cost (memory, review, tools,
 *  events).
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Send } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { BuildSimulatePanel } from "@/features/agents/components/matrix/BuildSimulatePanel";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import { CapabilityAddModal } from "@/features/agents/sub_new_persona/capabilityView";
import type { GlyphDimension } from "@/features/shared/glyph";
import type { Frequency, QuickConfigState, EventSubscription } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { describeTriggerConfig, describeSelectedConnectors } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { useHealthyConnectors } from "@/features/agents/shared/quickConfig/useHealthyConnectors";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphRowStrip } from "./GlyphRowStrip";
import { GlyphSigilFace } from "./GlyphSigilFace";
import { GlyphAnswerCard } from "./GlyphAnswerCard";
import { GlyphDimensionSummaryCard } from "./GlyphDimensionSummaryCard";
import { useGlyphLayoutState } from "./useGlyphLayoutState";
import { ComposerEventPickerModal } from "./commandPanel/composer/ComposerEventPickerModal";
import { ComposerConnectorsPickerModal } from "./commandPanel/composer/ComposerConnectorsPickerModal";
import { ComposerSchedulePickerModal } from "./commandPanel/composer/ComposerSchedulePickerModal";
import { ComposerMessagingPickerModal } from "./commandPanel/composer/ComposerMessagingPickerModal";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";
import { debtText } from '@/i18n/DebtText';


const BUILT_IN_INBOX: ChannelSpecV2 = {
  type: "built-in",
  enabled: true,
  credential_id: null,
  use_case_ids: "*",
  event_filter: null,
  config: null,
};

const SIZE = 640;

export function GlyphPrototypeLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, completeness, cellStates,
    pendingQuestions, onAnswer, agentName, onAgentNameChange,
    hasDesignResult, glyphRows,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    buildError, testOutputLines, testPassed, testError, toolTestResults, testSummary, cliOutputLines,
    onQuickConfigChange, initialNotificationChannels,
  } = props;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const buildDraft = useAgentStore((s) => s.buildDraft);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const isRefining = isBuilding && hasPending;
  const isBuildingOnly = isBuilding && !hasPending;

  // Compose-phase quick-config — flowed up to the parent's
  // QuickConfigState so the build prompt picks up the user's
  // pre-launch preferences. Memory + approval are simple booleans
  // local to this prototype (the canonical QuickConfigState doesn't
  // model them yet — we serialise into the textarea via parent's
  // serializeQuickConfig path).
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<EventSubscription[]>([]);
  // Schedule state — mirrors CommandPanelComposer's defaults so the
  // ComposerSchedulePickerModal opens with the same starting point.
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>(["mon"]);
  const [monthDay, setMonthDay] = useState(1);
  // What sigil controls the prompt input visibility. Default ON so the
  // first thing the user sees IS the input affordance — toggling other
  // sigils to set preferences without typing is also valid.
  const [showInput, setShowInput] = useState(true);

  const [eventsModalOpen, setEventsModalOpen] = useState(false);
  const [connectorsModalOpen, setConnectorsModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  // Slice 4 — messaging picker state. Hydrate from the parent-supplied
  // snapshot when the build flow resumes for an existing persona;
  // otherwise default to just the built-in inbox.
  const [messagingModalOpen, setMessagingModalOpen] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<ChannelSpecV2[]>(
    () => {
      if (!initialNotificationChannels || initialNotificationChannels.length === 0) {
        return [BUILT_IN_INBOX];
      }
      const hasBuiltIn = initialNotificationChannels.some(
        (s) => s.type === "built-in",
      );
      return hasBuiltIn
        ? initialNotificationChannels
        : [BUILT_IN_INBOX, ...initialNotificationChannels];
    },
  );
  // Post-launch state — mirrors GlyphFullLayout so the prototype's
  // refine / build / test surfaces have full feature parity with the
  // flagship view.
  const [refining, setRefining] = useState(false);
  const [refinePrefill, setRefinePrefill] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const requestSplit = useCallback((_title: string, prompt: string) => {
    setRefinePrefill(prompt);
    setRefining(true);
  }, []);

  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);

  const activeRow = glyphRows[activeRowIndex] ?? null;

  // During compose, override empty cellStates with "resolved" for the
  // dims the user has set via glyph clicks so those petals light up
  // (Phase 4d activation). useGlyphLayoutState reads cellStates +
  // pendingQuestions to derive petalStates, so feeding it a synthetic
  // map is the cleanest hook. Outside compose we pass the real states
  // unchanged so the refine/build/test phases behave identically to
  // GlyphFullLayout.
  const composeCellStates = useMemo(() => {
    if (!isCompose) return cellStates;
    const next: Record<string, CellBuildStatus> = { ...cellStates };
    if (memoryEnabled) next["memory"] = "resolved";
    if (reviewEnabled) next["human-review"] = "resolved";
    if (selectedConnectors.length > 0) next["connectors"] = "resolved";
    if (selectedEvents.length > 0) {
      next["events"] = "resolved";
      next["triggers"] = "resolved";
    }
    // Schedule frequency lights up the Trigger sigil. Either an event
    // subscription or a schedule satisfies the trigger gate.
    if (frequency) next["triggers"] = "resolved";
    // The What sigil reflects whether the prompt input is currently
    // shown — it's the only sigil that's "on" by default.
    if (showInput) next["use-cases"] = "resolved";
    return next;
  }, [isCompose, cellStates, memoryEnabled, reviewEnabled, selectedConnectors, selectedEvents, frequency, showInput]);

  const { petalStates, activeQuestion, activeDimSummary: defaultSummary } = useGlyphLayoutState({
    pendingQuestions, cellStates: composeCellStates, activeRow, activeDim, setActiveDim,
  });
  const healthyConnectors = useHealthyConnectors();

  // Compose-time summary content for the dimension-summary popup. The
  // default summary derived from `activeRow` is empty during compose
  // because no capability rows exist yet; the user's pre-build sigil
  // toggles need a way to surface as the popup content. During
  // post-compose phases we fall through to the canonical summary so the
  // glyph reflects whatever the build actually produced.
  const composeSummaryFor = useCallback((dim: GlyphDimension): string[] => {
    switch (dim) {
      case "trigger":
        if (frequency) {
          return describeTriggerConfig({
            frequency, days, monthDay, time,
            selectedConnectors: [], connectorTables: {}, selectedEvents: [],
            notificationChannels: [],
          });
        }
        return ["Manual run — no schedule set"];
      case "task":
        return showInput
          ? [intentText.trim() || "Describe what this agent should do"]
          : ["Input hidden — click What to show"];
      case "memory":
        return memoryEnabled
          ? ["Remember user preferences and corrections between runs"]
          : ["Memory off — each run is independent"];
      case "review":
        return reviewEnabled
          ? ["Always wait for your approval before publishing output"]
          : ["Auto-publish — no human review required"];
      case "connector":
        return selectedConnectors.length > 0
          ? describeSelectedConnectors({
              frequency: null, days: ["mon"], monthDay: 1, time: "09:00",
              selectedConnectors, connectorTables: {}, selectedEvents: [],
              notificationChannels: [],
            }, healthyConnectors)
          : ["No tools selected"];
      case "event":
        return selectedEvents.length > 0
          ? selectedEvents.map((e) => `${e.description} (from ${e.personaName})`)
          : ["No event subscriptions"];
      default:
        return [];
    }
  }, [frequency, days, monthDay, time, showInput, intentText, memoryEnabled,
      reviewEnabled, selectedConnectors, healthyConnectors, selectedEvents]);

  const activeDimSummary = useMemo(() => {
    if (!activeDim) return [] as string[];
    if (isCompose) return composeSummaryFor(activeDim);
    return defaultSummary;
  }, [activeDim, isCompose, composeSummaryFor, defaultSummary]);

  // True when at least one sigil carries user-set state. Drives the
  // "Click to begin" CTA — when nothing's active, the user has no clear
  // next step, so we surface a backup affordance that opens the When
  // (schedule) modal.
  const anySigilActive = useMemo(() => (
    showInput || frequency != null || memoryEnabled || reviewEnabled ||
    selectedConnectors.length > 0 || selectedEvents.length > 0
  ), [showInput, frequency, memoryEnabled, reviewEnabled, selectedConnectors, selectedEvents]);

  // Reset local state when session changes — same isolation guard as
  // GlyphFullLayout (Phase 1B).
  useEffect(() => {
    setActiveDim(null);
    setHoveredDim(null);
    setActiveRowIndex(0);
    setHoveredRowIndex(null);
    setMemoryEnabled(false);
    setReviewEnabled(false);
    setSelectedConnectors([]);
    setSelectedEvents([]);
    setFrequency(null);
    setTime("09:00");
    setDays(["mon"]);
    setMonthDay(1);
    setShowInput(true);
    setEventsModalOpen(false);
    setConnectorsModalOpen(false);
    setScheduleModalOpen(false);
    setRefining(false);
    setRefinePrefill(null);
    setShowAdd(false);
    setShowSimulate(false);
    setShowReport(false);
  }, [buildSessionId]);

  // Mirror local quick-config (schedule + connectors + events) into the
  // parent's QuickConfigState so the launch path's serializeQuickConfig
  // appends them to the user's intent. Memory + approval are flagged
  // separately via the augmented intent (see useEffect below).
  useEffect(() => {
    if (!onQuickConfigChange) return;
    const next: QuickConfigState = {
      frequency,
      days,
      monthDay,
      time,
      selectedConnectors,
      connectorTables: {},
      selectedEvents,
      // Slice 4 — propagate the messaging picker's selection so the
      // launch path persists it onto the persona row alongside what
      // CommandPanelComposer would have produced.
      notificationChannels: selectedChannels,
    };
    onQuickConfigChange(next);
  }, [frequency, days, monthDay, time, selectedConnectors, selectedEvents, selectedChannels, onQuickConfigChange]);

  const closeActiveDim = () => setActiveDim(null);
  const onClickDim = (d: GlyphDimension) => {
    // Compose-phase glyph quick-setup:
    //   • trigger (When)  → schedule picker modal
    //   • task    (What)  → toggle the prompt input visibility
    //   • connector (Apps) → connector picker modal
    //   • event   (Events) → event picker modal
    //   • memory          → toggle on/off
    //   • review          → toggle on/off
    //   • message / error → fall through to the summary popup (Phase 2)
    if (isCompose) {
      if (d === "trigger") {
        setScheduleModalOpen(true);
        return;
      }
      if (d === "task") {
        setShowInput((v) => !v);
        return;
      }
      if (d === "memory") {
        setMemoryEnabled((v) => !v);
        return;
      }
      if (d === "review") {
        setReviewEnabled((v) => !v);
        return;
      }
      if (d === "connector") {
        setConnectorsModalOpen(true);
        return;
      }
      if (d === "event") {
        setEventsModalOpen(true);
        return;
      }
      if (d === "message") {
        setMessagingModalOpen(true);
        return;
      }
    }
    setActiveDim((prev) => (prev === d ? null : d));
  };

  // 2026-05-05 — augment the intent with memory/review preferences just
  // before launch. The build prompt's intent_implies_memory / _review
  // heuristics open those gates if the intent contains the right
  // keywords, so a user who toggled Memory ON in the sigil never sees
  // the "should this remember things?" question. Schedule + connectors
  // + events flow via QuickConfigState (see useEffect above) and are
  // appended by the parent's serializeQuickConfig in handleLaunchGlyph.
  const launch = useCallback(() => {
    const lines: string[] = [];
    lines.push(memoryEnabled
      ? "Memory: yes — remember user preferences and corrections between runs"
      : "Memory: no — each run is independent, no memory needed");
    lines.push(reviewEnabled
      ? "Review: always wait for my approval before publishing output"
      : "Review: never — automatically publish without asking");
    const augmented = lines.length > 0
      ? `${intentText}\n---\n${lines.join("\n")}`
      : intentText;
    onIntentChange(augmented);
    onLaunch();
  }, [memoryEnabled, reviewEnabled, intentText, onIntentChange, onLaunch]);

  // Enter submits, Shift+Enter inserts newline.
  const handleLaunchKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled) launch();
    }
  }, [launchDisabled, launch]);

  const completenessPct = Math.round(completeness);

  const overlay = activeDim && activeQuestion
    ? <GlyphAnswerCard question={activeQuestion} onAnswer={onAnswer} onClose={closeActiveDim} />
    : null;
  const topCenterSummary = activeDim && !activeQuestion ? activeDim : null;

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1 relative" data-testid="build-layout-prototype">
      {/* Top-center summary popup — same as GlyphFullLayout (Phase 2). */}
      <AnimatePresence>
        {topCenterSummary && (
          <motion.div
            key={`top-summary-${topCenterSummary}`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute left-1/2 -translate-x-1/2 top-3 z-30 w-[min(440px,90vw)]"
          >
            <GlyphDimensionSummaryCard
              activeDim={topCenterSummary}
              summary={activeDimSummary}
              isPreBuild={isCompose}
              onClose={closeActiveDim}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col items-center pb-14 pt-4">
        <div
          className="sm:min-w-[640px] md:min-w-[800px] lg:min-w-[920px] w-full max-w-[1400px] flex flex-col items-center gap-3 rounded-modal"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), " +
              "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        >
          <GlyphTopBar
            agentName={agentName}
            onAgentNameChange={onAgentNameChange}
            isPreBuild={isCompose}
            isBuilding={isBuilding}
            buildPhase={buildPhase}
            face="glyph"
            onFaceChange={() => {}}
            editLocked={hasPending}
          />

          {/* Active capability title band — mirrors GlyphFullLayout so
              the refine/build/test surfaces feel like one product. Only
              renders post-compose when capability rows exist. */}
          {!isCompose && glyphRows.length > 0 && (
            <div className="min-h-[1.75rem] flex items-center justify-center">
              <span
                className="typo-heading-sm font-semibold text-center text-foreground"
                key={
                  hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex
                    ? `${glyphRows[hoveredRowIndex]?.id}-preview`
                    : `${glyphRows[activeRowIndex]?.id}-active`
                }
              >
                {(hoveredRowIndex !== null && hoveredRowIndex !== activeRowIndex
                  ? glyphRows[hoveredRowIndex]?.title
                  : glyphRows[activeRowIndex]?.title) ?? ""}
              </span>
            </div>
          )}

          {/* Sigil canvas. Vertical capability strip on the left during
              refine/build (matches Glyph Full); none in compose. */}
          <div className="flex items-start gap-4">
            {!isCompose && glyphRows.length > 0 && (
              <div className="pt-6 shrink-0">
                <GlyphRowStrip
                  rows={glyphRows}
                  activeIndex={activeRowIndex}
                  hoveredIndex={hoveredRowIndex}
                  onSelect={setActiveRowIndex}
                  onHover={setHoveredRowIndex}
                  onAdd={() => setShowAdd(true)}
                  canAdd={!isBuilding}
                  vertical
                />
              </div>
            )}
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            <GlyphSigilFace
              size={SIZE}
              petalStates={petalStates}
              hoveredDim={hoveredDim}
              activeDim={activeDim}
              onHoverDim={setHoveredDim}
              onClickDim={onClickDim}
              isCompose={isCompose}
              isBuilding={isBuilding}
              isBuildingOnly={isBuildingOnly}
              isRefining={isRefining}
              buildPhase={buildPhase}
              hasDesignResult={hasDesignResult}
              cellStates={composeCellStates}
              pendingQuestions={pendingQuestions}
              cliOutputLines={cliOutputLines}
              refining={refining}
              setRefining={setRefining}
              completenessPct={completenessPct}
              testOutputLines={testOutputLines}
              testPassed={testPassed}
              testError={testError}
              onStartTest={onStartTest}
              onPromote={onPromote}
              onPromoteForce={onPromoteForce}
              onRejectTest={onRejectTest}
              onRefine={onRefine}
              onViewAgent={onViewAgent}
              onShowSimulate={() => setShowSimulate(true)}
              buildSessionId={buildSessionId}
              overlay={overlay}
              onComposeStart={isCompose && !anySigilActive ? () => setScheduleModalOpen(true) : undefined}
              onShowReport={() => setShowReport(true)}
              onRequestSplit={requestSplit}
              refinePrefill={refinePrefill}
              onClearRefinePrefill={() => setRefinePrefill(null)}
            />
            {isCompose && !overlay && showInput && (
              <div
                className="absolute left-1/2 -translate-x-1/2 z-20"
                style={{ top: SIZE * 0.36, width: SIZE * 0.62 }}
              >
                <div
                  className="rounded-modal bg-card-bg/85 backdrop-blur-md border border-card-border p-3 flex flex-col gap-2 shadow-elevation-2"
                  style={{ boxShadow: "0 0 22px rgba(96,165,250,0.22), 0 4px 18px rgba(0,0,0,0.35)" }}
                >
                  <textarea
                    value={intentText}
                    onChange={(e) => onIntentChange(e.target.value)}
                    onKeyDown={handleLaunchKey}
                    placeholder={debtText("auto_describe_what_you_want_this_agent_to_do_ae7c256d")}
                    rows={3}
                    className="w-full px-3 py-2 rounded-card bg-secondary/30 border border-border/30 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none resize-none"
                    data-testid="agent-intent-input"
                  />
                  <button
                    type="button"
                    onClick={launch}
                    disabled={launchDisabled}
                    className="self-end inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-primary/40 bg-primary/15 text-foreground hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer typo-body transition-colors"
                    data-testid="agent-launch-btn"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Launch
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>

          {buildError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 max-w-xl">
              <AlertCircle className="w-4 h-4" />
              <span>{buildError}</span>
            </div>
          )}
        </div>
      </div>

      <ComposerEventPickerModal
        open={eventsModalOpen}
        onClose={() => setEventsModalOpen(false)}
        selected={selectedEvents}
        onApply={(next) => {
          setSelectedEvents(next);
          setEventsModalOpen(false);
        }}
      />
      <ComposerConnectorsPickerModal
        open={connectorsModalOpen}
        onClose={() => setConnectorsModalOpen(false)}
        selected={selectedConnectors}
        onApply={(next) => {
          setSelectedConnectors(next);
          setConnectorsModalOpen(false);
        }}
      />
      <ComposerSchedulePickerModal
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        frequency={frequency}
        days={days}
        monthDay={monthDay}
        time={time}
        onApply={(next) => {
          setFrequency(next.frequency);
          setDays(next.days);
          setMonthDay(next.monthDay);
          setTime(next.time);
          setScheduleModalOpen(false);
        }}
      />
      <ComposerMessagingPickerModal
        open={messagingModalOpen}
        onClose={() => setMessagingModalOpen(false)}
        selected={selectedChannels}
        onApply={(next) => {
          // Always preserve the built-in inbox row regardless of picker output.
          const hasBuiltIn = next.some((s) => s.type === "built-in");
          setSelectedChannels(hasBuiltIn ? next : [BUILT_IN_INBOX, ...next]);
          setMessagingModalOpen(false);
        }}
      />

      <CapabilityAddModal open={showAdd} onClose={() => setShowAdd(false)} />
      <BuildSimulatePanel
        isOpen={showSimulate}
        onClose={() => setShowSimulate(false)}
        sessionId={buildSessionId}
        draft={buildDraft}
      />
      {showReport && (
        <TestReportModal
          results={toolTestResults ?? []}
          summary={testSummary ?? null}
          onClose={() => setShowReport(false)}
          onCredentialAdded={() => {
            void useAgentStore.getState().fetchPersonas();
          }}
        />
      )}
    </div>
  );
}
