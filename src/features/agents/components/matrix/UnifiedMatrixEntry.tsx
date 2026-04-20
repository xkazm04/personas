/**
 * UnifiedMatrixEntry -- unified matrix build surface for persona creation and editing.
 *
 * This component renders PersonaMatrix with variant="creation" directly,
 * with no mode tabs and no wizard step navigation.
 * The matrix IS the creation surface.
 *
 * It uses useMatrixBuild for build orchestration and manages local state
 * for intent text and agent name. Draft persona creation calls createPersona
 * via agentStore before starting the build session.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { PersonaMatrix } from "@/features/templates/sub_generated/gallery/matrix/PersonaMatrix";
import { useMatrixBuild } from "@/features/agents/components/matrix/useMatrixBuild";
import { useMatrixLifecycle } from "@/features/agents/components/matrix/useMatrixLifecycle";
import { BehaviorCoreEditor } from "@/features/agents/components/matrix/BehaviorCoreEditor";
import { CapabilityRowEditor } from "@/features/agents/components/matrix/CapabilityRowEditor";
import { CapabilityAddModal } from "@/features/agents/components/matrix/CapabilityAddModal";
import { SharedResourcesPanel } from "@/features/agents/components/matrix/SharedResourcesPanel";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';

// v3 layout preference — persists across sessions via localStorage.
type BuildLayout = "legacy-dimensions" | "v3-capabilities";
const LAYOUT_STORAGE_KEY = "personas:build-layout";
function readLayoutPreference(): BuildLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === "legacy-dimensions" || raw === "v3-capabilities") return raw;
  } catch { /* SSR or disabled localStorage */ }
  return "v3-capabilities";
}
function writeLayoutPreference(value: BuildLayout): void {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, value); } catch { /* best-effort */ }
}

const logger = createLogger("unified-matrix-entry");

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

