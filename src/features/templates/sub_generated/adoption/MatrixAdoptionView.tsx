/**
 * Matrix-based template adoption — seeds PersonaMatrix cells from a template's
 * design_result, letting the user review/edit all 8 dimensions before creating.
 *
 * This replaces the 5-step wizard with a single-screen matrix experience.
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { createLogger } from "@/lib/log";
import { useVaultStore } from "@/stores/vaultStore";

const logger = createLogger("template-adoption");
import { PersonaMatrix } from "../gallery/matrix/PersonaMatrix";
import { PersonaMatrixGlass } from "./PersonaMatrixGlass";
import { PersonaMatrixBlueprint } from "./PersonaMatrixBlueprint";
import { PersonaChronologyWildcard } from "./chronology/PersonaChronologyWildcard";
import { PersonaChronologyGlyph } from "./chronology/PersonaChronologyGlyph";
import { PersonaChronologyGlyphWide } from "./chronology/PersonaChronologyGlyphWide";
import { QuestionnaireFormFocus } from "./QuestionnaireFormFocus";
import { UseCasePickerStep, type UseCaseOption } from "./UseCasePickerStep";
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
import { matchVaultToQuestions } from "../shared/vaultAdoptionMatcher";
import { useDynamicQuestionOptions } from "./useDynamicQuestionOptions";
import { categoryOrderIndex } from "./questionnaireCategoryOrder";
import { useTranslation } from '@/i18n/useTranslation';
import { QuickAddCredentialModal } from "./QuickAddCredentialModal";
import type { TriggerSelection } from "./useCasePickerShared";

interface MatrixAdoptionViewProps {
  review: PersonaDesignReview;
  onClose: () => void;
  /** Called with the promoted persona's ID once adoption completes. */
  onPersonaCreated: (personaId: string) => void;
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

/** Extract dimension items from an AgentIR design result. Works with loose shapes.
 *
 * `credentialBindings` (optional) is a map of connector-name / vault-category →
 * concrete service_type derived from the user's questionnaire picks. When
 * present, each bound connector in `suggested_connectors` / `required_connectors`
 * is rewritten to show the user's chosen service so the Apps & Services matrix
 * cell reflects their selection rather than the template's generic placeholder.
 *
 * `selectedUseCaseIds` (optional) narrows use-case-scoped items (use_cases
 * entries, triggers tied to a specific `use_case_id`) so the matrix reflects
 * the user's capability picks from the first adoption step. When omitted,
 * everything in the template is included.
 */
function extractDimensionData(
  ir: unknown,
  credentialBindings?: Record<string, string>,
  selectedUseCaseIds?: Set<string>,
): CellDataMap {
  const d = ir as Record<string, unknown>;
  const data: CellDataMap = {};
  const ucFilterActive = !!selectedUseCaseIds && selectedUseCaseIds.size > 0;
  const matchesUseCaseFilter = (id: unknown): boolean => {
    if (!ucFilterActive) return true;
    if (id == null || id === "") return true; // untagged items pass through
    return selectedUseCaseIds!.has(String(id));
  };

  // Use cases — check use_cases first, fall back to use_case_flows
  let useCasesRaw = (d.use_cases ?? (d.design_context as Record<string, unknown> | undefined)?.use_cases ?? []) as unknown[];
  if (useCasesRaw.length === 0) {
    const flows = ((d.use_case_flows ?? []) as Record<string, unknown>[]);
    useCasesRaw = flows.map((f) => ({ id: f.id, name: f.name, description: f.description, capability_summary: f.capability_summary }));
  }
  const useCases = ucFilterActive
    ? useCasesRaw.filter((uc) => {
        if (typeof uc === "string") return true;
        const o = uc as Record<string, unknown>;
        return matchesUseCaseFilter(o.id ?? o.use_case_id);
      })
    : useCasesRaw;
  if (useCases.length > 0) {
    data["use-cases"] = { items: useCases.map((uc) => {
      if (typeof uc === "string") return uc;
      const o = uc as Record<string, unknown>;
      const name = String(o.name ?? o.title ?? uc);
      const desc = o.description ? String(o.description) : "";
      return desc ? `${name}: ${desc}` : name;
    }) };
  }

  // Connectors — apply user's credential picks from the questionnaire.
  const connectors = ((d.suggested_connectors ?? d.required_connectors ?? []) as unknown[]);
  if (connectors.length > 0) {
    const rewritten = connectors.map((c) => {
      const o = c as Record<string, unknown>;
      const originalName = String(o.name ?? "");
      // A binding exists if either the connector name OR the service_type
      // matches a key in credentialBindings. Templates may use the vault
      // category (e.g. "ai") or a semantic placeholder (e.g. "image_ai");
      // both should be rewritten to the concrete service_type.
      const boundServiceType =
        credentialBindings?.[originalName] ??
        credentialBindings?.[String(o.service_type ?? "")] ??
        undefined;
      if (boundServiceType) {
        return {
          ...o,
          name: boundServiceType,
          service_type: boundServiceType,
          has_credential: true,
        };
      }
      return o;
    });
    const items = rewritten.map((o) => `${o.name ?? "unknown"} — ${o.purpose ?? o.description ?? ""}`);
    const structured = rewritten.map((o) => ({
      name: String(o.name ?? ""),
      service_type: String(o.service_type ?? o.n8n_credential_type ?? o.name ?? ""),
      purpose: String(o.purpose ?? o.description ?? ""),
      has_credential: Boolean(o.has_credential),
    }));
    data["connectors"] = { items, raw: { connectors: structured, alternatives: {} } };
  }

  // Triggers — drop any tied to a disabled use case
  const triggersRaw = ((d.suggested_triggers ?? d.triggers ?? []) as unknown[]);
  const triggers = ucFilterActive
    ? triggersRaw.filter((tr) => matchesUseCaseFilter((tr as Record<string, unknown>).use_case_id))
    : triggersRaw;
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

  // Events — drop subscriptions tied to a disabled use case
  const eventsRaw = ((d.suggested_event_subscriptions ?? []) as unknown[]);
  const events = ucFilterActive
    ? eventsRaw.filter((e) => matchesUseCaseFilter((e as Record<string, unknown>).use_case_id))
    : eventsRaw;
  data["events"] = { items: events.length > 0 ? events.map((e) => { const o = e as Record<string, unknown>; return `${o.event_type ?? "event"}: ${o.description ?? ""}`; }) : ["No event subscriptions"] };

  return data;
}

