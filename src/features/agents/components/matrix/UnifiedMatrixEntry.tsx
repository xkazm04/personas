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
import { useState, useCallback, useEffect, useRef } from "react";
import { PersonaMatrix } from "@/features/templates/sub_generated/gallery/matrix/PersonaMatrix";
import { useMatrixBuild } from "@/features/agents/components/matrix/useMatrixBuild";
import { useMatrixLifecycle } from "@/features/agents/components/matrix/useMatrixLifecycle";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("unified-matrix-entry");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnifiedMatrixEntryProps {
  /** @deprecated Cancel button removed. Kept for call-site compatibility. */
  canCancel?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a short placeholder agent name from intent (replaced by LLM name once agent_ir arrives). */
function generateAgentName(intent: string): string {
  // For non-Latin scripts, take the first few characters of the intent as placeholder
  const hasLatin = /[a-zA-Z]{3,}/.test(intent);
  if (!hasLatin) {
    // Non-Latin: use first ~10 chars of intent + generic suffix
    const trimmed = intent.replace(/\s+/g, '').slice(0, 10);
    return trimmed.length > 0 ? `${trimmed}...` : 'New Agent';
  }

  const lower = intent.toLowerCase();
  const stopwords = new Set([
    'a','an','the','my','our','all','new','and','or','for','to','in','on','from',
    'with','that','this','of','by','is','it','me','i','be','do','so','if','up',
    'help','more','want','get','make','let','just','very','really','much','also',
    'some','every','each','should','would','could','please','like','need','about',
    'build','create','monitor','automate','run','set','use','manage','handle',
    'send','post','check','track','find','watch','start','stop','keep','turn',
    'add','update','process','generate','log','report','daily','weekly','monthly',
    'automatically','before','after','based','into','then','when','using','via',
  ]);
  const words = lower
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
  if (words.length < 2) return 'New Agent';
  const nameWords = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return `${nameWords.join(' ')} Agent`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UnifiedMatrixEntry(_props: UnifiedMatrixEntryProps) {
  const createPersona = useAgentStore((s) => s.createPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);

  // -- Draft persona from Zustand (survives navigation) ------------------

  const draftPersonaId = useAgentStore((s) => s.buildPersonaId);
  const setDraftPersonaId = useCallback(
    (id: string | null) => useAgentStore.setState({ buildPersonaId: id }),
    [],
  );

  // -- Local state --------------------------------------------------------

  const [intentText, _setIntentText] = useState("");
  const intentTextRef = useRef(intentText);
  intentTextRef.current = intentText;
  const setIntentText = useCallback((v: string) => {
    intentTextRef.current = v;
    _setIntentText(v);
  }, []);
  const [agentName, setAgentName] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [fadeOut, setFadeOut] = useState(false);

  // -- Post-promotion: navigate to the promoted agent with fade transition --

  const handleViewPromotedAgent = useCallback(() => {
    const personaId = draftPersonaId;
    if (!personaId) return;

    setFadeOut(true);
    setTimeout(() => {
      // Reset build state and intent
      useAgentStore.getState().resetBuildSession();
      setIntentText('');
      setAgentName('');
      setDraftPersonaId(null);

      // Navigate to the promoted agent
      useAgentStore.getState().selectPersona(personaId);
      useAgentStore.getState().fetchPersonas();
      useSystemStore.getState().setIsCreatingPersona(false);
      useSystemStore.getState().setEditorTab('matrix');
    }, 400); // matches fade duration
  }, [draftPersonaId, setIntentText, setDraftPersonaId]);

  // Auto-redirect after promotion
  const buildPhaseForRedirect = useAgentStore((s) => s.buildPhase);
  useEffect(() => {
    if (buildPhaseForRedirect === 'promoted' && draftPersonaId && !fadeOut) {
      // Short delay so user sees the "Agent Promoted" success indicator
      const timer = setTimeout(() => handleViewPromotedAgent(), 1500);
      return () => clearTimeout(timer);
    }
  }, [buildPhaseForRedirect, draftPersonaId, fadeOut, handleViewPromotedAgent]);

  // -- Build orchestration ------------------------------------------------

  const build = useMatrixBuild({ personaId: draftPersonaId });
  const lifecycle = useMatrixLifecycle({
    personaId: draftPersonaId,
  });

  // -- Sync agent name from build draft (agent_ir.name) -------------------

  const buildDraft = useAgentStore((s) => s.buildDraft);
  useEffect(() => {
    if (!buildDraft || typeof buildDraft !== "object") return;
    const ir = buildDraft as Record<string, unknown>;
    const draftName = ir.name;
    if (typeof draftName === "string" && draftName.length > 0 && draftName !== agentName) {
      setAgentName(draftName);
    }
  }, [buildDraft]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // For intent: use text input (via ref for latest value) or fall back to workflow name
    const trimmed = intentTextRef.current.trim() || (workflowName ? `Import and transform: ${workflowName}` : "");
    if (!trimmed || build.isBuilding) return;
    setLaunchError(null);

    let personaId = draftPersonaId;
    if (!personaId) {
      try {
        const name = workflowName?.slice(0, 30) || generateAgentName(trimmed);
        const persona = await createPersona({
          name,
          description: trimmed.slice(0, 200) || undefined,
          system_prompt: "You are a helpful AI assistant.",
        });
        personaId = persona.id;
        setDraftPersonaId(personaId);
      } catch (err) {
        setLaunchError("Failed to create draft agent.");
        logger.error("Failed to create draft persona", { error: err });
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
      logger.error("Build session failed to start", { error: err });
      setLaunchError(
        err instanceof Error ? err.message : "Build failed to start. Check CLI configuration.",
      );
      try {
        await deletePersona(personaId);
      } catch { /* best-effort cleanup */ }
      setDraftPersonaId(null);
    }
  }, [build, draftPersonaId, createPersona, deletePersona]); // intentText read via ref

  // -- Inline edit handlers (use --continue session for CLI refine) --------

  const handleApplyEdits = useCallback(async () => {
    const store = useAgentStore.getState();
    if (!store.buildEditDirty) return;

    // Build a summary of what the user changed in buildCellData
    const parts: string[] = [];
    const cellData = store.buildCellData;

    for (const [key, data] of Object.entries(cellData)) {
      if (data?.items && data.items.length > 0) {
        parts.push(`[${key}]: ${data.items.join('; ')}`);
      }
      // Include structured connector data
      if (key === 'connectors' && data?.raw?.connectors) {
        const names = (data.raw.connectors as Array<{ name: string }>).map((c) => c.name);
        parts.push(`[connectors-structured]: ${names.join(', ')}`);
      }
      // Include structured trigger data
      if (key === 'triggers' && data?.raw?.triggers) {
        const descs = (data.raw.triggers as Array<{ description?: string }>).map((t) => t.description ?? 'trigger');
        parts.push(`[triggers-structured]: ${descs.join(', ')}`);
      }
    }

    if (parts.length === 0) {
      store.clearEditDirty();
      return;
    }

    const summary = `User edited the agent dimensions. Here is the current state of all dimensions after their edits:\n${parts.join('\n')}\n\nPlease update the agent_ir to reflect these changes. Re-emit any dimensions that need updating.`;
    await lifecycle.handleRefine(summary);
    store.clearEditDirty();
  }, [lifecycle]);

  const handleDiscardEdits = useCallback(() => {
    const store = useAgentStore.getState();
    store.initEditStateFromDraft();
    store.clearEditDirty();
  }, []);

  // -- Derived props for PersonaMatrix ------------------------------------

  const isActivelyBuilding = build.isBuilding || build.buildPhase === "awaiting_input";
  const hasWorkflowImport = !!useAgentStore((s) => s.buildWorkflowJson);
  const launchDisabled = (!intentText.trim() && !hasWorkflowImport) || isActivelyBuilding;
  const hasDesignResult = build.buildPhase === "draft_ready" || build.buildPhase === "testing" || build.buildPhase === "test_complete" || build.buildPhase === "promoted";

  // -- Render -------------------------------------------------------------

  return (
    <div
      className="flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden px-4 md:px-6 xl:px-8 pt-4 transition-opacity duration-400 ease-out"
      style={{ opacity: fadeOut ? 0 : 1 }}
    >
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
          toolTestResults={lifecycle.buildToolTestResults}
          testSummary={lifecycle.buildTestSummary}
          buildActivity={build.buildActivity}
          onApplyEdits={handleApplyEdits}
          onDiscardEdits={handleDiscardEdits}
          onSubmitAllAnswers={build.handleSubmitAnswers}
          onViewAgent={handleViewPromotedAgent}
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

    </div>
  );
}
