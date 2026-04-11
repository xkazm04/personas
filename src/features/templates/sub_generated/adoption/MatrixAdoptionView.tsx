/**
 * Matrix-based template adoption — seeds PersonaMatrix cells from a template's
 * design_result, letting the user review/edit all 8 dimensions before creating.
 *
 * This replaces the 5-step wizard with a single-screen matrix experience.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { createLogger } from "@/lib/log";

const logger = createLogger("template-adoption");
import { PersonaMatrix } from "../gallery/matrix/PersonaMatrix";
import { PersonaMatrixGlass } from "./PersonaMatrixGlass";
import { PersonaMatrixBlueprint } from "./PersonaMatrixBlueprint";
import { QuestionnaireFormGrid } from "./QuestionnaireFormGrid";
import { useThemeStore } from "@/stores/themeStore";
import type { ThemeId } from "@/stores/themeStore";
import { useMatrixBuild } from "@/features/agents/components/matrix/useMatrixBuild";
import { useMatrixLifecycle } from "@/features/agents/components/matrix/useMatrixLifecycle";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import type { TransformQuestionResponse } from "@/api/templates/n8nTransform";
import { useTranslation } from '@/i18n/useTranslation';

interface MatrixAdoptionViewProps {
  review: PersonaDesignReview;
  onClose: () => void;
  onPersonaCreated: () => void;
}

type CellDataMap = Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }>;

/** Normalize trigger type aliases to the canonical enum values the backend expects. */
const TRIGGER_TYPE_ALIASES: Record<string, string> = {
  event: "event_listener", event_bus: "event_listener", event_sub: "event_listener", event_subscription: "event_listener",
  cron: "schedule", scheduled: "schedule", timer: "schedule",
  poll: "polling", hook: "webhook", http: "webhook", web_hook: "webhook",
  watcher: "file_watcher", fs_watcher: "file_watcher", watch: "file_watcher",
  focus: "app_focus", window_focus: "app_focus",
};
function normalizeTriggerType(raw: string): string {
  return TRIGGER_TYPE_ALIASES[raw] ?? raw;
}

