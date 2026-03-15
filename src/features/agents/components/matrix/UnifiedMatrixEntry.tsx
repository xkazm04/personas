/**
 * UnifiedMatrixEntry -- direct matrix mount replacing CreationWizard.
 *
 * This component renders PersonaMatrix with variant="creation" directly,
 * with no mode tabs (build/chat/matrix) and no wizard step navigation.
 * The matrix IS the creation surface.
 *
 * It uses useMatrixBuild for build orchestration and manages local state
 * for intent text and agent name. Draft persona creation follows the same
 * pattern as MatrixCreator (createPersona via agentStore).
 *
 * NOTE: This does NOT delete CreationWizard -- that happens in Plan 05.
 * This plan just creates the replacement component.
 */
import { useState, useCallback } from "react";
import { PersonaMatrix } from "@/features/templates/sub_generated/gallery/matrix/PersonaMatrix";
import { useMatrixBuild } from "@/features/agents/components/matrix/useMatrixBuild";
import { useMatrixLifecycle } from "@/features/agents/components/matrix/useMatrixLifecycle";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnifiedMatrixEntryProps {
  /** Whether the cancel link is shown at the bottom. */
  canCancel?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnifiedMatrixEntry({ canCancel }: UnifiedMatrixEntryProps) {
  const setIsCreatingPersona = useSystemStore(
    (s) => s.setIsCreatingPersona,
  );
  const createPersona = useAgentStore((s) => s.createPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);

  // -- Draft persona from Zustand (survives navigation) ------------------

  const draftPersonaId = useAgentStore((s) => s.buildPersonaId);
  const setDraftPersonaId = useCallback(
    (id: string | null) => useAgentStore.setState({ buildPersonaId: id }),
    [],
  );

  // -- Local state --------------------------------------------------------

  const [intentText, setIntentText] = useState("");
  const [agentName, setAgentName] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);

  // -- Build orchestration ------------------------------------------------

  const build = useMatrixBuild({ personaId: draftPersonaId });
  const lifecycle = useMatrixLifecycle({
    personaId: draftPersonaId,
  });

  // -- Handlers -----------------------------------------------------------

  /**
   * Launch build: create a draft persona, start the session, and roll back
   * the persona if the session fails to start (CLI unavailable, etc.).
   */
  const handleLaunch = useCallback(async () => {
    // Check if we have a workflow import to use
    const store = useAgentStore.getState();
    const workflowJson = store.buildWorkflowJson;
    const parserResultJson = store.buildParserResultJson;
    const workflowName = store.buildWorkflowName;

    // For intent: use text input or fall back to workflow name
    const trimmed = intentText.trim() || (workflowName ? `Import and transform: ${workflowName}` : "");
    if (!trimmed || build.isBuilding) return;
    setLaunchError(null);

    let personaId = draftPersonaId;
    if (!personaId) {
      try {
        const name = (workflowName ?? trimmed).slice(0, 30) || "Draft Agent";
        const persona = await createPersona({
          name,
          description: trimmed.slice(0, 200) || undefined,
          system_prompt: "You are a helpful AI assistant.",
        });
        personaId = persona.id;
        setDraftPersonaId(personaId);
      } catch (err) {
        setLaunchError("Failed to create draft agent.");
        console.error("Failed to create draft persona:", err);
        return;
      }
    }

    try {
      await build.handleGenerate(
        trimmed,
        personaId,
        workflowJson ?? undefined,
        parserResultJson ?? undefined,
      );
    } catch (err) {
      console.error("Build session failed to start:", err);
      setLaunchError(
        err instanceof Error ? err.message : "Build failed to start. Check CLI configuration.",
      );
      try {
        await deletePersona(personaId);
      } catch { /* best-effort cleanup */ }
      setDraftPersonaId(null);
    }
  }, [intentText, build, draftPersonaId, createPersona, deletePersona]);

  /**
   * Cancel: abort build + exit creation mode.
   */
  const handleCancel = useCallback(async () => {
    await build.handleCancel();
    setIsCreatingPersona(false);
  }, [build, setIsCreatingPersona]);

  // -- Derived props for PersonaMatrix ------------------------------------

  const isActivelyBuilding = build.isBuilding || build.buildPhase === "awaiting_input";
  const hasWorkflowImport = !!useAgentStore((s) => s.buildWorkflowJson);
  const launchDisabled = (!intentText.trim() && !hasWorkflowImport) || isActivelyBuilding;
  const hasDesignResult = build.buildPhase === "draft_ready" || build.buildPhase === "testing" || build.buildPhase === "test_complete" || build.buildPhase === "promoted";

  // -- Render -------------------------------------------------------------

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden px-4 md:px-6 xl:px-8 pt-4">
      <div className="flex-1 min-h-0 w-full">
        <PersonaMatrix
          designResult={null}
          variant="creation"
          hideHeader
          intentText={intentText}
          onIntentChange={setIntentText}
          onLaunch={handleLaunch}
          launchDisabled={launchDisabled}
          isRunning={build.isBuilding}
          completeness={build.completeness}
          cliOutputLines={build.outputLines}
          buildLocked={isActivelyBuilding}
          cellBuildStates={build.cellStates}
          pendingQuestions={build.pendingQuestions}
          onAnswerBuildQuestion={build.handleAnswer}
          agentName={agentName}
          onAgentNameChange={setAgentName}
          hasDesignResult={hasDesignResult}
          buildPhase={build.buildPhase}
          onStartTest={lifecycle.handleStartTest}
          onApproveTest={lifecycle.handlePromote}
          onRejectTest={lifecycle.handleRejectTest}
          onRefine={lifecycle.handleRefine}
          testOutputLines={build.buildTestOutputLines}
          testPassed={build.buildTestPassed}
          testError={build.buildTestError}
        />
      </div>

      {/* Error banner */}
      {(launchError || build.buildError) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/5 text-sm text-red-400 flex-shrink-0">
          <span className="flex-1">{launchError || build.buildError}</span>
          <button
            type="button"
            onClick={() => setLaunchError(null)}
            className="text-red-400/60 hover:text-red-400 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Cancel link -- same pattern as MatrixCreator */}
      {canCancel && (
        <div className="flex items-center justify-start pt-3 border-t border-primary/10 flex-shrink-0">
          <button
            type="button"
            onClick={handleCancel}
            data-testid="agent-cancel-btn"
            className="text-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