/**
 * Parse a cron string into a TriggerSelection the UC picker can use as
 * its initial state. Only recognizes the three common v3.1 authoring
 * shapes (hourly, daily, weekly); anything else collapses to "custom"
 * so the user can keep the exact expression.
 */
function inferSelectionFromCron(cron: string): TriggerSelection {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { customCron: cron };
  const [minute, hour, dom, , dow] = parts;
  if (minute === "0" && hour === "*" && dom === "*" && dow === "*") {
    return { time: { preset: "hourly" } };
  }
  const hourNum = parseInt(hour ?? "", 10);
  if (!Number.isNaN(hourNum) && dom === "*") {
    if (dow === "*") return { time: { preset: "daily", hourOfDay: hourNum } };
    const dowNum = parseInt(dow ?? "", 10);
    if (!Number.isNaN(dowNum)) {
      return { time: { preset: "weekly", hourOfDay: hourNum, weekday: dowNum } };
    }
  }
  return { customCron: cron };
}

type TriggerIR = { trigger_type: string; config: Record<string, string>; description: string };

/**
 * Convert a user's TriggerSelection into one or more concrete trigger
 * IRs the persona builder understands. The new dual-family model
 * allows Time AND Event to be active at the same time, so this
 * returns an array:
 *
 *   {}                        → [manual]          (UC runs only when invoked)
 *   {time}                    → [schedule]        (fires on cron)
 *   {event}                   → [event_listener]  (fires on emitted event)
 *   {time, event}             → [schedule, event] (fires on BOTH)
 *   {customCron}              → [schedule]        (template-authored cron kept verbatim)
 *
 * The first element is the "primary" trigger — it's what legacy
 * consumers of suggested_trigger (single-valued) will see. The full
 * array lands on the flat-IR suggested_triggers list so the runtime
 * scheduler can register every trigger the user wanted.
 */
function triggerSelectionToTriggers(sel: TriggerSelection): TriggerIR[] {
  const out: TriggerIR[] = [];

  if (sel.time) {
    const t = sel.time;
    const h = Math.max(0, Math.min(23, t.hourOfDay ?? 9));
    if (t.preset === "daily") {
      out.push({
        trigger_type: "schedule",
        config: { cron: `0 ${h} * * *`, timezone: "local" },
        description: `Daily at ${String(h).padStart(2, "0")}:00 local.`,
      });
    } else if (t.preset === "weekly") {
      const d = Math.max(0, Math.min(6, t.weekday ?? 1));
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      out.push({
        trigger_type: "schedule",
        config: { cron: `0 ${h} * * ${d}`, timezone: "local" },
        description: `Weekly on ${dayNames[d]} at ${String(h).padStart(2, "0")}:00 local.`,
      });
    } else {
      // hourly — hour/weekday are preserved on the selection for
      // round-trip UX, but the cron itself ignores them.
      out.push({
        trigger_type: "schedule",
        config: { cron: "0 * * * *", timezone: "local" },
        description: "Hourly.",
      });
    }
  }

  if (sel.event) {
    const eventType = sel.event.eventType;
    out.push({
      trigger_type: "event_listener",
      config: { event_type: eventType ?? "" },
      description: eventType ? `Listens for ${eventType}.` : "Event-driven.",
    });
  }

  if (out.length === 0) {
    // No Time + no Event — fall back to the template-authored cron if
    // present, else Manual. Preserves the Custom escape hatch.
    const custom = sel.customCron?.trim();
    if (custom) {
      out.push({
        trigger_type: "schedule",
        config: { cron: custom, timezone: "local" },
        description: `Custom cron: ${custom}.`,
      });
    } else {
      out.push({
        trigger_type: "manual",
        config: {},
        description: "Manual — user invokes on demand.",
      });
    }
  }

  return out;
}


/**
 * Return a shallow clone of designResult with each use_cases[i].suggested_trigger
 * overwritten by the user's selection. Also regenerates the top-level
 * suggested_triggers array so consumers that read from either surface
 * (extractDimensionData, the persona builder, matrix cell rendering) see
 * the same user-chosen triggers.
 *
 * Leaves use cases without a selection untouched — manual-only UCs the
 * user never configured stay on their template default.
 */
