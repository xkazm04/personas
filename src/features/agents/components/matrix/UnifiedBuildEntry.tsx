/**
 * UnifiedBuildEntry -- unified matrix build surface for persona creation and editing.
 *
 * This component renders PersonaMatrix with variant="creation" directly,
 * with no mode tabs and no wizard step navigation.
 * The matrix IS the creation surface.
 *
 * It uses useBuild for build orchestration and manages local state
 * for intent text and agent name. Draft persona creation calls createPersona
 * via agentStore before starting the build session.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useBuild } from "@/features/agents/components/matrix/useBuild";
import { useLifecycle } from "@/features/agents/components/matrix/useLifecycle";
import { GlyphFullLayout } from "@/features/agents/components/glyph/GlyphFullLayout";
import { GlyphPrototypeLayout } from "@/features/agents/components/glyph/GlyphPrototypeLayout";
import { useUseCaseChronology } from "@/features/templates/sub_generated/adoption/chronology/useUseCaseChronology";
import {
  serializeQuickConfig,
  type QuickConfigState,
} from "@/features/agents/components/matrix/quickConfigTypes";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import {
  updatePersona,
  buildUpdateInput,
  getPersona,
} from "@/api/agents/personas";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText, debtText } from '@/i18n/DebtText';



// Layout preference — persists across sessions via localStorage.
// Two modes after 2026-05-05: the flagship "glyph-full" and the new
// "composer-prototype" (center-prompt surface with sigil quick-setup).
// The legacy 8-dimension matrix ("legacy-dimensions") was retired —
// stored values for it migrate to "glyph-full" on read.
type BuildLayout = "glyph-full" | "composer-prototype";
const LAYOUT_STORAGE_KEY = "personas:build-layout";
function readLayoutPreference(): BuildLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === "glyph-full" || raw === "composer-prototype") return raw;
    // Migrate retired values so users don't land on a stale preference.
    if (raw === "legacy-dimensions" || raw === "v3-capabilities" || raw === "glyph") return "glyph-full";
  } catch (err) { silentCatch("features/agents/components/matrix/UnifiedBuildEntry:catch1")(err); }
  return "glyph-full";
}
function writeLayoutPreference(value: BuildLayout): void {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, value); } catch (err) { silentCatch("features/agents/components/matrix/UnifiedBuildEntry:catch2")(err); }
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

export function UnifiedBuildEntry() {
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

  // Bridge: when the user opens persona creation while onboarding/tour is
  // active and they've already typed a goal in Home → SetupCards → GoalStep,
  // pre-fill the intent textarea so they don't re-type it. The setupGoal is
  // cleared once the persona is promoted (see handleViewPromotedAgent).
  // Reading once via getState() is intentional — the goal only changes when
  // the user typed in Home before clicking "Create persona", so we don't
  // need to reactively sync.
  const initialIntent = (() => {
    const s = useSystemStore.getState();
    // Phase F: Athena's prefill_persona_create wins over setup-goal
    // bridging — it's a more recent, more deliberate signal.
    if (s.companionPrefill && s.companionPrefill.intent) {
      return s.companionPrefill.intent;
    }
    const bridgeIsActive = s.onboardingActive || s.tourActive;
    return bridgeIsActive && typeof s.setupGoal === 'string' ? s.setupGoal : '';
  })();
  const [intentText, _setIntentText] = useState(initialIntent);
  const intentTextRef = useRef(intentText);
  intentTextRef.current = intentText;
  const setIntentText = useCallback((v: string) => {
    intentTextRef.current = v;
    _setIntentText(v);
  }, []);
  // Pre-seed agentName from a companion prefill so the wizard shows
  // both fields filled. Cleared along with the prefill below.
  const [agentName, setAgentName] = useState(() => {
    const s = useSystemStore.getState();
    return s.companionPrefill?.name ?? "";
  });
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  // Slice 4 — picker hydration source. Populated on mount when the build
  // flow is resumed for an existing draft persona, so the messaging picker
  // shows the user's prior selections instead of starting from the
  // built-in inbox default. `null` = "no hydration source" (fresh build).
  const [
    initialNotificationChannels,
    setInitialNotificationChannels,
  ] = useState<ChannelSpecV2[] | null>(null);

  // Phase F: pending auto-launch from Athena's prefill_persona_create.
  // Captured at mount time (so a prefill landing later doesn't surprise
  // the user). When true, an effect fires `handleLaunch` once the
  // intent is in state. Cleared after the first fire.
  const pendingAutoLaunchRef = useRef(false);
  // 2026-05-06 — additional prefill metadata threaded through to
  // `handleLaunch`. We snapshot at mount because the prefill slot is
  // cleared synchronously below; without these refs, the async build
  // launch would lose the mode + chat-session linkage.
  const pendingBuildModeRef = useRef<'interactive' | 'one_shot' | null>(null);
  const pendingCompanionSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const s = useSystemStore.getState();
    if (s.companionPrefill?.autoLaunch && s.companionPrefill.intent.trim()) {
      pendingAutoLaunchRef.current = true;
    }
    if (s.companionPrefill?.mode === 'one_shot') {
      pendingBuildModeRef.current = 'one_shot';
    } else if (s.companionPrefill?.mode === 'interactive') {
      pendingBuildModeRef.current = 'interactive';
    }
    if (s.companionPrefill?.companionSessionId) {
      pendingCompanionSessionIdRef.current = s.companionPrefill.companionSessionId;
    }
    // Consume the prefill regardless — it's a one-shot bridge. If
    // autoLaunch was false, the user just sees a prefilled wizard
    // and decides for themselves.
    if (s.companionPrefill) {
      s.setCompanionPrefill(null);
    }
  }, []);

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
      } catch (err) { silentCatch("features/agents/components/matrix/UnifiedBuildEntry:catch3")(err); }

      // Reset build state and intent
      useAgentStore.getState().resetBuildSession();
      setIntentText('');
      setAgentName('');
      setDraftPersonaId(null);

      // Bridge cleanup: the home stepper's setupGoal seeded this build's
      // intent. Now that the agent is promoted, clear it so subsequent
      // builds aren't pre-filled with a stale goal.
      useSystemStore.getState().setSetupGoal('');

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
    if (buildPhaseForRedirect !== 'promoted' || !draftPersonaId || fadeOut) return;
    // Short delay so user sees the "Agent Promoted" success indicator
    const timer = setTimeout(() => handleViewPromotedAgent(), 1500);
    return () => clearTimeout(timer);
  }, [buildPhaseForRedirect, draftPersonaId, fadeOut, handleViewPromotedAgent]);

  // -- Build orchestration ------------------------------------------------

  // Slice 4 — hydrate the picker from the persona's persisted
  // notification_channels JSON whenever the build flow resumes for an
  // existing draft. Effect is a noop on fresh builds (draftPersonaId is
  // null until createPersona returns). On parse errors we fall back to
  // null (treated as "no prior choices") so a malformed JSON doesn't
  // crash the build surface.
  useEffect(() => {
    if (!draftPersonaId) {
      setInitialNotificationChannels(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const persona = await getPersona(draftPersonaId);
        if (cancelled) return;
        const raw = persona.notification_channels;
        if (!raw || typeof raw !== "string" || raw.trim() === "") {
          setInitialNotificationChannels(null);
          return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          setInitialNotificationChannels(null);
          return;
        }
        // Only honour shape-v2 entries (objects with `use_case_ids`).
        // Legacy shape-A/B don't fit the picker's contract.
        const v2: ChannelSpecV2[] = parsed.filter(
          (e): e is ChannelSpecV2 =>
            e !== null &&
            typeof e === "object" &&
            "use_case_ids" in e &&
            "type" in e,
        );
        setInitialNotificationChannels(v2.length > 0 ? v2 : null);
      } catch (err) {
        logger.warn("Failed to hydrate notification channels", {
          personaId: draftPersonaId,
          error: err,
        });
        if (!cancelled) setInitialNotificationChannels(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftPersonaId]);

  const build = useBuild({ personaId: draftPersonaId });
  const lifecycle = useLifecycle({
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
  //
  // A-grade Phase 3 (2026-05-03): the ref is keyed by SESSION id, not
  // persona id, so a post-test_complete phase oscillation (test_complete →
  // draft_ready triggered by a late LLM event) does NOT re-fire the
  // auto-test on the same session. Pre-Phase-3 a multi-UC build that
  // emitted late agent_ir events after first test_complete would re-trigger
  // auto-test → testing → test_complete and the rapid-validation driver
  // had to tolerate phase oscillation. Once the test has fired for a
  // session, we keep that session's auto-test latched even if the LLM
  // pings phase back to draft_ready.
  const buildSessionId = useAgentStore((s) => s.buildSessionId);
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
    if (!buildSessionId) return;
    if (autoTestedRef.current === buildSessionId) return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.buildError) return;
    autoTestedRef.current = buildSessionId;
    void lifecycle.handleStartTest();
  }, [build.buildPhase, build.pendingQuestions, build.buildError, draftPersonaId, buildSessionId, lifecycle]);

  // Reset auto-test guard if the user resets/restarts the build (no
  // active session). Switching between drafts is handled implicitly —
  // the new session's id won't match the latched value.
  useEffect(() => {
    if (!buildSessionId) autoTestedRef.current = null;
  }, [buildSessionId]);

  // -- Auto-submit collected answers when the round empties ----------------
  // The QuestionRow / GlyphQuestionCard Send buttons call `collectAnswer`
  // which only stores the answer locally; the CLI never receives anything
  // until `submitAllAnswers` fires. The Glyph Full layout (the default) had
  // no Submit-All affordance, so users would answer every question, watch
  // them disappear, then see the same questions re-emitted by the CLI on its
  // next turn (the LLM never got a reply). Auto-submit once the visible
  // queue is empty and at least one answer is buffered. A short debounce
  // lets the user finish the last keystroke and lets a quick LLM follow-up
  // question (which would re-populate `pendingQuestions`) cancel the submit.
  const autoSubmitTimer = useRef<number | null>(null);
  useEffect(() => {
    if (autoSubmitTimer.current !== null) {
      window.clearTimeout(autoSubmitTimer.current);
      autoSubmitTimer.current = null;
    }
    if (!draftPersonaId) return;
    const phase = build.buildPhase;
    if (phase !== 'awaiting_input' && phase !== 'analyzing' && phase !== 'resolving') return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.pendingAnswerCount === 0) return;
    autoSubmitTimer.current = window.setTimeout(() => {
      autoSubmitTimer.current = null;
      void build.handleSubmitAnswers();
    }, 250);
    return () => {
      if (autoSubmitTimer.current !== null) {
        window.clearTimeout(autoSubmitTimer.current);
        autoSubmitTimer.current = null;
      }
    };
  }, [build, draftPersonaId]);

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
  }, [agentName, buildDraft]);

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

    const wasFreshCreate = !draftPersonaId;
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

    // Slice 3 — persist the picker's notification_channels onto the persona row
    // so the dispatcher resolves credential_id from the vault on the very
    // first execution. Only on a fresh create — re-builds keep whatever
    // Settings has configured. Best-effort: a failure here doesn't block
    // the build (the persona still exists; channels can be set later via
    // Settings → Notifications).
    if (wasFreshCreate) {
      const channels = glyphQuickConfigRef.current.notificationChannels;
      if (channels.length > 0) {
        try {
          await updatePersona(
            personaId,
            buildUpdateInput({
              notification_channels: JSON.stringify(channels),
            }),
          );
        } catch (err) {
          logger.warn("Failed to persist notification channels", { error: err });
        }
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
    } catch (err) { silentCatch("features/agents/components/matrix/UnifiedBuildEntry:catch4")(err); }

    try {
      // Mode resolution priority: Companion prefill mode (most deliberate
      // signal — the chat just selected it) > local toggle > default
      // interactive. The toggle is only consulted when no prefill set the
      // mode, so Companion-driven launches keep their intent regardless
      // of any stale local toggle state.
      const resolvedMode: 'interactive' | 'one_shot' | null =
        pendingBuildModeRef.current ?? (oneShotEnabledRef.current ? 'one_shot' : null);
      await build.handleGenerate(
        trimmed,
        personaId,
        workflowJson ?? undefined,
        parserResultJson ?? undefined,
        resolvedMode,
        pendingCompanionSessionIdRef.current,
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
      } catch (err) { silentCatch("features/agents/components/matrix/UnifiedBuildEntry:catch5")(err); }
      try {
        await deletePersona(personaId);
      } catch (err) { silentCatch("features/agents/components/matrix/UnifiedBuildEntry:catch6")(err); }
      // Don't call setDraftPersonaId(null) — that calls resetBuildSession()
      // unconditionally, which would wipe whatever session is currently active
      // (potentially a *different* persona's in-progress build that the user
      // had open in another tab or restored from hydration). Instead, find the
      // build session for *this* failed launch's persona and remove only that.
      const buildState = useAgentStore.getState();
      const failedSessionEntry = Object.entries(buildState.buildSessions).find(
        ([, sess]) => sess.personaId === personaId,
      );
      if (failedSessionEntry) {
        buildState.removeBuildSession(failedSessionEntry[0]);
      }
    } finally {
      setIsLaunching(false);
    }
  }, [build, isLaunching, draftPersonaId, createPersona, setDraftPersonaId, t.agents.matrix_entry.failed_to_create, deletePersona]); // intentText read via ref

  // Phase F: if a prefill carried `autoLaunch`, fire handleLaunch once
  // intent is non-empty and we're not already mid-launch. The ref
  // guard prevents re-firing on subsequent renders.
  useEffect(() => {
    if (
      pendingAutoLaunchRef.current &&
      intentText.trim() &&
      !isLaunching
    ) {
      pendingAutoLaunchRef.current = false;
      void handleLaunch();
    }
  }, [intentText, isLaunching, handleLaunch]);

  // 2026-05-05 — handleApplyEdits / handleDiscardEdits removed alongside
  // the legacy 8-dimension matrix view. Both were only consumed by
  // PersonaMatrix's inline cell editor; the Glyph-based layouts edit
  // capabilities through the Refine composer instead.

  // -- Derived props -------------------------------------------------------

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

  // -- Build mode toggle (interactive vs autonomous one-shot) -------------
  // 2026-05-06 — explicit user opt-in for autonomous builds. Defaults off
  // so the questionnaire flow stays the discoverable default. When on, the
  // launch wires `mode: "one_shot"` into start_build_session: gates skip
  // clarifying questions, the runner hands off to the post-draft
  // orchestrator on DraftReady, and the user gets an OS notification +
  // bell entry on the terminal phase rather than a questionnaire.
  const [oneShotEnabled, setOneShotEnabled] = useState(false);
  const oneShotEnabledRef = useRef(false);
  oneShotEnabledRef.current = oneShotEnabled;

  // Glyph Full reads the same buildDraft as the adoption flow, so the shared
  // chronology builder produces the rows without any edit-mode-specific shim.
  const glyphRows = useUseCaseChronology();

  // Glyph Full owns its own DimensionQuickConfig state so we can append the
  // serialized config to intent at launch time — mirrors what PersonaMatrix
  // does internally for its pre-build quick setup.
  const [, setGlyphQuickConfig] = useState<QuickConfigState>({
    frequency: null, days: ['mon'], monthDay: 1, time: '09:00',
    selectedConnectors: [], connectorTables: {}, selectedEvents: [],
    notificationChannels: [],
  });
  const glyphQuickConfigRef = useRef<QuickConfigState>({
    frequency: null, days: ['mon'], monthDay: 1, time: '09:00',
    selectedConnectors: [], connectorTables: {}, selectedEvents: [],
    notificationChannels: [],
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
      className="flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden transition-opacity duration-400 ease-out"
      style={{ opacity: fadeOut ? 0 : 1 }}
    >
      <ContentHeader
        title={t.agents.matrix_entry.header_title}
        subtitle={
          agentName && agentName !== 'New Agent'
            ? `${t.agents.matrix_entry.header_subtitle_editing.replace('{name}', agentName)}`
            : t.agents.matrix_entry.header_subtitle_new
        }
      />

      <div className="flex-1 min-h-0 flex flex-col w-full px-4 md:px-6 xl:px-8 pt-4">
      {/* 2026-05-06 — inline GlyphQuestionPanel removed. Both remaining
          layouts (glyph-full and composer-prototype) host Q&A through the
          GlyphAnswerCard overlay on the sigil; the inline panel was a
          legacy surface for the now-deleted 8-dimension matrix and ran
          duplicated against the overlay in the prototype. */}

      {/* Layout toggle — two modes: glyph-full and composer-prototype. */}
      <div
        className="flex-shrink-0 mb-2 flex justify-end items-center gap-2"
        data-testid="build-layout-toggle"
      >
        <button
          type="button"
          onClick={() => setOneShotEnabled((v) => !v)}
          disabled={isActivelyBuilding}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 typo-caption transition disabled:opacity-50 disabled:cursor-not-allowed ${
            oneShotEnabled
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-border/30 bg-secondary/20 text-foreground hover:text-foreground"
          }`}
          title={
            oneShotEnabled
              ? "One-shot is on. Launching will let the AI decide every gate; you'll get a notification when it's ready."
              : "Turn on one-shot to skip the questionnaire — the AI will pick safe defaults and notify you when the build lands."
          }
          data-testid="build-oneshot-toggle"
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              oneShotEnabled ? "bg-primary" : "bg-foreground/30"
            }`}
            aria-hidden
          />
          {oneShotEnabled ? "One-shot: on" : "Let AI decide everything"}
        </button>
        <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
          <button
            type="button"
            onClick={() => handleLayoutChange("glyph-full")}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              layout === "glyph-full"
                ? "bg-primary/20 text-primary"
                : "text-foreground hover:text-foreground"
            }`}
            title={debtText("auto_glyph_full_sigil_first_flagship_build_surf_61b25b83")}
            data-testid="build-layout-toggle-glyph-full"
          >
            <DebtText k="auto_glyph_full_a4abca63" />
          </button>
          <button
            type="button"
            onClick={() => handleLayoutChange("composer-prototype")}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              layout === "composer-prototype"
                ? "bg-primary/20 text-primary"
                : "text-foreground hover:text-foreground"
            }`}
            title={debtText("auto_composer_prototype_periphery_connectors_ce_1a3d8c28")}
            data-testid="build-layout-toggle-prototype"
          >
            <DebtText k="auto_composer_prototype_9b50c4fd" />
          </button>
        </div>
      </div>

      {layout === "composer-prototype" ? (
        <GlyphPrototypeLayout
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
          toolTestResults={lifecycle.buildToolTestResults}
          testSummary={lifecycle.buildTestSummary}
          cliOutputLines={build.outputLines}
          onQuickConfigChange={handleQuickConfigChange}
          onViewAgent={handleViewPromotedAgent}
          buildError={build.buildError}
          initialNotificationChannels={initialNotificationChannels ?? undefined}
        />
      ) : (
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
          toolTestResults={lifecycle.buildToolTestResults}
          testSummary={lifecycle.buildTestSummary}
          cliOutputLines={build.outputLines}
          onQuickConfigChange={handleQuickConfigChange}
          onViewAgent={handleViewPromotedAgent}
          buildError={build.buildError}
          initialNotificationChannels={initialNotificationChannels ?? undefined}
        />
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
    </div>
  );
}