/** Extract dimension items from an AgentIR design result. Works with loose shapes. */
function extractDimensionData(ir: unknown): CellDataMap {
  const d = ir as Record<string, unknown>;
  const data: CellDataMap = {};

  // Use cases — check use_cases first, fall back to use_case_flows
  let useCases = (d.use_cases ?? (d.design_context as Record<string, unknown> | undefined)?.use_cases ?? []) as unknown[];
  if (useCases.length === 0) {
    const flows = ((d.use_case_flows ?? []) as Record<string, unknown>[]);
    useCases = flows.map((f) => ({ name: f.name, description: f.description }));
  }
  if (useCases.length > 0) {
    data["use-cases"] = { items: useCases.map((uc) => {
      if (typeof uc === "string") return uc;
      const o = uc as Record<string, unknown>;
      const name = String(o.name ?? o.title ?? uc);
      const desc = o.description ? String(o.description) : "";
      return desc ? `${name}: ${desc}` : name;
    }) };
  }

  // Connectors
  const connectors = ((d.suggested_connectors ?? d.required_connectors ?? []) as unknown[]);
  if (connectors.length > 0) {
    const items = connectors.map((c) => { const o = c as Record<string, unknown>; return `${o.name ?? "unknown"} — ${o.purpose ?? o.description ?? ""}`; });
    const structured = connectors.map((c) => {
      const o = c as Record<string, unknown>;
      return { name: String(o.name ?? ""), service_type: String(o.service_type ?? o.n8n_credential_type ?? o.name ?? ""), purpose: String(o.purpose ?? o.description ?? ""), has_credential: Boolean(o.has_credential) };
    });
    data["connectors"] = { items, raw: { connectors: structured, alternatives: {} } };
  }

  // Triggers
  const triggers = ((d.suggested_triggers ?? d.triggers ?? []) as unknown[]);
  if (triggers.length > 0) {
    const items = triggers.map((t) => { const o = t as Record<string, unknown>; const type = normalizeTriggerType(String(o.trigger_type ?? "manual")); const desc = String(o.description ?? ""); return desc ? `${type}: ${desc}` : type; });
    const structured = triggers.map((t) => { const o = t as Record<string, unknown>; return { trigger_type: normalizeTriggerType(String(o.trigger_type ?? "manual")), config: (o.config ?? {}) as Record<string, string>, description: String(o.description ?? "") }; });
    data["triggers"] = { items, raw: { triggers: structured } };
  }

  // Messages
  const channels = ((d.suggested_notification_channels ?? []) as unknown[]);
  if (channels.length > 0) {
    data["messages"] = { items: channels.map((ch) => { const o = ch as Record<string, unknown>; return `${o.type ?? "built-in"}: ${o.description ?? "notifications"}`; }) };
  }

  // Human review
  const caps = ((d.protocol_capabilities ?? []) as unknown[]);
  const reviewCaps = caps.filter((c) => (c as Record<string, unknown>).type === "manual_review");
  data["human-review"] = { items: reviewCaps.length > 0 ? reviewCaps.map((c) => String((c as Record<string, unknown>).context ?? "Review required")) : ["Not required — fully automated"] };

  // Memory
  const memoryCaps = caps.filter((c) => (c as Record<string, unknown>).type === "agent_memory");
  data["memory"] = { items: memoryCaps.length > 0 ? memoryCaps.map((c) => String((c as Record<string, unknown>).context ?? "Memory enabled")) : ["Stateless — no memory between runs"] };

  // Error handling — parse structured sections with title: description syntax
  const sp = d.structured_prompt as Record<string, unknown> | undefined;
  if (sp?.errorHandling && typeof sp.errorHandling === "string") {
    const ehText = sp.errorHandling as string;
    const allLines = ehText.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed: string[] = [];
    // Look for **Header** followed by description lines, or "- item" bullets
    for (let i = 0; i < allLines.length && parsed.length < 6; i++) {
      const line = allLines[i]!;
      const boldMatch = line.match(/^\*\*([^*]+)\*\*[:\s]*(.*)/);
      if (boldMatch) {
        const title = boldMatch[1]!.trim();
        // Collect description from the rest of this line + next non-header lines
        const descParts: string[] = [];
        if (boldMatch[2]?.trim()) descParts.push(boldMatch[2].trim());
        while (i + 1 < allLines.length && !allLines[i + 1]!.startsWith("**") && !allLines[i + 1]!.startsWith("- ")) {
          i++;
          descParts.push(allLines[i]!.replace(/^[\s\-*]+/, "").trim());
        }
        const desc = descParts.join(" ");
        parsed.push(desc ? `${title}: ${desc}` : title);
      } else if (line.startsWith("-") || line.startsWith("*")) {
        parsed.push(line.replace(/^[\s\-*]+/, "").trim());
      }
    }
    data["error-handling"] = { items: parsed.length > 0 ? parsed : ["Default error handling"] };
  } else {
    data["error-handling"] = { items: ["Default error handling"] };
  }

  // Events
  const events = ((d.suggested_event_subscriptions ?? []) as unknown[]);
  data["events"] = { items: events.length > 0 ? events.map((e) => { const o = e as Record<string, unknown>; return `${o.event_type ?? "event"}: ${o.description ?? ""}`; }) : ["No event subscriptions"] };

  return data;
}

// -- Matrix variant (switcher removed; kept for potential future re-enable) --
type MatrixVariant = "original" | "glass" | "blueprint";

/** Map themes to their preferred matrix visual variant. */
const THEME_VARIANT_MAP: Partial<Record<ThemeId, MatrixVariant>> = {
  "light-ice": "glass",
  "dark-red": "glass",
  "dark-cyan": "glass",
  "light-news": "blueprint",
  "dark-frost": "blueprint",
  "dark-matrix": "blueprint",
};

function getThemeVariant(themeId: ThemeId): MatrixVariant {
  return THEME_VARIANT_MAP[themeId] ?? "original";
}