function applyTriggerSelections(
  designResult: Record<string, unknown>,
  perUseCase: Record<string, TriggerSelection>,
): Record<string, unknown> {
  if (Object.keys(perUseCase).length === 0) return designResult;
  const ucRaw = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
  // Materialize each UC's selection into an array of triggers (Time +
  // Event can both be active). We keep `suggested_trigger` singular for
  // back-compat with consumers that haven't been migrated to the
  // multi-trigger shape, and list every trigger on `suggested_triggers`
  // so the runtime scheduler registers them all.
  const nextUseCases = ucRaw.map((uc) => {
    const id = String(uc.id ?? "");
    const sel = perUseCase[id];
    if (!sel) return uc;
    const triggers = triggerSelectionToTriggers(sel);
    return {
      ...uc,
      suggested_trigger: triggers[0],
      // Expose per-UC additional triggers for downstream consumers that
      // know how to read them. Never present on templates the user
      // left alone (back-compat).
      additional_triggers: triggers.length > 1 ? triggers.slice(1) : undefined,
    };
  });
  // Rebuild the top-level suggested_triggers from every per-UC entry so
  // the flat list consumers see reflects the full set the user picked.
  const nextSuggestedTriggers: Record<string, unknown>[] = [];
  for (const uc of nextUseCases) {
    const id = String(uc.id ?? "");
    const sel = perUseCase[id];
    if (!sel) {
      const trig = uc.suggested_trigger as Record<string, unknown> | undefined;
      if (trig) nextSuggestedTriggers.push({ ...trig, use_case_id: uc.id });
      continue;
    }
    for (const trig of triggerSelectionToTriggers(sel)) {
      nextSuggestedTriggers.push({ ...trig, use_case_id: uc.id });
    }
  }
  return {
    ...designResult,
    use_cases: nextUseCases,
    suggested_triggers: nextSuggestedTriggers,
  };
}

// -- Matrix variant --
// The "chrono-*" variants are experimental prototypes that unify ALL 8
// dimensions into a per-use-case view. Exposed via the in-view tab
// switcher so we can A/B them against each other and the legacy layouts.
type MatrixVariant =
  | "original"
  | "glass"
  | "blueprint"
  | "chrono-wildcard"
  | "chrono-glyph"
  | "chrono-glyph-wide";

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

/** The Wildcard prototype is the go-to multi-use-case view, exposed through
 * the in-view tab switcher alongside the legacy theme-driven variants. */
const CHRONO_TABS: Array<{ id: MatrixVariant; label: string; sub: string }> = [
  { id: "chrono-wildcard", label: "Constellation", sub: "radial · baseline" },
  { id: "chrono-glyph", label: "Glyph", sub: "sigil · full-bleed" },
  { id: "chrono-glyph-wide", label: "Glyph Wide", sub: "sigil · 2-col" },
];

