/** SheetCentre - the middle cell, one scene per act. The act changes are the
 *  cuts of the film: each scene fades up from below when it takes over. */
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import type { GlyphFullLayoutProps } from "../../glyphLayoutTypes";
import type { SheetDirector } from "./useSheetDirector";
import { ComposeCentre } from "./ComposeCentre";
import { FailedCentre, QuestionsCentre, SlateCentre } from "./BuildCentres";
import { DraftCentre, PromotedCentre, TestingCentre, VerdictCentre } from "./DraftCentres";
import type { PrintItem, PrintStatus } from "./PrintStrip";
import { COPY } from "./copy";

interface SheetCentreProps {
  props: GlyphFullLayoutProps;
  director: SheetDirector;
  onOpenContext: () => void;
  onAsk: (index: number) => void;
  onRefine: () => void;
  onShowLog: () => void;
  onShowReport: () => void;
  onPromoteAnyway?: () => void;
}

const TOOL_STATUS: Record<string, PrintStatus> = {
  passed: "passed", failed: "failed", credential_missing: "failed", skipped: "skipped", unverified: "skipped",
};

export function SheetCentre({ props, director, onOpenContext, onAsk, onRefine, onShowLog, onShowReport, onPromoteAnyway }: SheetCentreProps) {
  const { t } = useTranslation();
  const { act, round, clock, frames, core, launch, launching } = director;
  const store = useAgentStore(useShallow((s) => ({
    behaviorCore: s.buildBehaviorCore,
    capOrder: s.buildCapabilityOrder,
    caps: s.buildCapabilities,
    activity: s.buildActivity,
  })));
  const name = props.agentName && props.agentName !== "New Agent" ? props.agentName : COPY.slateNewAgent;
  const role = store.behaviorCore?.identity?.role ?? null;
  const mission = store.behaviorCore?.mission ?? null;
  const resetKey = director.buildSessionId ?? "none";

  const capPrints: PrintItem[] = props.glyphRows.length > 0
    ? props.glyphRows.map((r) => ({ id: r.id, title: r.title }))
    : store.capOrder.map((id) => ({ id, title: store.caps[id]?.title ?? id }));
  const results = props.toolTestResults ?? [];
  const toolPrints: PrintItem[] = results.map((r) => ({ id: r.tool_name, title: r.tool_name, status: TOOL_STATUS[r.status] ?? "idle" }));

  const phase = store.activity
    ?? (props.buildPhase === "resolving" ? t.agents.glyph_build_beat_wiring
      : props.buildPhase === "analyzing" ? t.agents.glyph_build_beat_understanding
      : COPY.phaseStarting);

  let scene: ReactNode = null;
  switch (act) {
    case "compose":
      scene = (
        <ComposeCentre
          intentText={props.intentText} onIntentChange={props.onIntentChange}
          onLaunch={launch} launchDisabled={props.launchDisabled} launching={launching}
          hasContext={!!props.contextText?.trim()} onOpenContext={onOpenContext} core={core}
        />
      );
      break;
    case "exposure":
    case "wiring":
    case "waiting":
      scene = (
        <SlateCentre
          agentName={name} phase={phase} seconds={clock.openSecs}
          note={act === "exposure" ? COPY.slateFirstPassNote : act === "wiring" ? COPY.slateWiringNote : COPY.slateWaitingNote}
          ghostPrints={act === "wiring" ? store.capOrder.length : 0}
        />
      );
      break;
    case "questions":
      scene = (
        <QuestionsCentre
          questions={round.questions} drafts={round.drafts} answeredCount={round.answeredCount}
          allAnswered={round.allAnswered} sending={round.sending} firstPassSecs={clock.firstPassSecs}
          onResume={() => onAsk(Math.max(0, round.nextUnanswered(-1)))} onEdit={onAsk} onSend={round.send}
        />
      );
      break;
    case "failed":
      scene = <FailedCentre error={props.buildError} seconds={clock.totals.llm} onShowLog={onShowLog} onRefine={props.onRefine ? onRefine : undefined} />;
      break;
    case "draft":
      scene = (
        <DraftCentre
          role={role} name={name} mission={mission} prints={capPrints} resetKey={resetKey}
          onRename={props.onAgentNameChange} onStartTest={props.onStartTest} onRefine={props.onRefine ? onRefine : undefined}
        />
      );
      break;
    case "testing":
      scene = <TestingCentre prints={toolPrints.length ? toolPrints : capPrints} resetKey={`${resetKey}-test`} lines={props.testOutputLines ?? []} />;
      break;
    case "verdict":
      scene = (
        <VerdictCentre
          passed={!!props.testPassed} prints={toolPrints} resetKey={`${resetKey}-verdict`}
          okCount={results.filter((r) => r.status === "passed").length} error={props.testError ?? null}
          onPromote={props.onPromote} onPromoteAnyway={onPromoteAnyway} onShowLog={onShowReport}
          onRefine={props.onRefine ? onRefine : undefined} onReject={props.onRejectTest}
        />
      );
      break;
    case "promoted": {
      const when = frames.trigger.value?.words ?? "";
      const where = frames.message.value?.words ?? COPY.capInbox;
      scene = (
        <PromotedCentre
          name={name} mission={mission} starring={capPrints.map((p) => p.title).slice(0, 4)}
          credits={[when, where].filter(Boolean).join(" · ")} onOpen={props.onViewAgent}
        />
      );
      break;
    }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={act === "exposure" || act === "wiring" || act === "waiting" ? "slate" : act}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        className="w-full max-h-full min-h-0 overflow-y-auto flex flex-col items-center justify-center"
      >
        {scene}
      </motion.div>
    </AnimatePresence>
  );
}
