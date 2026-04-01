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
import { Grid3X3, Gem, Ruler } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import type { ThemeId } from "@/stores/themeStore";
import { useMatrixBuild } from "@/features/agents/components/matrix/useMatrixBuild";
import { useMatrixLifecycle } from "@/features/agents/components/matrix/useMatrixLifecycle";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import type { TransformQuestionResponse } from "@/api/templates/n8nTransform";

interface MatrixAdoptionViewProps {
  review: PersonaDesignReview;
  onClose: () => void;
  onPersonaCreated: () => void;
}

type CellDataMap = Record<string, { items?: string[]; summary?: string; raw?: Record<string, unknown> }>;

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
      return desc ? `${name} — ${desc.slice(0, 120)}` : name;
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
    const items = triggers.map((t) => { const o = t as Record<string, unknown>; const type = String(o.trigger_type ?? "manual"); const desc = String(o.description ?? ""); return desc ? `${type}: ${desc}` : type; });
    const structured = triggers.map((t) => { const o = t as Record<string, unknown>; return { trigger_type: String(o.trigger_type ?? "manual"), config: (o.config ?? {}) as Record<string, string>, description: String(o.description ?? "") }; });
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

  // Error handling — parse bullet points (-/*) or bold headers (**)
  const sp = d.structured_prompt as Record<string, unknown> | undefined;
  if (sp?.errorHandling && typeof sp.errorHandling === "string") {
    const ehText = sp.errorHandling as string;
    // Try bullet lines first, then bold headers
    let lines = ehText.split("\n").filter((l) => l.trim().startsWith("-") || (l.trim().startsWith("*") && !l.trim().startsWith("**")));
    if (lines.length === 0) {
      // Fall back to **bold** section headers
      lines = ehText.split("\n").filter((l) => /^\*\*[^*]+\*\*/.test(l.trim()));
    }
    data["error-handling"] = { items: lines.length > 0 ? lines.map((l) => l.replace(/^[\s\-*]+/, "").replace(/\*\*/g, "").trim()).slice(0, 6) : ["Default error handling"] };
  } else {
    data["error-handling"] = { items: ["Default error handling"] };
  }

  // Events
  const events = ((d.suggested_event_subscriptions ?? []) as unknown[]);
  data["events"] = { items: events.length > 0 ? events.map((e) => { const o = e as Record<string, unknown>; return `${o.event_type ?? "event"}: ${o.description ?? ""}`; }) : ["No event subscriptions"] };

  return data;
}

// -- Matrix variant tab switcher types --
type MatrixVariant = "original" | "glass" | "blueprint";
const MATRIX_VARIANTS: { key: MatrixVariant; label: string; icon: React.ElementType }[] = [
  { key: "original", label: "Grid", icon: Grid3X3 },
  { key: "glass", label: "Glass", icon: Gem },
  { key: "blueprint", label: "Blueprint", icon: Ruler },
];

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

  // Transition to draft_ready when questions are completed
  useEffect(() => {
    if (!questionsComplete || !seeded) return;
    useAgentStore.setState({ buildPhase: "draft_ready" });
  }, [questionsComplete, seeded]);

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

        // Create an adoption build session so test_build_draft can work
        const agentIrJson = JSON.stringify(designResult);
        const sessionId = await invokeWithTimeout<string>("create_adoption_session", {
          personaId: persona.id,
          intent: review.instruction || templateName,
          agentIrJson,
        });

        useAgentStore.setState({
          buildPersonaId: persona.id,
          buildSessionId: sessionId,
          buildPhase: hasAdoptionQuestions && !questionsComplete ? "awaiting_input" : "draft_ready",
          buildCellStates: cellStates,
          buildCellData: dimensionData,
          buildDraft: designResult,
        });
        setSeeded(true);
      } catch (err) {
        logger.error("Failed to create draft persona for adoption", { err });
      }
    })();
  }, [designResult, templateName, review.instruction, createPersona]);

  const build = useMatrixBuild({ personaId });
  const lifecycle = useMatrixLifecycle({ personaId });

  // -- Post-promotion: navigate to the promoted agent with fade transition --

  const handleViewAgent = useCallback(() => {
    if (!personaId) return;

    setFadeOut(true);
    setTimeout(() => {
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
      useAgentStore.setState({ buildCellData: dimensionData, buildDraft: designResult });
    }
  }, [designResult]);

  if (!seeded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground/50 animate-pulse">Loading template into matrix...</div>
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden px-4 pt-2 transition-opacity duration-400 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      {/* Matrix variant tab switcher */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
          {MATRIX_VARIANTS.map((v) => {
            const VIcon = v.icon;
            return (
              <button
                key={v.key}
                onClick={() => setMatrixVariant(v.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  matrixVariant === v.key
                    ? "bg-white/[0.08] text-foreground shadow-sm"
                    : "text-muted-dark hover:text-foreground/70 hover:bg-white/[0.04]"
                }`}
              >
                <VIcon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] text-muted-foreground/30 uppercase tracking-wider">Matrix View</span>
      </div>

      {/* Matrix variant rendering */}
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