const CHRONO_VARIANTS: ReadonlyArray<MatrixVariant> = [
  "chrono-wildcard",
  "chrono-glyph",
  "chrono-glyph-wide",
];

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
  const templateGoal = (() => {
    const persona = designResult?.persona as Record<string, unknown> | undefined;
    const goal = persona?.goal;
    return typeof goal === 'string' && goal.trim() ? goal.trim() : null;
  })();

  // Adoption questions from template — memoized so dependent hooks (filter,
  // dynamic-options, seed) don't see a new array identity on every render.
  const adoptionQuestions = useMemo<TransformQuestionResponse[]>(
    () => (designResult?.adoption_questions ?? []) as TransformQuestionResponse[],
    [designResult],
  );
  const hasAdoptionQuestions = adoptionQuestions.length > 0;
  const [adoptionAnswers, setAdoptionAnswers] = useState<Record<string, string>>({});
  const [questionsComplete, setQuestionsComplete] = useState(false);
  const [autoDetectedIds, setAutoDetectedIds] = useState<Set<string>>(new Set());
  const defaultsLoaded = useRef(false);

  // Reactive subscription to vault credential service_types — changes here
  // (new credential added via QuickAddCredentialModal, or user returns from
  // the catalog after adding one) flow through and recompute blocked state
  // so tool-picker questions unblock in-place without a reload.
  //
  // We select a sorted array (not a Set) so useShallow can do a cheap
  // element-wise comparison; the Set is rebuilt inside the memo below.
  const credentialServiceTypes = useVaultStore(
    useShallow((s) => {
      const seen = new Set<string>();
      for (const c of s.credentials) seen.add(c.service_type);
      return Array.from(seen).sort();
    }),
  );

  // Block + narrowed-options state, derived from adoptionQuestions × current
  // vault credentials. Recomputes whenever either input changes. Prior
  // implementation stored both in useState and set them inside a one-shot
  // useEffect, which meant adding a credential mid-flow left a question
  // stuck in blocked state until the user reloaded. Derived state fixes that.
  const vaultMatch = useMemo(() => {
    if (!hasAdoptionQuestions) {
      return {
        blockedQuestionIds: new Set<string>(),
        filteredOptions: {} as Record<string, string[]>,
      };
    }
    const typesSet = new Set(credentialServiceTypes);
    const { blockedQuestionIds: blocked, filteredOptions: filtered } =
      matchVaultToQuestions(adoptionQuestions, typesSet);
    return { blockedQuestionIds: blocked, filteredOptions: filtered };
  }, [hasAdoptionQuestions, adoptionQuestions, credentialServiceTypes]);
  const blockedQuestionIds = vaultMatch.blockedQuestionIds;
  const filteredOptions = vaultMatch.filteredOptions;

  // Use-case picker — runs before the questionnaire when the template declares
  // ≥2 use cases (or use_case_flows). User can disable capabilities they don't
  // need; disabled ones are stripped from the downstream questionnaire, the
  // matrix use-cases cell, and any per-use-case triggers / subscriptions.
  const availableUseCases = useMemo<UseCaseOption[]>(() => {
    if (!designResult) return [];
    const fromUseCases = (designResult.use_cases ?? []) as unknown[];
    const primary = Array.isArray(fromUseCases) && fromUseCases.length > 0
      ? fromUseCases
      : (designResult.use_case_flows ?? []) as unknown[];
    const out: UseCaseOption[] = [];
    for (const item of primary) {
      if (typeof item === "string") {
        out.push({ id: item, name: item });
        continue;
      }
      const o = item as Record<string, unknown>;
      const id = String(o.id ?? o.name ?? "").trim();
      if (!id) continue;
      out.push({
        id,
        name: String(o.name ?? o.title ?? id),
        description: typeof o.description === "string" ? o.description : undefined,
        capability_summary: typeof o.capability_summary === "string" ? o.capability_summary : undefined,
      });
    }
    return out;
  }, [designResult]);

  // Always show the UC picker when the template has at least one use case.
  // Single-UC templates still need the step so the user can adjust the
  // trigger composition (daily/weekly/hourly/custom cron) and confirm the
  // capability is enabled — an empty selection should block progression.
  const showUseCasePicker = availableUseCases.length >= 1;
  const [selectedUseCaseIds, setSelectedUseCaseIds] = useState<Set<string>>(
    () => new Set(availableUseCases.map((u) => u.id)),
  );
  // Seed the selection set once the designResult parses (availableUseCases is
  // empty on the first render pass because designResult parse happens inline).
  const useCasesInitialized = useRef(false);
  useEffect(() => {
    if (useCasesInitialized.current) return;
    if (availableUseCases.length === 0) return;
    useCasesInitialized.current = true;
    setSelectedUseCaseIds(new Set(availableUseCases.map((u) => u.id)));
  }, [availableUseCases]);

  const [useCasesPicked, setUseCasesPicked] = useState(false);
  const useCaseStepDone = !showUseCasePicker || useCasesPicked;

  // Trigger composition — merged onto the UC picker page. The user's
  // per-UC selections are materialized onto designResult before the
  // persona is seeded (via applyTriggerSelections). No separate step.
  const [perUseCaseTriggerSelections, setPerUseCaseTriggerSelections] = useState<Record<string, TriggerSelection>>({});
  const triggerSelections = useMemo(
    () => ({ perUseCase: perUseCaseTriggerSelections }),
    [perUseCaseTriggerSelections],
  );

  const triggerComposition = useMemo<"shared" | "per_use_case">(() => {
    const persona = (designResult?.persona ?? {}) as Record<string, unknown>;
    return persona.trigger_composition === "shared" ? "shared" : "per_use_case";
  }, [designResult]);

  // Cross-UC event options — every emit from ANY capability in the
  // template becomes a candidate for event-driven triggers, regardless
  // of whether the emitting UC is currently enabled. Reason: the user
  // may have a capability turned off at adoption time but still want
  // another capability to react if/when it starts firing later (via
  // separate activation, cross-persona events, or re-enabling through
  // settings). Filtering here would silently hide cross-chain options
  // the template explicitly documented.
  const availableEventTypes = useMemo<string[]>(() => {
    if (!designResult) return [];
    const ucs = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
    const out = new Set<string>();
    for (const uc of ucs) {
      const subs = (uc.event_subscriptions ?? []) as Array<Record<string, unknown>>;
      for (const s of subs) {
        if (s.direction === "emit" && typeof s.event_type === "string") {
          out.add(s.event_type);
        }
      }
    }
    return Array.from(out);
  }, [designResult]);

  // Enrich availableUseCases with a defaultSelection inferred from the
  // template's suggested_trigger cron so the combined step shows the
  // author's recommended cadence as the starting state.
  const availableUseCasesWithDefaults = useMemo(() => {
    if (!designResult) return availableUseCases.map((u) => ({ ...u }));
    const raw = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
    const rawById = new Map(raw.map((uc) => [String(uc.id ?? ""), uc]));
    return availableUseCases.map((u) => {
      const rawUc = rawById.get(u.id);
      const suggested = (rawUc?.suggested_trigger ?? {}) as Record<string, unknown>;
      const cfg = (suggested.config ?? {}) as Record<string, unknown>;
      const triggerType = String(suggested.trigger_type ?? "manual");
      let defaultSelection: TriggerSelection | undefined;
      if (triggerType === "event_listener" && typeof cfg.event_type === "string") {
        defaultSelection = { event: { eventType: cfg.event_type } };
      } else if (triggerType === "manual") {
        defaultSelection = {};
      } else if (typeof cfg.cron === "string") {
        defaultSelection = inferSelectionFromCron(cfg.cron);
      }
      return { ...u, defaultSelection };
    });
  }, [availableUseCases, designResult]);

  const toggleUseCase = useCallback((id: string) => {
    setSelectedUseCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Map UC id → human title so questionnaire "Applies to:" lines can render
  // "Applies to: Personal Briefing, Weekly Review" instead of raw ids like
  // "uc_morning_digest". Titles fall back to the id if the template author
  // didn't set a title on a capability.
  const useCaseTitleById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const uc of availableUseCases) {
      out[uc.id] = uc.name && uc.name.trim() ? uc.name : uc.id;
    }
    return out;
  }, [availableUseCases]);

  // Filter adoption questions by selected use cases + sort to match the
  // Live Preview bucket order (questionnaireCategoryOrder shared constant).
  // Questions with no use_case_id / use_case_ids (persona or connector scope)
  // always show. Within a bucket, authored order is preserved.
  const filteredAdoptionQuestions = useMemo(() => {
    const filtered = !showUseCasePicker
      ? adoptionQuestions
      : adoptionQuestions.filter((q) => {
          const tied = [q.use_case_id, ...(q.use_case_ids ?? [])].filter(Boolean) as string[];
          if (tied.length === 0) return true;
          return tied.some((id) => selectedUseCaseIds.has(id));
        });
    return filtered
      .map((q, idx) => ({ q, idx, cat: categoryOrderIndex(q.category) }))
      .sort((a, b) => (a.cat - b.cat) || (a.idx - b.idx))
      .map(({ q }) => q);
  }, [adoptionQuestions, selectedUseCaseIds, showUseCasePicker]);
  const hasFilteredQuestions = filteredAdoptionQuestions.length > 0;

  // Resolve dynamic option lists (Sentry projects, codebases, ...) from the
  // user's connected credentials. Questions without a `dynamic_source` simply
  // get an empty state and fall through to the existing static rendering.
  const { dynamicOptions, retry: retryDynamic } = useDynamicQuestionOptions(
    adoptionQuestions,
    adoptionAnswers,
  );


  // Pre-populate default answers from template questions + vault auto-detection.
  // For questions with vault_category + option_service_types:
  //   - 1 matching credential → auto-select (recorded in autoDetectedIds)
  //   - 0 matching credentials → block the question (recorded in blockedQuestionIds),
  //     user must add a credential via the Apps & Services catalog
  // Restored answers from a prior adoptionDraft (saved before catalog redirect)
  // also merge in, so the user resumes where they left off.
  useEffect(() => {
    if (!hasAdoptionQuestions || defaultsLoaded.current) return;
    defaultsLoaded.current = true;
    const defaults: Record<string, string> = {};
    for (const q of adoptionQuestions) {
      if (q.default) defaults[q.id] = String(q.default);
    }

    // If a draft exists for THIS review, restore its answers
    const sys = useSystemStore.getState();
    const draft = sys.adoptionDraft;
    const restoredAnswers: Record<string, string> | undefined =
      draft && draft.reviewId === review.id ? draft.userAnswers : undefined;
    if (restoredAnswers) {
      // Clear the draft so it doesn't fire the resume banner repeatedly
      sys.setAdoptionDraft(null);
    }

    // Initial one-shot: seed auto-answers + auto-detected badges from the
    // current vault snapshot. Blocked-state and narrowed options are derived
    // reactively via the `vaultMatch` memo above, so we don't set them here.
    const creds = useVaultStore.getState().credentials;
    const serviceTypes = new Set(creds.map((c) => c.service_type));
    const { autoAnswers, autoDetectedIds: detected } =
      matchVaultToQuestions(adoptionQuestions, serviceTypes);
    // Order: template defaults < vault auto-answers < restored draft answers
    const merged = { ...defaults, ...autoAnswers, ...(restoredAnswers ?? {}) };
    if (Object.keys(merged).length > 0) setAdoptionAnswers(merged);
    if (detected.size > 0) setAutoDetectedIds(detected);
  }, [hasAdoptionQuestions, adoptionQuestions, review.id]);

  // When questions are completed, store answers in the build draft and transition to draft_ready.
  // Adoption sessions are pre-designed templates — they don't have active LLM build tasks,
  // so we skip the refinement call and apply answers directly as parameter overrides.
  // Guard: never overwrite a more advanced phase (testing, test_complete, promoted).
  useEffect(() => {
    if (!questionsComplete || !seeded) return;

    const currentPhase = useAgentStore.getState().buildPhase;
    // Don't regress phase if a test or promotion is already in progress
    if (currentPhase === "testing" || currentPhase === "test_complete" || currentPhase === "promoted") return;

    // Merge adoption answers into the build draft as parameter overrides.
    // Only answers for questions that survived use-case filtering are saved.
    const currentDraft = useAgentStore.getState().buildDraft as Record<string, unknown> | null;
    const answerMap: Record<string, string> = {};
    for (const q of filteredAdoptionQuestions) {
      if (adoptionAnswers[q.id]) answerMap[q.id] = adoptionAnswers[q.id]!;
    }

    if (currentDraft && Object.keys(answerMap).length > 0) {
      useAgentStore.getState().patchActiveSession({
        draft: { ...currentDraft, _adoption_answers: answerMap },
        phase: "draft_ready",
      });
    } else {
      useAgentStore.getState().patchActiveSession({ phase: "draft_ready" });
    }

    // Persist answers to the backend so test_build_draft and promote use them.
    const sessionId = useAgentStore.getState().buildSessionId;
    if (sessionId && Object.keys(answerMap).length > 0) {
      // Derive credential bindings from vault-category questions: when the user
      // picks a specific provider (e.g. "Google Cloud Platform" mapped to
      // option_service_types[0] = "gcp_cloud"), record that binding so the
      // backend can prefer the right credential during test and runtime.
      const credentialBindings: Record<string, string> = {};
      for (const q of filteredAdoptionQuestions) {
        if (q.vault_category && q.option_service_types && q.options && answerMap[q.id]) {
          const selectedIdx = q.options.indexOf(answerMap[q.id]!);
          if (selectedIdx >= 0 && selectedIdx < q.option_service_types.length) {
            const serviceType = q.option_service_types[selectedIdx];
            if (serviceType) {
              credentialBindings[q.vault_category] = serviceType;
            }
          }
        }
      }

      const payload = {
        answers: answerMap,
        questions: filteredAdoptionQuestions.map((q) => ({
          id: q.id,
          question: q.question,
          category: q.category,
          option_service_types: q.option_service_types,
          vault_category: q.vault_category,
        })),
        credential_bindings: credentialBindings,
        // Record the user's capability selection so promote / test can prune
        // disabled use cases from the final persona (backend may ignore this
        // field today; the matrix preview already reflects the filter).
        selected_use_case_ids: showUseCasePicker ? [...selectedUseCaseIds] : null,
      };
      void invokeWithTimeout("save_adoption_answers", {
        sessionId,
        adoptionAnswersJson: JSON.stringify(payload),
      }).catch((err) => {
        logger.warn("Failed to persist adoption answers", { err });
      });
    }
  }, [questionsComplete, seeded, adoptionAnswers, filteredAdoptionQuestions, selectedUseCaseIds, showUseCasePicker]);

  // Seed the matrix cells from the template — deferred until questionnaire is completed
  // (if one exists). This prevents creating a draft persona when the user might
  // close the questionnaire without finishing it.
  useEffect(() => {
    if (seedDone.current || !designResult) return;
    if (!useCaseStepDone) return;
    if (hasFilteredQuestions && !questionsComplete) return;
    seedDone.current = true;

    // Derive credential bindings from vault-category questions so the Apps &
    // Services matrix cell reflects the user's concrete picks (e.g. Leonardo
    // AI) instead of the template's generic placeholder (e.g. "image_ai").
    const credentialBindings: Record<string, string> = {};
    for (const q of filteredAdoptionQuestions) {
      if (q.vault_category && q.option_service_types && q.options && adoptionAnswers[q.id]) {
        const idx = q.options.indexOf(adoptionAnswers[q.id]!);
        if (idx >= 0 && idx < q.option_service_types.length) {
          const serviceType = q.option_service_types[idx];
          if (serviceType) credentialBindings[q.vault_category] = serviceType;
        }
      }
    }

    // Materialize the user's trigger selections onto the design result
    // before extracting cell data — otherwise the persona gets built with
    // the template's default cadences and the user's choices in the
    // trigger-composition step evaporate.
    const effectiveDesignResult = triggerSelections?.perUseCase
      ? applyTriggerSelections(designResult, triggerSelections.perUseCase)
      : designResult;
    const dimensionData = extractDimensionData(
      effectiveDesignResult,
      credentialBindings,
      showUseCasePicker ? selectedUseCaseIds : undefined,
    );
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
        // Use effectiveDesignResult so the session carries the user's trigger
        // selections, not the template's defaults.
        const agentIrJson = JSON.stringify(effectiveDesignResult);
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
        const initialPhase = hasFilteredQuestions && !questionsComplete ? "awaiting_input" : "draft_ready";
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
          agentIr: effectiveDesignResult,
          intent: review.instruction || templateName,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        });

        // Register process activity for the adoption flow
        try {
          const { useOverviewStore } = await import("@/stores/overviewStore");
          const initialStatus = hasFilteredQuestions && !questionsComplete ? 'input_required' as const : 'running' as const;
          const initialEvent = hasFilteredQuestions && !questionsComplete ? 'Adoption questions need answers' : 'Draft ready';
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
  }, [designResult, templateName, review.instruction, createPersona, hasFilteredQuestions, questionsComplete, useCaseStepDone, showUseCasePicker, selectedUseCaseIds, filteredAdoptionQuestions, adoptionAnswers, triggerSelections]);

  const build = useMatrixBuild({ personaId });
  const lifecycle = useMatrixLifecycle({ personaId });

  // -- Sync build phase → process activity status --
  const currentBuildPhase = useAgentStore((s) => s.buildPhase);

  // -- Auto-test on draft_ready when no pending questions -----------------
  // Adoption seeds the matrix to draft_ready immediately. Once any adoption
  // questions are answered (or none exist), kick off the test automatically.
  // If conditions aren't met (questions pending, errors), manual button remains.
  //
  // Multi-round support: when the LLM surfaces a new pending question mid-build,
  // the ref is reset so that once the user answers it and we cycle back to
  // draft_ready with no more questions, the auto-test fires again. Without this
  // reset, the guard would block re-triggering and the user would have to click
  // the manual test button on every round.
  const autoTestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (build.pendingQuestions && build.pendingQuestions.length > 0) {
      autoTestedRef.current = null;
    }
  }, [build.pendingQuestions]);
  useEffect(() => {
    if (!seeded || !personaId) return;
    if (currentBuildPhase !== 'draft_ready') return;
    if (autoTestedRef.current === personaId) return;
    if (hasFilteredQuestions && !questionsComplete) return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.buildError) return;
    autoTestedRef.current = personaId;
    void lifecycle.handleStartTest();
  }, [seeded, personaId, currentBuildPhase, hasFilteredQuestions, questionsComplete, build.pendingQuestions, build.buildError, lifecycle]);
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

  // Quick-add credential modal state. The questionnaire's "Connect a
  // provider" CTA stays inside the adoption flow — the modal runs the
  // healthcheck + save, and the questionnaire answer is auto-populated
  // with the new credential's service_type. No navigation away, no draft
  // serialization, no resume banner.
  const [quickAddContext, setQuickAddContext] = useState<{
    category: string;
    targetQuestionId: string | null;
  } | null>(null);

  const handleAddCredentialForCategory = useCallback((category: string) => {
    const targetQuestion = filteredAdoptionQuestions.find((q) => {
      const src = q.dynamic_source;
      return src?.source === 'vault' && src.service_type === category;
    });
    setQuickAddContext({
      category,
      targetQuestionId: targetQuestion?.id ?? null,
    });
  }, [filteredAdoptionQuestions]);

  const handleCredentialAdded = useCallback((serviceType: string) => {
    const ctx = quickAddContext;
    setQuickAddContext(null);
    if (!ctx?.targetQuestionId) return;
    // Auto-pick the new credential as the answer so the user doesn't have
    // to click twice. The matcher will re-resolve the options list on the
    // next render (vault store credentials updated by createCredential).
    setAdoptionAnswers((prev) => ({ ...prev, [ctx.targetQuestionId!]: serviceType }));
  }, [quickAddContext]);

  // Discard the current draft persona and close the adoption modal.
  // Shown as "Delete Draft" in the Command Hub when tests are skipped/failed
  // and the user wants to abandon the adoption rather than retry or approve.
  const handleDeleteDraft = useCallback(() => {
    const agent = useAgentStore.getState();
    const sys = useSystemStore.getState();
    // Fire-and-forget cleanup — UI closes immediately either way
    if (personaId) {
      void agent.deletePersona(personaId).catch(() => { /* best-effort */ });
    }
    agent.resetBuildSession();
    void import("@/stores/overviewStore").then(({ useOverviewStore }) => {
      useOverviewStore.getState().processEnded('template_adopt', 'failed', personaId ?? 'unknown');
    }).catch(() => {});
    sys.setTemplateAdoptActive(false);
    sys.setAdoptionDraft(null);
    onClose();
  }, [personaId, onClose]);

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

      // Close the adoption modal and hand the caller the actual persona ID
      // so they don't have to guess from created_at ordering.
      onPersonaCreated(personaId);
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
    // Re-seed from template — preserves the user's capability picks AND
    // trigger selections so the discard reverts manual matrix edits without
    // reintroducing disabled use cases or template-default cadence.
    if (designResult) {
      const effective = triggerSelections?.perUseCase
        ? applyTriggerSelections(designResult, triggerSelections.perUseCase)
        : designResult;
      const dimensionData = extractDimensionData(
        effective,
        undefined,
        showUseCasePicker ? selectedUseCaseIds : undefined,
      );
      store.patchActiveSession({ cellData: dimensionData, draft: effective });
    }
  }, [designResult, showUseCasePicker, selectedUseCaseIds, triggerSelections]);

  if (!seeded) {
    // Step 1 — capability + trigger composition (merged). Shown for
    // templates with ≥2 use cases; single-UC templates skip straight to
    // the questionnaire since there's no composition decision to make.
    if (showUseCasePicker && !useCasesPicked) {
      return (
        <UseCasePickerStep
          templateName={templateName}
          templateGoal={templateGoal}
          useCases={availableUseCasesWithDefaults}
          selectedIds={selectedUseCaseIds}
          availableEvents={availableEventTypes}
          triggerComposition={triggerComposition}
          triggerSelections={perUseCaseTriggerSelections}
          onToggle={toggleUseCase}
          onTriggerChange={setPerUseCaseTriggerSelections}
          onContinue={() => setUseCasesPicked(true)}
        />
      );
    }
    // Step 2 — questionnaire. Rendered inline while the user fills it in so
    // static/dynamic questions are interactive immediately. We only fall back
    // to the "Loading template…" placeholder AFTER the user submits, while
    // seed creates the draft persona — so the user is never blocked behind
    // a generic loading screen with the questionnaire trapped underneath it.
    if (hasFilteredQuestions && !questionsComplete) {
      return (
        <QuestionnaireFormFocus
          questions={filteredAdoptionQuestions}
          userAnswers={adoptionAnswers}
          autoDetectedIds={autoDetectedIds}
          blockedQuestionIds={blockedQuestionIds}
          filteredOptions={filteredOptions}
          dynamicOptions={dynamicOptions}
          onRetryDynamic={retryDynamic}
          onAddCredential={handleAddCredentialForCategory}
          onAnswerUpdated={(id, answer) =>
            setAdoptionAnswers((prev) => ({ ...prev, [id]: answer }))
          }
          onSubmit={() => setQuestionsComplete(true)}
          onClose={onClose}
          templateName={templateName}
          useCaseTitleById={useCaseTitleById}
        />
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="typo-body text-foreground animate-pulse">{t.templates.adopt_modal.loading_template}</div>
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-auto px-4 pt-2 transition-opacity duration-400 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      {/* Experimental chronology prototype switcher — compare Journey vs.
          Timeline variants of the unified Tasks/Apps/Triggers component.
          When neither is selected, the theme-mapped legacy variant renders. */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/50 mr-1">
          {t.templates.chronology.prototype_label}
        </span>
        {CHRONO_TABS.map((tab) => {
          const active = matrixVariant === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMatrixVariant(tab.id)}
              className={`flex flex-col items-start gap-0.5 px-3 py-1.5 rounded-modal border cursor-pointer transition-all ${
                active
                  ? "bg-primary/15 border-primary/30 text-foreground"
                  : "bg-card-bg/50 border-card-border text-foreground/70 hover:bg-primary/5 hover:border-primary/20"
              }`}
            >
              <span className="text-[11px] font-semibold leading-none">{tab.label}</span>
              <span className="text-[9px] uppercase tracking-wider opacity-70 leading-none">
                {tab.sub}
              </span>
            </button>
          );
        })}
        {CHRONO_VARIANTS.includes(matrixVariant) && (
          <button
            onClick={() => setMatrixVariant(getThemeVariant(themeId))}
            className="text-[10px] uppercase tracking-wider text-foreground/50 hover:text-foreground cursor-pointer ml-1 px-2 py-1"
          >
            {t.templates.chronology.back_to_legacy}
          </button>
        )}
      </div>

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
          onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
          onRejectTest={lifecycle.handleRejectTest}
          onDeleteDraft={handleDeleteDraft}
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
      {matrixVariant === "chrono-wildcard" && (
        <PersonaChronologyWildcard
          buildPhase={build.buildPhase}
          completeness={build.completeness}
          isRunning={build.isBuilding}
          buildActivity={build.buildActivity}
          pendingQuestions={build.pendingQuestions}
          onAnswerBuildQuestion={build.handleAnswer}
          onSubmitAllAnswers={build.handleSubmitAnswers}
          onStartTest={lifecycle.handleStartTest}
          onApproveTest={lifecycle.handlePromote}
          onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
          onRejectTest={lifecycle.handleRejectTest}
          onDeleteDraft={handleDeleteDraft}
          onRefine={lifecycle.handleRefine}
          testOutputLines={build.buildTestOutputLines}
          testPassed={build.buildTestPassed}
          testError={build.buildTestError}
          toolTestResults={lifecycle.buildToolTestResults}
          testSummary={lifecycle.buildTestSummary}
          onViewAgent={handleViewAgent}
        />
      )}
      {matrixVariant === "chrono-glyph" && (
        <PersonaChronologyGlyph
          buildPhase={build.buildPhase}
          completeness={build.completeness}
          isRunning={build.isBuilding}
          buildActivity={build.buildActivity}
          pendingQuestions={build.pendingQuestions}
          onAnswerBuildQuestion={build.handleAnswer}
          onSubmitAllAnswers={build.handleSubmitAnswers}
          onStartTest={lifecycle.handleStartTest}
          onApproveTest={lifecycle.handlePromote}
          onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
          onRejectTest={lifecycle.handleRejectTest}
          onDeleteDraft={handleDeleteDraft}
          onRefine={lifecycle.handleRefine}
          testOutputLines={build.buildTestOutputLines}
          testPassed={build.buildTestPassed}
          testError={build.buildTestError}
          toolTestResults={lifecycle.buildToolTestResults}
          testSummary={lifecycle.buildTestSummary}
          onViewAgent={handleViewAgent}
        />
      )}
      {matrixVariant === "chrono-glyph-wide" && (
        <PersonaChronologyGlyphWide
          buildPhase={build.buildPhase}
          completeness={build.completeness}
          isRunning={build.isBuilding}
          buildActivity={build.buildActivity}
          pendingQuestions={build.pendingQuestions}
          onAnswerBuildQuestion={build.handleAnswer}
          onSubmitAllAnswers={build.handleSubmitAnswers}
          onStartTest={lifecycle.handleStartTest}
          onApproveTest={lifecycle.handlePromote}
          onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
          onRejectTest={lifecycle.handleRejectTest}
          onDeleteDraft={handleDeleteDraft}
          onRefine={lifecycle.handleRefine}
          testOutputLines={build.buildTestOutputLines}
          testPassed={build.buildTestPassed}
          testError={build.buildTestError}
          toolTestResults={lifecycle.buildToolTestResults}
          testSummary={lifecycle.buildTestSummary}
          onViewAgent={handleViewAgent}
        />
      )}

      {/* Note: questionnaire is rendered inline in the !seeded branch above.
          Once seeded === true the user has already submitted, so no need
          to render the questionnaire again here. */}

      {quickAddContext && (
        <QuickAddCredentialModal
          category={quickAddContext.category}
          onCredentialAdded={handleCredentialAdded}
          onClose={() => setQuickAddContext(null)}
        />
      )}
    </div>
  );
}
