/** DialogueStageSurface — the dialogue-native post-compose stage.
 *
 *  The Dialogue-based variants (Dialogue, Dialogue+Cinema) must NOT drop the
 *  user into the glyph sigil UI once the build starts — the whole point is that
 *  the experience stays a conversation. This is GlyphStageSurface's dialogue
 *  twin: it drives the same build → refine → test → promote lifecycle, but
 *  renders it as a dialogue thread (a clarifying-question card, then the
 *  build/test/promote state machine, with the persona metadata alongside)
 *  instead of the sigil face + petal strip.
 *
 *  It reuses the exact same phase components the sigil uses — GlyphCoreContent
 *  (build/test/promote state machine), GlyphAnswerCard (one clarifying question),
 *  GlyphMetadataPanel (the readable persona/capability readout) — so behaviour
 *  is identical; only the frame differs.
 */
import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { BuildSimulatePanel } from "@/features/agents/components/matrix/BuildSimulatePanel";
import { TestReportModal } from "@/features/templates/sub_generated/adoption/chronology/TestReportModal";
import { CapabilityAddModal } from "@/features/agents/sub_new_persona/capabilityView";
import { GlyphCoreContent } from "./GlyphCoreContent";
import { GlyphAnswerCard } from "./GlyphAnswerCard";
import { GlyphMetadataPanel } from "./GlyphMetadataPanel";
import { ThreadLine } from "./DialogueComposePanel";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

export function DialogueStageSurface(props: GlyphFullLayoutProps) {
  const {
    agentName, isBuilding, buildPhase, completeness,
    pendingQuestions, onAnswer, hasDesignResult,
    onStartTest, onPromote, onPromoteForce, onRejectTest, onRefine, onViewAgent,
    buildError, testOutputLines, testPassed, testError, toolTestResults, testSummary,
  } = props;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const buildDraft = useAgentStore((s) => s.buildDraft);
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const activeQuestion = pendingQuestions?.[0] ?? null;
  const remaining = Math.max(0, (pendingQuestions?.length ?? 0) - 1);

  const [refining, setRefining] = useState(false);
  const [refinePrefill, setRefinePrefill] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showReport, setShowReport] = useState(false);

  // Session-change isolation — a new build never inherits stale local state.
  useEffect(() => {
    setRefining(false);
    setRefinePrefill(null);
    setShowAdd(false);
    setShowSimulate(false);
    setShowReport(false);
  }, [buildSessionId]);

  const header = hasPending
    ? "A couple of questions to get this right"
    : hasDesignResult
      ? "Your agent is ready"
      : "Assembling your agent";

  return (
    <div className="w-full flex items-start gap-6 px-2" data-testid="dialogue-stage-surface">
      {/* ── Dialogue thread column ─────────────────────────────────── */}
      <div className="relative flex-1 min-w-0 flex flex-col gap-4">
        <ThreadLine delay={0.05}>
          <span className="typo-body-lg text-foreground">{header}</span>
          {hasPending && remaining > 0 && (
            <span className="typo-caption block mt-0.5">{remaining} more after this</span>
          )}
        </ThreadLine>

        {/* One clarifying question at a time — the conversation continues. */}
        <AnimatePresence mode="wait">
          {hasPending && activeQuestion ? (
            <GlyphAnswerCard
              key={activeQuestion.cellKey}
              question={activeQuestion}
              onAnswer={onAnswer}
              onClose={() => {}}
              variant="dialogue"
            />
          ) : (
            <div
              key="core"
              className="rounded-modal border border-card-border bg-card-bg shadow-elevation-2 px-4 py-8 flex justify-center"
            >
              <GlyphCoreContent
                isPreBuild={false}
                isBuilding={isBuilding}
                buildPhase={buildPhase}
                hasDesignResult={hasDesignResult}
                refining={refining}
                setRefining={setRefining}
                completenessPct={Math.round(completeness)}
                pendingQuestions={pendingQuestions}
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
                onShowReport={() => setShowReport(true)}
                onRequestSplit={(_title, prompt) => { setRefinePrefill(prompt); setRefining(true); }}
                refinePrefill={refinePrefill}
                onClearRefinePrefill={() => setRefinePrefill(null)}
              />
            </div>
          )}
        </AnimatePresence>

        {buildError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span>{buildError}</span>
          </div>
        )}
      </div>

      {/* ── Persona metadata rail ──────────────────────────────────── */}
      <GlyphMetadataPanel agentName={agentName} />

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
          onCredentialAdded={() => { void useAgentStore.getState().fetchPersonas(); }}
        />
      )}
    </div>
  );
}