export function MatrixAdoptionView({ review, onClose, onPersonaCreated }: MatrixAdoptionViewProps) {
  const { t } = useTranslation();
  const [seeded, setSeeded] = useState(false);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [fadeOut, setFadeOut] = useState(false);
  const themeId = useThemeStore((s) => s.themeId);
  const [matrixVariant, setMatrixVariant] = useState<MatrixVariant>(() => getThemeVariant(themeId));

  // Sync variant when theme changes
  useEffect(() => {
    setMatrixVariant(getThemeVariant(themeId));
  }, [themeId]);
  const createPersona = useAgentStore((s) => s.createPersona);
  const seedDone = useRef(false);

  // Parse design result from the template
  const designResult: Record<string, unknown> | null = (() => {
    if (!review.design_result) return null;
    try {
      return JSON.parse(review.design_result) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const templateName = review.test_case_name ?? "Template";

  // Adoption questions from template
  const adoptionQuestions = (designResult?.adoption_questions ?? []) as TransformQuestionResponse[];
  const hasAdoptionQuestions = adoptionQuestions.length > 0;
  const [adoptionAnswers, setAdoptionAnswers] = useState<Record<string, string>>({});
  const [questionsComplete, setQuestionsComplete] = useState(false);
  const defaultsLoaded = useRef(false);

  // Pre-populate default answers from template questions
  useEffect(() => {
    if (!hasAdoptionQuestions || defaultsLoaded.current) return;
    defaultsLoaded.current = true;
    const defaults: Record<string, string> = {};
    for (const q of adoptionQuestions) {
      if (q.default) defaults[q.id] = String(q.default);
    }
    if (Object.keys(defaults).length > 0) setAdoptionAnswers(defaults);
  }, [hasAdoptionQuestions, adoptionQuestions]);

  // When questions are completed, store answers in the build draft and transition to draft_ready.
  // Adoption sessions are pre-designed templates — they don't have active LLM build tasks,
  // so we skip the refinement call and apply answers directly as parameter overrides.
  // Guard: never overwrite a more advanced phase (testing, test_complete, promoted).
  useEffect(() => {
    if (!questionsComplete || !seeded) return;

    const currentPhase = useAgentStore.getState().buildPhase;
    // Don't regress phase if a test or promotion is already in progress
    if (currentPhase === "testing" || currentPhase === "test_complete" || currentPhase === "promoted") return;

    // Merge adoption answers into the build draft as parameter overrides
    const currentDraft = useAgentStore.getState().buildDraft as Record<string, unknown> | null;
    if (currentDraft && Object.keys(adoptionAnswers).length > 0) {
      const answerMap: Record<string, string> = {};
      for (const q of adoptionQuestions) {
        if (adoptionAnswers[q.id]) answerMap[q.id] = adoptionAnswers[q.id]!;
      }
      useAgentStore.getState().patchActiveSession({
        draft: { ...currentDraft, _adoption_answers: answerMap },
        phase: "draft_ready",
      });
    } else {
      useAgentStore.getState().patchActiveSession({ phase: "draft_ready" });
    }
  }, [questionsComplete, seeded, adoptionAnswers, adoptionQuestions]);

  // Seed the matrix cells from the template on first render
  useEffect(() => {
    if (seedDone.current || !designResult) return;
    seedDone.current = true;

    const dimensionData = extractDimensionData(designResult);
    const cellStates: Record<string, CellBuildStatus> = {};
    for (const key of Object.keys(dimensionData)) {
      cellStates[key] = "resolved";
    }

    // Create a draft persona for this adoption
    (async () => {
      try {
        const name = (designResult as Record<string, unknown>).name as string ?? templateName;
        const persona = await createPersona({
          name: name.slice(0, 60),
          description: review.instruction?.slice(0, 200) ?? undefined,
          system_prompt: "You are a helpful AI assistant.",
        });
        setPersonaId(persona.id);

        // Create an adoption build session so test_build_draft can work.
        // Pass resolvedCellsJson so hydrateBuildSession restores populated cells.
        const agentIrJson = JSON.stringify(designResult);
        const resolvedCellsJson = JSON.stringify(dimensionData);
        const sessionId = await invokeWithTimeout<string>("create_adoption_session", {
          personaId: persona.id,
          intent: review.instruction || templateName,
          agentIrJson,
          resolvedCellsJson,
        });

        // Register the adoption session in buildSessions via hydrateBuildSession.
        // This creates the session slot in the map (required by multi-draft slice)
        // AND mirrors the scalars automatically. Building a PersistedBuildSession
        // shaped object lets us reuse the existing hydration path.
        const initialPhase = hasAdoptionQuestions && !questionsComplete ? "awaiting_input" : "draft_ready";
        const resolvedCellsForHydration: Record<string, unknown> = {};
        for (const [key, cellValue] of Object.entries(dimensionData)) {
          resolvedCellsForHydration[key] = cellValue;
        }
        useAgentStore.getState().hydrateBuildSession({
          id: sessionId,
          personaId: persona.id,
          phase: initialPhase,
          resolvedCells: resolvedCellsForHydration,
          pendingQuestion: null,
          agentIr: designResult,
          intent: review.instruction || templateName,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        });

        // Register process activity for the adoption flow
        try {
          const { useOverviewStore } = await import("@/stores/overviewStore");
          const initialStatus = hasAdoptionQuestions && !questionsComplete ? 'input_required' as const : 'running' as const;
          const initialEvent = hasAdoptionQuestions && !questionsComplete ? 'Adoption questions need answers' : 'Draft ready';
          useOverviewStore.getState().processStarted(
            'template_adopt',
            persona.id,
            `Adopt: ${name.slice(0, 40)}`,
            { section: 'personas', tab: 'matrix', personaId: persona.id },
          );
          if (initialStatus !== 'running') {
            useOverviewStore.getState().updateProcessStatus(
              'template_adopt', initialStatus,
              { lastEvent: initialEvent, runId: persona.id },
            );
          }
        } catch { /* best-effort */ }

        // Show progress dot on design-reviews sidebar
        useSystemStore.getState().setTemplateAdoptActive(true);

        setSeeded(true);
      } catch (err) {
        logger.error("Failed to create draft persona for adoption", { err });
      }
    })();
  }, [designResult, templateName, review.instruction, createPersona]);

  const build = useMatrixBuild({ personaId });
  const lifecycle = useMatrixLifecycle({ personaId });

  // -- Sync build phase → process activity status --
  const currentBuildPhase = useAgentStore((s) => s.buildPhase);

  // -- Auto-test on draft_ready when no pending questions -----------------
  // Adoption seeds the matrix to draft_ready immediately. Once any adoption
  // questions are answered (or none exist), kick off the test automatically.
  // If conditions aren't met (questions pending, errors), manual button remains.
  const autoTestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seeded || !personaId) return;
    if (currentBuildPhase !== 'draft_ready') return;
    if (autoTestedRef.current === personaId) return;
    if (hasAdoptionQuestions && !questionsComplete) return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.buildError) return;
    autoTestedRef.current = personaId;
    void lifecycle.handleStartTest();
  }, [seeded, personaId, currentBuildPhase, hasAdoptionQuestions, questionsComplete, build.pendingQuestions, build.buildError, lifecycle]);
  useEffect(() => {
    if (!seeded || !personaId) return;
    // Terminal phases: end the process activity
    if (currentBuildPhase === 'promoted' || currentBuildPhase === 'failed' || currentBuildPhase === 'cancelled') {
      const action = currentBuildPhase === 'promoted' ? 'completed' as const : 'failed' as const;
      void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
        useOverviewStore.getState().processEnded('template_adopt', action, personaId);
      }).catch(() => {});
      useSystemStore.getState().setTemplateAdoptActive(false);
      return;
    }
    const phaseMap: Record<string, { status: ActiveProcess["status"]; event: string }> = {
      'awaiting_input': { status: 'input_required', event: 'Waiting for answers' },
      'analyzing': { status: 'running', event: 'Analyzing...' },
      'resolving': { status: 'running', event: 'Building agent...' },
      'draft_ready': { status: 'running', event: 'Draft ready — test & promote' },
      'testing': { status: 'running', event: 'Testing agent...' },
      'test_complete': { status: 'running', event: 'Test complete — approve to promote' },
    };
    const mapped = phaseMap[currentBuildPhase ?? ''];
    if (!mapped) return;
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      useOverviewStore.getState().updateProcessStatus(
        'template_adopt', mapped.status,
        { lastEvent: mapped.event, runId: personaId },
      );
    }).catch(() => {});
  }, [currentBuildPhase, seeded, personaId]);

  // -- Post-promotion: navigate to the promoted agent with fade transition --

  const handleViewAgent = useCallback(() => {
    if (!personaId) return;

    setFadeOut(true);
    setTimeout(() => {
      // Remove the process activity from the drawer
      try {
        void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
          useOverviewStore.getState().processEnded('template_adopt', 'completed', personaId);
        });
      } catch { /* best-effort */ }
      useSystemStore.getState().setTemplateAdoptActive(false);

      // Reset build state
      useAgentStore.getState().resetBuildSession();

      // Navigate to the promoted agent
      useAgentStore.getState().selectPersona(personaId);
      useAgentStore.getState().fetchPersonas();
      useSystemStore.getState().setEditorTab('matrix');

      // Close the adoption modal
      onPersonaCreated();
    }, 400);
  }, [personaId, onPersonaCreated]);

  // Auto-redirect after promotion (matches UnifiedMatrixEntry behavior)
  const buildPhaseForRedirect = useAgentStore((s) => s.buildPhase);
  useEffect(() => {
    if (buildPhaseForRedirect === 'promoted' && personaId && !fadeOut) {
      const timer = setTimeout(() => handleViewAgent(), 1500);
      return () => clearTimeout(timer);
    }
  }, [buildPhaseForRedirect, personaId, fadeOut, handleViewAgent]);

  const handleApplyEdits = useCallback(async () => {
    const store = useAgentStore.getState();
    if (!store.buildEditDirty) return;
    const parts: string[] = [];
    for (const [key, data] of Object.entries(store.buildCellData)) {
      if (data?.items?.length) parts.push(`[${key}]: ${data.items.join("; ")}`);
    }
    if (parts.length > 0) {
      await lifecycle.handleRefine(`User edited template dimensions:\n${parts.join("\n")}\nUpdate agent_ir accordingly.`);
    }
    store.clearEditDirty();
  }, [lifecycle]);

  const handleDiscardEdits = useCallback(() => {
    const store = useAgentStore.getState();
    store.clearEditDirty();
    // Re-seed from template
    if (designResult) {
      const dimensionData = extractDimensionData(designResult);
      store.patchActiveSession({ cellData: dimensionData, draft: designResult });
    }
  }, [designResult]);

  if (!seeded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground/50 animate-pulse">{t.templates.adopt_modal.loading_template}</div>
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-auto px-4 pt-2 transition-opacity duration-400 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      {/* Matrix variant rendering — always the grid variant (switcher hidden) */}
      {matrixVariant === "original" && (
        <PersonaMatrix
          designResult={null}
          variant="creation"
          hideHeader
          completeness={build.completeness}
          isRunning={build.isBuilding}
          buildLocked={false}
          cellBuildStates={build.cellStates}
          pendingQuestions={build.pendingQuestions}
          onAnswerBuildQuestion={build.handleAnswer}
          hasDesignResult={build.buildPhase === "draft_ready" || build.buildPhase === "test_complete" || build.buildPhase === "promoted"}
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
          onViewAgent={handleViewAgent}
          buildActivity={build.buildActivity}
          onApplyEdits={handleApplyEdits}
          onDiscardEdits={handleDiscardEdits}
          onSubmitAllAnswers={build.handleSubmitAnswers}
        />
      )}
      {matrixVariant === "glass" && (
        <PersonaMatrixGlass
          buildPhase={build.buildPhase}
          completeness={build.completeness}
          isRunning={build.isBuilding}
          cellBuildStates={build.cellStates}
          buildActivity={build.buildActivity}
          onStartTest={lifecycle.handleStartTest}
          onApproveTest={lifecycle.handlePromote}
          onViewAgent={handleViewAgent}
        />
      )}
      {matrixVariant === "blueprint" && (
        <PersonaMatrixBlueprint
          buildPhase={build.buildPhase}
          completeness={build.completeness}
          isRunning={build.isBuilding}
          cellBuildStates={build.cellStates}
          buildActivity={build.buildActivity}
          onStartTest={lifecycle.handleStartTest}
          onApproveTest={lifecycle.handlePromote}
          onViewAgent={handleViewAgent}
        />
      )}

      {/* Adoption questions — FormGrid variant */}
      {hasAdoptionQuestions && !questionsComplete && seeded && (
        <QuestionnaireFormGrid
          questions={adoptionQuestions}
          userAnswers={adoptionAnswers}
          onAnswerUpdated={(id, answer) => setAdoptionAnswers((prev) => ({ ...prev, [id]: answer }))}
          onSubmit={() => setQuestionsComplete(true)}
          onClose={onClose}
        />
      )}
    </div>
  );
}