export function UnifiedMatrixEntry() {
  const { t } = useTranslation();
  const createPersona = useAgentStore((s) => s.createPersona);
  const deletePersona = useAgentStore((s) => s.deletePersona);

  // -- Draft persona from Zustand (survives navigation) ------------------

  const draftPersonaId = useAgentStore((s) => s.buildPersonaId);
  const setDraftPersonaId = useCallback(
    (id: string | null) => {
      if (id === null) {
        // Clear the current active draft session (promotion / failure cleanup).
        // resetBuildSession removes the active session from the map and syncs scalars.
        useAgentStore.getState().resetBuildSession();
      }
      // For non-null id: no-op. The draft id is set implicitly by
      // createBuildSession once session.startSession completes successfully.
      // Callers that need a sentinel before session creation should use
      // their own local state.
    },
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
  const [isLaunching, setIsLaunching] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  // -- Post-promotion: navigate to the promoted agent with fade transition --

  const handleViewPromotedAgent = useCallback(() => {
    const personaId = draftPersonaId;
    if (!personaId) return;

    setFadeOut(true);
    setTimeout(() => {
      // Remove process activity
      try {
        void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
          useOverviewStore.getState().processEnded('agent_build', 'completed', personaId);
        });
      } catch { /* best-effort */ }

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

  // -- Auto-test on draft_ready when no pending questions -----------------
  // Saves the user a click: as soon as the LLM has produced a draft and there
  // are no outstanding questions, kick off the test pass automatically.
  // If the LLM raises questions later, manual test remains available.
  //
  // Multi-round support: when the LLM surfaces a new pending question mid-build,
  // the ref is reset so that once the user answers it and we cycle back to
  // draft_ready with no more questions, the auto-test fires again.
  const autoTestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (build.pendingQuestions && build.pendingQuestions.length > 0) {
      autoTestedRef.current = null;
    }
  }, [build.pendingQuestions]);
  useEffect(() => {
    const phase = build.buildPhase;
    if (phase !== 'draft_ready') return;
    if (!draftPersonaId) return;
    if (autoTestedRef.current === draftPersonaId) return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.buildError) return;
    autoTestedRef.current = draftPersonaId;
    void lifecycle.handleStartTest();
  }, [build.buildPhase, build.pendingQuestions, build.buildError, draftPersonaId, lifecycle]);

  // Reset auto-test guard if the user resets/restarts the build
  useEffect(() => {
    if (!draftPersonaId) autoTestedRef.current = null;
  }, [draftPersonaId]);

  // -- Sync build phase → process activity status -------------------------

  const currentPhase = useAgentStore((s) => s.buildPhase);
  useEffect(() => {
    if (!draftPersonaId || !currentPhase) return;
    // Terminal phases: end the process activity
    if (currentPhase === 'promoted' || currentPhase === 'failed' || currentPhase === 'cancelled') {
      const action = currentPhase === 'promoted' ? 'completed' as const : 'failed' as const;
      void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
        useOverviewStore.getState().processEnded('agent_build', action, draftPersonaId);
      }).catch(() => {});
      return;
    }
    const phaseMap: Record<string, { status: ActiveProcess["status"]; event: string }> = {
      'initializing': { status: 'running', event: 'Initializing...' },
      'analyzing': { status: 'running', event: 'Analyzing...' },
      'awaiting_input': { status: 'input_required', event: 'Waiting for answers' },
      'resolving': { status: 'running', event: 'Building agent...' },
      'draft_ready': { status: 'running', event: 'Draft ready — test & promote' },
      'testing': { status: 'running', event: 'Testing agent...' },
      'test_complete': { status: 'running', event: 'Test complete — approve to promote' },
    };
    const mapped = phaseMap[currentPhase];
    if (!mapped) return;
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      useOverviewStore.getState().updateProcessStatus(
        'agent_build', mapped.status,
        { lastEvent: mapped.event, runId: draftPersonaId },
      );
    }).catch(() => {});
  }, [currentPhase, draftPersonaId]);

  // -- Sync agent name from build draft (agent_ir.name) -------------------

  const buildDraft = useAgentStore((s) => s.buildDraft);
  useEffect(() => {
    if (!buildDraft || typeof buildDraft !== "object") return;
    const ir = buildDraft as Record<string, unknown>;
    const draftName = ir.name;
    if (typeof draftName === "string" && draftName.length > 0 && draftName !== agentName) {
      setAgentName(draftName);
    }
  }, [buildDraft]);

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
    if (!trimmed || build.isBuilding || isLaunching) return;
    setIsLaunching(true);
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
        setLaunchError(t.agents.matrix_entry.failed_to_create);
        logger.error("Failed to create draft persona", { error: err });
        return;
      }
    }

    // Register process activity
    try {
      void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
        useOverviewStore.getState().processStarted(
          'agent_build', personaId,
          `Build: ${workflowName?.slice(0, 30) || generateAgentName(trimmed)}`,
          { section: 'personas', tab: 'matrix', personaId },
        );
      });
    } catch { /* best-effort */ }

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
        void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
          useOverviewStore.getState().processEnded('agent_build', 'failed', personaId);
        });
      } catch { /* best-effort */ }
      try {
        await deletePersona(personaId);
      } catch { /* best-effort cleanup */ }
      setDraftPersonaId(null);
    } finally {
      setIsLaunching(false);
    }
  }, [build, draftPersonaId, createPersona, deletePersona, isLaunching]); // intentText read via ref

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

  // -- Layout toggle (legacy dimensions vs v3 capabilities) ---------------
  const [layout, setLayout] = useState<BuildLayout>(readLayoutPreference);
  const handleLayoutChange = useCallback((next: BuildLayout) => {
    setLayout(next);
    writeLayoutPreference(next);
  }, []);

  const hasBehaviorCore = useAgentStore((s) => s.buildBehaviorCore !== null);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const [showAddCapability, setShowAddCapability] = useState(false);

  // -- Render -------------------------------------------------------------

  return (
    <div
      className="flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden px-4 md:px-6 xl:px-8 pt-4 transition-opacity duration-400 ease-out"
      style={{ opacity: fadeOut ? 0 : 1 }}
    >
      {/* Layout toggle — shown only once a build is in progress. */}
      {(hasBehaviorCore || hasDesignResult || isActivelyBuilding) && (
        <div className="flex-shrink-0 mb-2 flex justify-end" data-testid="build-layout-toggle">
          <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
            <button
              type="button"
              onClick={() => handleLayoutChange("legacy-dimensions")}
              className={`rounded-full px-3 py-1 typo-caption transition ${
                layout === "legacy-dimensions"
                  ? "bg-primary/20 text-primary"
                  : "text-foreground/60 hover:text-foreground"
              }`}
              title={t.matrix_v3.layout_toggle_tooltip}
              data-testid="build-layout-toggle-legacy"
            >
              {t.matrix_v3.layout_toggle_legacy}
            </button>
            <button
              type="button"
              onClick={() => handleLayoutChange("v3-capabilities")}
              className={`rounded-full px-3 py-1 typo-caption transition ${
                layout === "v3-capabilities"
                  ? "bg-primary/20 text-primary"
                  : "text-foreground/60 hover:text-foreground"
              }`}
              title={t.matrix_v3.layout_toggle_tooltip}
              data-testid="build-layout-toggle-v3"
            >
              {t.matrix_v3.layout_toggle_v3}
            </button>
          </div>
        </div>
      )}

      {layout === "v3-capabilities" && hasBehaviorCore ? (
        // v3 capability-first layout
        <div
          className="flex-1 min-h-0 w-full overflow-y-auto pr-1"
          data-testid="build-layout-v3"
        >
          <div className="flex flex-col gap-5 pb-10">
            <BehaviorCoreEditor />

            <section
              className="flex flex-col gap-3 rounded-2xl border border-border/30 bg-secondary/10 p-5"
              data-testid="capabilities-section"
            >
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="typo-heading-sm text-foreground">
                    {t.matrix_v3.capabilities_section_title}
                  </h3>
                  <p className="typo-body-sm text-foreground/50">
                    {t.matrix_v3.capabilities_section_subtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddCapability(true)}
                  className="rounded-xl bg-primary/20 px-3 py-1.5 typo-body-sm font-medium text-primary hover:bg-primary/30"
                  data-testid="capabilities-add-button"
                >
                  + {t.matrix_v3.capabilities_add_button}
                </button>
              </header>

              {capabilityOrder.length === 0 ? (
                <p
                  className="typo-body-sm text-foreground/40 py-4"
                  data-testid="capabilities-empty"
                >
                  {t.matrix_v3.capabilities_empty}
                </p>
              ) : (
                <div className="flex flex-col gap-3" data-testid="capabilities-list">
                  {capabilityOrder.map((id) => (
                    <CapabilityRowEditor key={id} capabilityId={id} />
                  ))}
                </div>
              )}
            </section>

            <SharedResourcesPanel />

            {/* Keep the existing PersonaMatrix command-hub controls for
               Test / Approve / Refine / View below the capability list.
               PersonaMatrix's dimension grid is visually redundant in this
               mode but its footer controls aren't — render in a collapsed
               mode so the hub stays usable. */}
            <div className="opacity-70">
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
                onApproveTest={() => { void lifecycle.handlePromote(); }}
                onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
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
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 w-full" data-testid="build-layout-legacy">
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
            onApproveTest={() => { void lifecycle.handlePromote(); }}
            onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
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
      )}

      <CapabilityAddModal
        open={showAddCapability}
        onClose={() => setShowAddCapability(false)}
      />

      {/* Error banner */}
      {(launchError || build.buildError) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-card border border-red-500/20 bg-red-500/5 typo-body text-red-400 flex-shrink-0">
          <span className="flex-1">{launchError || build.buildError}</span>
          <button
            type="button"
            onClick={() => setLaunchError(null)}
            className="text-red-400/60 hover:text-red-400 typo-caption"
          >
            {t.errors.dismiss_error}
          </button>
        </div>
      )}

    </div>
  );
}
