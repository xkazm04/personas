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
import { GlyphQuestionPanel } from "@/features/shared/glyph";
import { GlyphFullLayout } from "@/features/agents/components/matrix/GlyphFullLayout";
import { useUseCaseChronology } from "@/features/templates/sub_generated/adoption/chronology/useUseCaseChronology";
import {
  serializeQuickConfig,
  type QuickConfigState,
} from "@/features/agents/components/matrix/DimensionQuickConfig";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';

// Layout preference — persists across sessions via localStorage.
// Only two modes remain: the new flagship "glyph-full" and the legacy
// 8-dimension matrix. Earlier "v3-capabilities" and "glyph" values are
// migrated to "glyph-full" on read.
type BuildLayout = "legacy-dimensions" | "glyph-full";
const LAYOUT_STORAGE_KEY = "personas:build-layout";
function readLayoutPreference(): BuildLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === "legacy-dimensions" || raw === "glyph-full") return raw;
    // Migrate retired values so users don't land on a stale preference.
    if (raw === "v3-capabilities" || raw === "glyph") return "glyph-full";
  } catch { /* SSR or disabled localStorage */ }
  return "glyph-full";
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

  // Glyph Full reads the same buildDraft as the adoption flow, so the shared
  // chronology builder produces the rows without any edit-mode-specific shim.
  const glyphRows = useUseCaseChronology();

  // Glyph Full owns its own DimensionQuickConfig state so we can append the
  // serialized config to intent at launch time — mirrors what PersonaMatrix
  // does internally for its pre-build quick setup.
  const [, setGlyphQuickConfig] = useState<QuickConfigState>({
    frequency: null, days: ['mon'], monthDay: 1, time: '09:00',
    selectedConnectors: [], connectorTables: {}, selectedEvents: [],
  });
  const glyphQuickConfigRef = useRef<QuickConfigState>({
    frequency: null, days: ['mon'], monthDay: 1, time: '09:00',
    selectedConnectors: [], connectorTables: {}, selectedEvents: [],
  });
  const handleLaunchGlyph = useCallback(() => {
    const hint = serializeQuickConfig(glyphQuickConfigRef.current);
    if (hint) setIntentText(intentTextRef.current + hint);
    void handleLaunch();
  }, [handleLaunch, setIntentText]);
  const handleQuickConfigChange = useCallback((c: QuickConfigState) => {
    glyphQuickConfigRef.current = c;
    setGlyphQuickConfig(c);
  }, []);

  // -- Render -------------------------------------------------------------

  return (
    <div
      className="flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden px-4 md:px-6 xl:px-8 pt-4 transition-opacity duration-400 ease-out"
      style={{ opacity: fadeOut ? 0 : 1 }}
    >
      {/* Inline pending-question panel — renders across ALL layouts, so the
          8-dim Matrix and the v3-capabilities view answer questions the same
          way the Glyph prototype does. Prior iteration auto-opened a modal
          for every pending question in non-Glyph layouts; this inlines the
          Q&A as a first-class surface of the flow rather than a takeover. */}
      {/* Inline Q&A is rendered here only for the legacy 8-dimension layout —
          Glyph Full hosts Q&A inside the CommandPanel's Refine step so the
          composer + Q&A read as one continuous surface. */}
      {layout !== "glyph-full" && build.pendingQuestions && build.pendingQuestions.length > 0 && (
        <div className="flex-shrink-0 mb-3" data-testid="build-inline-questions">
          <GlyphQuestionPanel
            questions={build.pendingQuestions}
            onAnswer={build.handleAnswer}
          />
        </div>
      )}

      {/* Layout toggle — two modes only: the flagship Glyph Full and the
          legacy 8-dimension matrix. */}
      <div className="flex-shrink-0 mb-2 flex justify-end" data-testid="build-layout-toggle">
        <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
          <button
            type="button"
            onClick={() => handleLayoutChange("glyph-full")}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              layout === "glyph-full"
                ? "bg-primary/20 text-primary"
                : "text-foreground/60 hover:text-foreground"
            }`}
            title="Glyph Full — sigil-first flagship build surface"
            data-testid="build-layout-toggle-glyph-full"
          >
            Glyph Full
          </button>
          <button
            type="button"
            onClick={() => handleLayoutChange("legacy-dimensions")}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              layout === "legacy-dimensions"
                ? "bg-primary/20 text-primary"
                : "text-foreground/60 hover:text-foreground"
            }`}
            title="8-dimension view — original matrix layout"
            data-testid="build-layout-toggle-legacy"
          >
            8-dimension View
          </button>
        </div>
      </div>

      {layout === "glyph-full" ? (
        <GlyphFullLayout
          intentText={intentText}
          onIntentChange={setIntentText}
          onLaunch={handleLaunchGlyph}
          launchDisabled={launchDisabled}
          isBuilding={build.isBuilding}
          buildPhase={build.buildPhase}
          completeness={build.completeness}
          cellStates={build.cellStates}
          pendingQuestions={build.pendingQuestions}
          onAnswer={build.handleAnswer}
          agentName={agentName}
          onAgentNameChange={setAgentName}
          hasDesignResult={hasDesignResult}
          glyphRows={glyphRows}
          onStartTest={lifecycle.handleStartTest}
          onPromote={() => { void lifecycle.handlePromote(); }}
          onPromoteForce={() => { void lifecycle.handlePromote({ force: true }); }}
          onRejectTest={lifecycle.handleRejectTest}
          onRefine={lifecycle.handleRefine}
          testOutputLines={build.buildTestOutputLines}
          testPassed={build.buildTestPassed}
          testError={build.buildTestError}
          cliOutputLines={build.outputLines}
          onQuickConfigChange={handleQuickConfigChange}
          onViewAgent={handleViewPromotedAgent}
          buildError={build.buildError}
        />
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
