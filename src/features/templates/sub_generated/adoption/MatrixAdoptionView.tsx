/**
 * Matrix-based template adoption — seeds PersonaMatrix cells from a template's
 * design_result, letting the user review/edit all 8 dimensions before creating.
 *
 * This replaces the 5-step wizard with a single-screen matrix experience.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { PersonaMatrix } from "../gallery/matrix/PersonaMatrix";
import { useMatrixBuild } from "@/features/agents/components/matrix/useMatrixBuild";
import { useMatrixLifecycle } from "@/features/agents/components/matrix/useMatrixLifecycle";
import { useAgentStore } from "@/stores/agentStore";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { CellBuildStatus } from "@/lib/types/buildTypes";

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

  // Use cases
  const useCases = (d.use_cases ?? (d.design_context as Record<string, unknown> | undefined)?.use_cases ?? []) as unknown[];
  if (useCases.length > 0) {
    data["use-cases"] = { items: useCases.map((uc) => typeof uc === "string" ? uc : String((uc as Record<string, unknown>)?.name ?? uc)) };
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

  // Error handling
  const sp = d.structured_prompt as Record<string, unknown> | undefined;
  if (sp?.errorHandling && typeof sp.errorHandling === "string") {
    const lines = (sp.errorHandling as string).split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"));
    data["error-handling"] = { items: lines.length > 0 ? lines.map((l) => l.replace(/^[\s\-*]+/, "").trim()).slice(0, 6) : ["Default error handling"] };
  } else {
    data["error-handling"] = { items: ["Default error handling"] };
  }

  // Events
  const events = ((d.suggested_event_subscriptions ?? []) as unknown[]);
  data["events"] = { items: events.length > 0 ? events.map((e) => { const o = e as Record<string, unknown>; return `${o.event_type ?? "event"}: ${o.description ?? ""}`; }) : ["No event subscriptions"] };

  return data;
}

export function MatrixAdoptionView({ review }: MatrixAdoptionViewProps) {
  const [seeded, setSeeded] = useState(false);
  const [personaId, setPersonaId] = useState<string | null>(null);
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
        useAgentStore.setState({
          buildPersonaId: persona.id,
          buildPhase: "draft_ready",
          buildCellStates: cellStates,
          buildCellData: dimensionData,
          buildDraft: designResult,
        });
        setSeeded(true);
      } catch (err) {
        console.error("Failed to create draft persona for adoption:", err);
      }
    })();
  }, [designResult, templateName, review.instruction, createPersona]);

  const build = useMatrixBuild({ personaId });
  const lifecycle = useMatrixLifecycle({ personaId });

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
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-hidden px-4 pt-2">
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
        buildActivity={build.buildActivity}
        onApplyEdits={handleApplyEdits}
        onDiscardEdits={handleDiscardEdits}
        onSubmitAllAnswers={build.handleSubmitAnswers}
      />
    </div>
  );
}
