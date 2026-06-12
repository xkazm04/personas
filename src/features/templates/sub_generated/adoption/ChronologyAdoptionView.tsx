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
import { type UseCaseOption } from "./ucPicker";
import { PersonaLayoutAdoption } from "./persona-layout";
import { PersonaLayoutBuild } from "./persona-layout/PersonaLayoutBuild";
import { useBuild } from "@/features/agents/components/matrix/useBuild";
import { useLifecycle } from "@/features/agents/components/matrix/useLifecycle";
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from "@/stores/toastStore";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { CellBuildStatus } from "@/lib/types/buildTypes";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import type { TransformQuestionResponse } from "@/api/templates/n8nTransform";
import {
  deriveCredentialBindings,
  hasMatchingCredential,
  matchVaultToQuestions,
} from "../shared/vaultAdoptionMatcher";
import { useDynamicQuestionOptions } from "./useDynamicQuestionOptions";
import { categoryOrderIndex } from "./questionnaireCategoryOrder";
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { QuickAddCredentialModal } from "./QuickAddCredentialModal";
import { BUILTIN_CONNECTORS, connectorCategoryTags } from "@/lib/credentials/builtinConnectors";
import type { TriggerSelection } from "./useCasePickerShared";
import type { EventSubscription } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import type { ChannelSpecV2 } from "@/lib/bindings/ChannelSpecV2";
import type { UseCaseErrorPolicy } from "@/lib/types/frontendTypes";
import { resolveIconForTemplate } from "@/lib/icons/templateIconResolver";
import { silentCatch } from '@/lib/silentCatch';
import { useHydratedDesignResult } from './useHydratedDesignResult';


interface ChronologyAdoptionViewProps {
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

/**
 * Humanize a snake_case use_case identifier into a readable label.
 * `uc_signals` → `Signals`, `uc_publish_and_alert` → `Publish and Alert`.
 * Used as the fallback for the "Applies to:" line when a use_case_id is
 * referenced by an adoption question but no inline name/title was set
 * (templates whose use_cases[] are pure recipe_refs hit this path).
 */
function humanizeUseCaseId(id: string): string {
  if (!id) return id;
  const cleaned = id.replace(/^uc[_-]/i, '').replace(/_/g, ' ').trim();
  if (!cleaned) return id;
  return cleaned
    .split(' ')
    .map((word) => {
      // Preserve known acronyms verbatim
      if (/^(adr|api|crm|ci|cd|mcp|kb|qa|hr|cms|seo)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
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
  t?: { templates: { adoption: { matrix_fallbacks: { not_required: string; stateless_no_memory: string; default_error_handling: string; no_event_subscriptions: string; review_required: string; memory_enabled: string; event: string } } } },
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
  data["human-review"] = { items: reviewCaps.length > 0 ? reviewCaps.map((c) => String((c as Record<string, unknown>).context ?? (t?.templates.adoption.matrix_fallbacks.review_required ?? "Review required"))) : [t?.templates.adoption.matrix_fallbacks.not_required ?? "Not required — fully automated"] };

  // Memory
  const memoryCaps = caps.filter((c) => (c as Record<string, unknown>).type === "agent_memory");
  data["memory"] = { items: memoryCaps.length > 0 ? memoryCaps.map((c) => String((c as Record<string, unknown>).context ?? (t?.templates.adoption.matrix_fallbacks.memory_enabled ?? "Memory enabled"))) : [t?.templates.adoption.matrix_fallbacks.stateless_no_memory ?? "Stateless — no memory between runs"] };

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
    data["error-handling"] = { items: parsed.length > 0 ? parsed : [t?.templates.adoption.matrix_fallbacks.default_error_handling ?? "Default error handling"] };
  } else {
    data["error-handling"] = { items: [t?.templates.adoption.matrix_fallbacks.default_error_handling ?? "Default error handling"] };
  }

  // Events — drop subscriptions tied to a disabled use case
  const eventsRaw = ((d.suggested_event_subscriptions ?? []) as unknown[]);
  const events = ucFilterActive
    ? eventsRaw.filter((e) => matchesUseCaseFilter((e as Record<string, unknown>).use_case_id))
    : eventsRaw;
  data["events"] = { items: events.length > 0 ? events.map((e) => { const o = e as Record<string, unknown>; return `${o.event_type ?? (t?.templates.adoption.matrix_fallbacks.event ?? "event")}: ${o.description ?? ""}`; }) : [t?.templates.adoption.matrix_fallbacks.no_event_subscriptions ?? "No event subscriptions"] };

  return data;
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
function triggerSelectionToTriggers(
  sel: TriggerSelection,
  translations?: Pick<Translations, "templates">,
  tx?: (template: string, vars: Record<string, string | number>) => string,
): TriggerIR[] {
  const out: TriggerIR[] = [];

  if (sel.time) {
    const timeSel = sel.time;
    const h = Math.max(0, Math.min(23, timeSel.hourOfDay ?? 9));
    if (timeSel.preset === "daily") {
      const hourStr = String(h).padStart(2, "0");
      const desc = translations && tx
        ? tx(translations.templates.adoption.cron_descriptions.daily_at_local, { hour: hourStr })
        : `Daily at ${hourStr}:00 local`;
      out.push({
        trigger_type: "schedule",
        config: { cron: `0 ${h} * * *`, timezone: "local" },
        description: `${desc}.`,
      });
    } else if (timeSel.preset === "weekly") {
      const d = Math.max(0, Math.min(6, timeSel.weekday ?? 1));
      const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
      const dayKey = weekdayKeys[d] ?? "mon";
      const dayName = translations?.templates.adoption.weekdays[dayKey] ?? dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
      const hourStr = String(h).padStart(2, "0");
      const desc = translations && tx
        ? tx(translations.templates.adoption.cron_descriptions.weekly_on_day_at_local, { day: dayName, hour: hourStr })
        : `Weekly on ${dayName} at ${hourStr}:00 local`;
      out.push({
        trigger_type: "schedule",
        config: { cron: `0 ${h} * * ${d}`, timezone: "local" },
        description: `${desc}.`,
      });
    } else {
      // hourly — hour/weekday are preserved on the selection for
      // round-trip UX, but the cron itself ignores them.
      const desc = translations?.templates.adoption.cron_descriptions.hourly_at_local ?? "Hourly";
      out.push({
        trigger_type: "schedule",
        config: { cron: "0 * * * *", timezone: "local" },
        description: `${desc}.`,
      });
    }
  }

  if (sel.event) {
    const eventType = sel.event.eventType;
    const description = eventType
      ? (tx
          ? tx(translations!.templates.adoption.trigger_descriptions.listens_for, { event_type: eventType })
          : `Listens for ${eventType}.`)
      : (translations?.templates.adoption.trigger_descriptions.event_driven ?? "Event-driven.");
    out.push({
      trigger_type: "event_listener",
      config: { event_type: eventType ?? "" },
      description,
    });
  }

  if (out.length === 0) {
    // No Time + no Event — fall back to the template-authored cron if
    // present, else Manual. Preserves the Custom escape hatch.
    const custom = sel.customCron?.trim();
    if (custom) {
      const description = tx
        ? tx(translations!.templates.adoption.trigger_descriptions.custom_cron, { cron: custom })
        : `Custom cron: ${custom}.`;
      out.push({
        trigger_type: "schedule",
        config: { cron: custom, timezone: "local" },
        description,
      });
    } else {
      out.push({
        trigger_type: "manual",
        config: {},
        description:
          translations?.templates.adoption.trigger_descriptions.manual_on_demand
          ?? "Manual — user invokes on demand.",
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
/** Write the user's per-capability Error-sigil routing policy onto each use
 *  case so it persists in the seeded persona's IR (the runtime failure hook
 *  reads `use_cases[i].error_policy`). Returns a shallow clone; a no-op when
 *  nothing was configured. */
function applyErrorPolicies(
  designResult: Record<string, unknown>,
  byCap: Record<string, UseCaseErrorPolicy>,
): Record<string, unknown> {
  if (Object.keys(byCap).length === 0) return designResult;
  const ucRaw = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
  const nextUseCases = ucRaw.map((uc) => {
    const id = String(uc.id ?? "");
    const policy = byCap[id];
    return policy ? { ...uc, error_policy: policy } : uc;
  });
  return { ...designResult, use_cases: nextUseCases };
}

/**
 * Bake the user's per-capability Memory/Review on-off toggles onto the IR as
 * `generation_settings` — the canonical envelope the runtime dispatcher reads
 * (engine/dispatch.rs). Only touched capabilities are rewritten so a template's
 * own policy survives where the user didn't intervene. Mirrors
 * `applyErrorPolicies`.
 */
function applyGenerationSettings(
  designResult: Record<string, unknown>,
  byCap: Record<string, { memory?: boolean; review?: boolean }>,
): Record<string, unknown> {
  if (Object.keys(byCap).length === 0) return designResult;
  const ucRaw = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
  const nextUseCases = ucRaw.map((uc) => {
    const id = String(uc.id ?? "");
    const policy = byCap[id];
    if (!policy || (policy.memory === undefined && policy.review === undefined)) return uc;
    const prev = (uc.generation_settings ?? {}) as Record<string, unknown>;
    const gen: Record<string, unknown> = { ...prev };
    if (policy.memory !== undefined) gen.memories = policy.memory ? "on" : "off";
    if (policy.review !== undefined) gen.reviews = policy.review ? "on" : "off";
    return { ...uc, generation_settings: gen };
  });
  return { ...designResult, use_cases: nextUseCases };
}

/**
 * Bake the user's per-capability cross-persona event subscriptions onto the IR
 * as `use_cases[].event_subscriptions` (UseCaseEventSubscription shape) — the
 * suggestion lifecycle the backend already understands. `source_filter` carries
 * the emitting persona id so the subscription stays scoped to that persona
 * (the glyph builder's prose-only path loses this). Mirrors `applyErrorPolicies`.
 */
function applyEventSubscriptions(
  designResult: Record<string, unknown>,
  byCap: Record<string, EventSubscription[]>,
): Record<string, unknown> {
  const entries = Object.entries(byCap).filter(([, subs]) => subs.length > 0);
  if (entries.length === 0) return designResult;
  const subsById = new Map(entries);
  const ucRaw = (designResult.use_cases ?? []) as Array<Record<string, unknown>>;
  const nextUseCases = ucRaw.map((uc) => {
    const id = String(uc.id ?? "");
    const subs = subsById.get(id);
    if (!subs || subs.length === 0) return uc;
    const prev = (uc.event_subscriptions ?? []) as Array<Record<string, unknown>>;
    const seen = new Set(prev.map((e) => `${e.event_type}:${e.source_filter ?? ""}`));
    const added = subs
      .map((s) => ({ event_type: s.triggerId, source_filter: s.personaId, enabled: true }))
      .filter((e) => !seen.has(`${e.event_type}:${e.source_filter}`));
    return { ...uc, event_subscriptions: [...prev, ...added] };
  });
  return { ...designResult, use_cases: nextUseCases };
}

/**
 * Append the user's manually-attached connectors onto the IR's
 * `suggested_connectors` (deduped against existing suggested/required), so a
 * connector chosen via the Apps petal is bound when the persona is built.
 */
function applyManualConnectors(
  designResult: Record<string, unknown>,
  names: string[],
): Record<string, unknown> {
  if (names.length === 0) return designResult;
  const suggested = (designResult.suggested_connectors ?? []) as Array<Record<string, unknown>>;
  const required = (designResult.required_connectors ?? []) as Array<Record<string, unknown>>;
  const have = new Set(
    [...suggested, ...required].map((c) =>
      String(c.name ?? c.service_type ?? "").toLowerCase(),
    ),
  );
  const added = names
    .filter((n) => !have.has(n.toLowerCase()))
    .map((n) => ({ name: n, service_type: n, purpose: "User-attached connector" }));
  if (added.length === 0) return designResult;
  return { ...designResult, suggested_connectors: [...suggested, ...added] };
}

/**
 * Bake the user's Messages-petal channel choice onto the IR. Sets both the
 * concrete `notification_channels` (ChannelSpecV2[], read by
 * prepare_notification_channels → persona row) and `suggested_notification_channels`
 * (the adoption matrix preview). Only called when the user actually edited the
 * Messages petal, so untouched templates keep their authored channels.
 */
function applyNotificationChannels(
  designResult: Record<string, unknown>,
  channels: ChannelSpecV2[],
): Record<string, unknown> {
  return {
    ...designResult,
    notification_channels: channels,
    suggested_notification_channels: channels,
  };
}

/** Build-intent hint for the Messages petal. Empty selection instructs the
 *  build to produce NO user-facing message (events / data only); a non-empty
 *  selection lists the delivery channels (matches serializeQuickConfig). */
function notificationChannelsHint(channels: ChannelSpecV2[] | null): string {
  if (channels === null) return "";
  if (channels.length === 0) {
    return "\nMessages: none — this persona produces no user-facing messages; emit events / write data instead.";
  }
  const labels = channels
    .filter((c) => c.type !== "built-in" && c.type !== "titlebar")
    .map((c) => c.type);
  return labels.length > 0
    ? `\nDelivery channels: persona inbox, ${labels.join(", ")} (fan-out)`
    : "\nDelivery channels: persona inbox";
}

/** One-line "Services: …" hint appended to the seed intent for the manually
 *  attached connectors (matches the glyph builder's serializeQuickConfig).
 *  Database connectors narrowed to a table subset render `(tables: a, b)`;
 *  the all-tables default emits no suffix (no redundant scope note). */
function manualConnectorsHint(
  names: string[],
  tables: Record<string, string[]>,
): string {
  if (names.length === 0) return "";
  const descs = names.map((name) => {
    const t = tables[name];
    return t && t.length > 0 ? `${name} (tables: ${t.join(", ")})` : name;
  });
  return `\nServices: ${descs.join(", ")}`;
}

/** One-line human summary of the picked event subscriptions, appended to the
 *  seed intent so the backend LLM has the cross-persona context too. */
function eventSubscriptionsHint(byCap: Record<string, EventSubscription[]>): string {
  const all = Object.values(byCap).flat();
  if (all.length === 0) return "";
  const seen = new Set<string>();
  const descs: string[] = [];
  for (const s of all) {
    const key = `${s.personaId}:${s.triggerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    descs.push(`${s.description} (from ${s.personaName})`);
  }
  return `\nEvent triggers: ${descs.join(", ")}`;
}

function applyTriggerSelections(
  designResult: Record<string, unknown>,
  perUseCase: Record<string, TriggerSelection>,
  t?: Parameters<typeof triggerSelectionToTriggers>[1],
  tx?: Parameters<typeof triggerSelectionToTriggers>[2],
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
    const triggers = triggerSelectionToTriggers(sel, t, tx);
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
    for (const trig of triggerSelectionToTriggers(sel, t, tx)) {
      nextSuggestedTriggers.push({ ...trig, use_case_id: uc.id });
    }
  }
  return {
    ...designResult,
    use_cases: nextUseCases,
    suggested_triggers: nextSuggestedTriggers,
  };
}

export function ChronologyAdoptionView({ review, onClose, onPersonaCreated }: ChronologyAdoptionViewProps) {
  const { t, tx } = useTranslation();
  const [seeded, setSeeded] = useState(false);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [fadeOut, setFadeOut] = useState(false);
  const createPersona = useAgentStore((s) => s.createPersona);
  const seedDone = useRef(false);
  const seedInFlight = useRef(false);
  // Approach 1 — always-on adjustment: the adoption build session id (captured
  // at seed time) + guards so the LLM adjustment pass runs exactly once before
  // the auto-test, specializing the pre-built base IR to the user's picks.
  // `adjustedPersonaId` is state (not a ref) so completing the pass re-renders
  // and lets the gated auto-test effect fire.
  const adoptionSessionIdRef = useRef<string | null>(null);
  const adjustingRef = useRef(false);
  const [adjustedPersonaId, setAdjustedPersonaId] = useState<string | null>(null);

  // Parse + hydrate the design result. Templates store capabilities as
  // recipe_refs (Stage-B migration); the questionnaire renders before the
  // backend expands them, so hydrate here — otherwise use_cases have no
  // inline id/title and the Persona Layout shows "All capabilities skipped".
  const designResult = useHydratedDesignResult(review.design_result);

  const templateName = review.test_case_name ?? "Template";

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

  // Test-automation hook — when the test-automation server fires a
  // `test:seed-adoption` window event, merge the supplied answers into
  // local state and force the picker/questionnaire to be considered
  // complete so Continue-to-Build becomes enabled without UI clicks.
  // Production users never see this; the listener is a no-op without
  // the event. Lives here (not in a separate hook) because the
  // setters it needs are component-local.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ answers?: Record<string, string> }>).detail ?? {};
      const answers = detail.answers ?? {};
      if (Object.keys(answers).length > 0) {
        setAdoptionAnswers((prev) => ({ ...prev, ...answers }));
      }
      setQuestionsComplete(true);
    };
    window.addEventListener('test:seed-adoption', handler);
    return () => window.removeEventListener('test:seed-adoption', handler);
  }, []);

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

  // Trigger composition — per-UC "When" selections, set via the schedule petal
  // (ComposerSchedulePickerModal) and materialized onto designResult before the
  // persona is seeded (applyTriggerSelections).
  const [perUseCaseTriggerSelections, setPerUseCaseTriggerSelections] =
    useState<Record<string, TriggerSelection>>({});
  const triggerSelections = useMemo(
    () => ({ perUseCase: perUseCaseTriggerSelections }),
    [perUseCaseTriggerSelections],
  );
  const handleTriggerChange = useCallback((capId: string, sel: TriggerSelection) => {
    setPerUseCaseTriggerSelections((prev) => ({ ...prev, [capId]: sel }));
  }, []);

  // Per-capability cross-persona event subscriptions, set via the Events petal
  // (ComposerEventPickerModal). Baked onto use_cases[].event_subscriptions at
  // seed time (applyEventSubscriptions) + summarized into the seed intent.
  const [eventSubsByCap, setEventSubsByCap] = useState<Record<string, EventSubscription[]>>({});
  const handleEventSubsChange = useCallback((capId: string, subs: EventSubscription[]) => {
    setEventSubsByCap((prev) => ({ ...prev, [capId]: subs }));
  }, []);

  // Per-capability Memory/Review on-off overrides (undefined = template
  // default). Baked into use_cases[].generation_settings at seed time
  // (applyGenerationSettings) so the runtime dispatcher honours the toggle.
  const [dimPolicyByCap, setDimPolicyByCap] =
    useState<Record<string, { memory?: boolean; review?: boolean }>>({});
  const handleDimPolicyChange = useCallback(
    (capId: string, dim: 'memory' | 'review', on: boolean) => {
      setDimPolicyByCap((prev) => ({ ...prev, [capId]: { ...prev[capId], [dim]: on } }));
    },
    [],
  );

  // Connectors the user manually attached via the Apps petal (persona-level,
  // glyph-builder parity). Appended to the IR's suggested_connectors and
  // summarized into the seed intent.
  const [manualConnectors, setManualConnectors] = useState<string[]>([]);
  // Per-database-connector table scope (connector name → tables; [] = all).
  // Subsets ride into the seed intent so the build focuses the persona.
  const [connectorTables, setConnectorTables] = useState<Record<string, string[]>>({});

  // Messaging channels set via the Messages petal. `null` = untouched (keep the
  // template's default messaging); a non-null array = the user's explicit choice
  // (empty array = no user-facing messages). Baked at seed via
  // applyNotificationChannels + a build-intent hint.
  const [notificationChannels, setNotificationChannels] = useState<ChannelSpecV2[] | null>(null);

  // Per-capability "Errors" sigil routing policy. Edited via the Error petal
  // in the Persona Layout; applied onto effectiveDesignResult.use_cases at
  // seed time (applyErrorPolicies) so it rides into the persona's IR.
  const [errorPolicyByCap, setErrorPolicyByCap] = useState<Record<string, UseCaseErrorPolicy>>({});
  const handleErrorPolicyChange = useCallback((capId: string, policy: UseCaseErrorPolicy) => {
    setErrorPolicyByCap((prev) => ({ ...prev, [capId]: policy }));
  }, []);

  const toggleUseCase = useCallback((id: string) => {
    setSelectedUseCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Map UC id → human title so questionnaire "Applies to:" lines can render
  // "Applies to: Signals, Congressional Scan" instead of raw ids like
  // "uc_signals". Three layers of resolution:
  //   1. availableUseCases (post-hydration use_cases array — has name/title)
  //   2. adoption_questions also reference use_case_ids that may not appear in
  //      availableUseCases for templates whose use_cases[] are pure recipe_refs
  //      and haven't been hydrated client-side yet
  //   3. Fallback to a humanized id ("uc_signals" → "Signals") so the user
  //      never sees raw snake_case identifiers in the questionnaire
  const useCaseTitleById = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const uc of availableUseCases) {
      out[uc.id] = uc.name && uc.name.trim() && uc.name !== uc.id
        ? uc.name
        : humanizeUseCaseId(uc.id);
    }
    // Also seed entries for any use_case_id referenced by adoption_questions
    // that didn't appear in availableUseCases (recipe_refs not hydrated, or
    // template authoring drift). Without this, "Applies to: uc_signals"
    // bleeds through for those ids even when the template is otherwise fine.
    for (const q of adoptionQuestions) {
      const ids = [q.use_case_id, ...(q.use_case_ids ?? [])].filter(Boolean) as string[];
      for (const id of ids) {
        if (!out[id]) out[id] = humanizeUseCaseId(id);
      }
    }
    return out;
  }, [availableUseCases, adoptionQuestions]);

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
  // Pass the template's connector slots so slot-level `requires_resource`
  // (§4.2) overrides question-level when both are present.
  const personaConnectorSlots = useMemo(() => {
    const persona = designResult?.persona as { connectors?: unknown } | undefined;
    const arr = Array.isArray(persona?.connectors) ? persona.connectors : [];
    return arr.filter((c): c is { name: string } & Record<string, unknown> =>
      typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string',
    );
  }, [designResult]);
  const { dynamicOptions, retry: retryDynamic } = useDynamicQuestionOptions(
    adoptionQuestions,
    adoptionAnswers,
    personaConnectorSlots,
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

  // §4.1 — auto-fill from scoped resources. Watches `dynamicOptions` for
  // questions whose `dynamic_source.source === 'scope'` resolved to exactly
  // one pick, and pre-fills the answer so the user doesn't have to confirm
  // a single-option select. Multiple picks = render as a normal select; zero
  // picks = the hook surfaces an error pointing the user back to scoping.
  //
  // Idempotent — only sets the answer once per (question, option-set) pair so
  // a user who manually clears the field doesn't have it bounce back.
  const scopeAutoFilledRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!hasAdoptionQuestions) return;
    let nextAnswers: Record<string, string> | null = null;
    let nextAuto: Set<string> | null = null;
    for (const q of adoptionQuestions) {
      if (q.dynamic_source?.source !== 'scope') continue;
      const st = dynamicOptions[q.id];
      if (!st || st.loading || st.items.length !== 1) continue;
      const only = st.items[0];
      if (!only) continue;
      const onlyValue = only.value;
      if (scopeAutoFilledRef.current[q.id] === onlyValue) continue;
      if (adoptionAnswers[q.id]) {
        scopeAutoFilledRef.current[q.id] = onlyValue;
        continue;
      }
      scopeAutoFilledRef.current[q.id] = onlyValue;
      nextAnswers = { ...(nextAnswers ?? adoptionAnswers), [q.id]: onlyValue };
      nextAuto = new Set(nextAuto ?? autoDetectedIds);
      nextAuto.add(q.id);
    }
    if (nextAnswers) setAdoptionAnswers(nextAnswers);
    if (nextAuto) setAutoDetectedIds(nextAuto);
  }, [adoptionQuestions, dynamicOptions, adoptionAnswers, autoDetectedIds, hasAdoptionQuestions]);

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
      // Derive credential bindings from BOTH static-options vault questions
      // (e.g. "ai" → "leonardo_ai") AND dynamic_source vault pickers (e.g.
      // "email" → "gmail"). The shared helper keeps the two cases in lockstep
      // so templates like Email Morning Digest — which ship the credential
      // picker as a dynamic_source question — actually produce a binding.
      const credentialBindings = deriveCredentialBindings(filteredAdoptionQuestions, answerMap);

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
    // seedDone flips true only on success. seedInFlight blocks duplicate
    // concurrent attempts while the async IIFE below is still running. If the
    // backend createPersona/create_adoption_session call fails, we delete the
    // partially-created persona, reset the in-flight flag, and leave seedDone
    // false so the user can retry instead of being stuck on "Loading template…".
    if (seedDone.current || seedInFlight.current || !designResult) return;
    if (!useCaseStepDone) return;
    if (hasFilteredQuestions && !questionsComplete) return;
    seedInFlight.current = true;

    // Derive credential bindings so the Apps & Services matrix cell reflects
    // the user's concrete picks (Leonardo AI from a static-options question,
    // Gmail from a dynamic_source vault picker, …) instead of the template's
    // generic placeholder (`image_ai`, `email`). See `deriveCredentialBindings`
    // for the two question shapes it handles.
    const credentialBindings = deriveCredentialBindings(filteredAdoptionQuestions, adoptionAnswers);

    // Materialize the user's trigger selections onto the design result
    // before extracting cell data — otherwise the persona gets built with
    // the template's default cadences and the user's choices in the
    // trigger-composition step evaporate.
    const withTriggers = triggerSelections?.perUseCase
      ? applyTriggerSelections(designResult, triggerSelections.perUseCase, t, tx)
      : designResult;
    // Bake the per-capability Error-sigil routing policy onto the IR.
    const withErrorPolicies = applyErrorPolicies(withTriggers, errorPolicyByCap);
    // Bake the Memory/Review on-off toggles as generation_settings (the
    // envelope the runtime dispatcher reads).
    const withGenSettings = applyGenerationSettings(withErrorPolicies, dimPolicyByCap);
    // Bake the cross-persona event subscriptions onto use_cases[].event_subscriptions.
    const withEvents = applyEventSubscriptions(withGenSettings, eventSubsByCap);
    // Append manually-attached connectors (Apps petal) to suggested_connectors.
    const withConnectors = applyManualConnectors(withEvents, manualConnectors);
    // Bake the Messages-petal channel choice (only when the user edited it).
    const effectiveDesignResult = notificationChannels !== null
      ? applyNotificationChannels(withConnectors, notificationChannels)
      : withConnectors;
    const dimensionData = extractDimensionData(
      effectiveDesignResult,
      credentialBindings,
      showUseCasePicker ? selectedUseCaseIds : undefined,
      t,
    );
    const cellStates: Record<string, CellBuildStatus> = {};
    for (const key of Object.keys(dimensionData)) {
      cellStates[key] = "resolved";
    }

    // Create a draft persona for this adoption
    (async () => {
      let createdPersonaId: string | null = null;
      try {
        const name = (designResult as Record<string, unknown>).name as string ?? templateName;
        // Resolve an agent icon + color from the template's category tags and
        // name/description so adopted personas show themed art in the sidebar
        // instead of the generic Bot fallback. Templates that only declare
        // "productivity" still resolve to specific icons (email/calendar/…) via
        // name+description keyword inference. Template-authored `color` wins
        // over the icon's suggestedColor when set.
        const rawCategories = (designResult as Record<string, unknown>).category;
        const categories = Array.isArray(rawCategories)
          ? rawCategories.filter((c): c is string => typeof c === "string")
          : typeof rawCategories === "string" ? [rawCategories] : [];
        const templateDescription = (designResult as Record<string, unknown>).description;
        const resolved = resolveIconForTemplate(
          categories,
          name,
          typeof templateDescription === "string" ? templateDescription : review.instruction ?? null,
        );
        const templateColor = (designResult as Record<string, unknown>).color;
        const persona = await createPersona({
          name: name.slice(0, 60),
          description: review.instruction?.slice(0, 200) ?? undefined,
          system_prompt: "You are a helpful AI assistant.",
          icon: resolved.icon,
          color: typeof templateColor === "string" && templateColor ? templateColor : resolved.color,
        });
        createdPersonaId = persona.id;
        setPersonaId(persona.id);

        // Create an adoption build session so test_build_draft can work.
        // Pass resolvedCellsJson so hydrateBuildSession restores populated cells.
        // Use effectiveDesignResult so the session carries the user's trigger
        // selections, not the template's defaults.
        const agentIrJson = JSON.stringify(effectiveDesignResult);
        const resolvedCellsJson = JSON.stringify(dimensionData);
        const sessionId = await invokeWithTimeout<string>("create_adoption_session", {
          personaId: persona.id,
          // Append a prose hint for the picked cross-persona event
          // subscriptions so the backend LLM has the context the structured
          // event_subscriptions can't fully convey (matches the glyph
          // builder's serializeQuickConfig approach).
          intent: (review.instruction || templateName)
            + manualConnectorsHint(manualConnectors, connectorTables)
            + notificationChannelsHint(notificationChannels)
            + eventSubscriptionsHint(eventSubsByCap),
          agentIrJson,
          resolvedCellsJson,
        });
        adoptionSessionIdRef.current = sessionId;

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
        } catch (err) { silentCatch("features/templates/sub_generated/adoption/ChronologyAdoptionView:catch3")(err); }

        // Show progress dot on design-reviews sidebar
        useSystemStore.getState().setTemplateAdoptActive(true);

        setSeeded(true);
        seedDone.current = true;
      } catch (err) {
        logger.error("Failed to create draft persona for adoption", { err });
        // Clean up the orphaned draft persona if createPersona succeeded but a
        // later step failed. Without this, every transient backend failure
        // leaves a phantom draft in the user's persona list.
        if (createdPersonaId) {
          void useAgentStore
            .getState()
            .deletePersona(createdPersonaId)
            .catch(() => { /* best-effort cleanup */ });
          setPersonaId(null);
        }
        useToastStore.getState().addToast(
          `Failed to start template adoption: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`,
          'error',
        );
        // Leave seedDone=false so the next render can retry the seed.
      } finally {
        seedInFlight.current = false;
      }
    })();
  }, [designResult, templateName, review.instruction, createPersona, hasFilteredQuestions, questionsComplete, useCaseStepDone, showUseCasePicker, selectedUseCaseIds, filteredAdoptionQuestions, adoptionAnswers, triggerSelections, errorPolicyByCap, dimPolicyByCap, eventSubsByCap, manualConnectors, connectorTables, notificationChannels, t, tx]);

  const build = useBuild({ personaId });
  const lifecycle = useLifecycle({ personaId });

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
      // A new pending question means the user will answer again → re-adjust the
      // base IR for the new answers before the next test round.
      setAdjustedPersonaId((prev) => (prev === personaId ? null : prev));
    }
  }, [build.pendingQuestions, personaId]);

  // Approach 1 — always-on LLM adjustment of the pre-built base IR. Runs once
  // per adopted persona, after answers are seeded and BEFORE the auto-test, so
  // the test + promote operate on a persona specialized to the user's actual
  // connector/credential picks and configuration answers. The backend falls
  // back to the untouched base IR on any failure/timeout, so a failed or slow
  // adjustment never blocks adoption — it only degrades to today's behavior.
  useEffect(() => {
    if (!seeded || !personaId) return;
    if (currentBuildPhase !== 'draft_ready') return;
    if (hasFilteredQuestions && !questionsComplete) return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.buildError) return;
    if (adjustedPersonaId === personaId || adjustingRef.current) return;
    const sessionId = adoptionSessionIdRef.current;
    if (!sessionId) return;
    adjustingRef.current = true;
    void (async () => {
      try {
        void import("@/stores/overviewStore")
          .then(({ useOverviewStore }) => {
            useOverviewStore.getState().updateProcessStatus('template_adopt', 'running', {
              lastEvent: 'Adjusting persona to your setup…',
              runId: personaId,
            });
          })
          .catch(() => {});
        // Long timeout: above the backend's 600s LLM margin so the frontend
        // never gives up before the backend resolves (scoped output keeps the
        // typical pass well under a minute).
        await invokeWithTimeout("adjust_adoption_draft", { sessionId }, { timeoutMs: 660_000 });
      } catch (err) {
        // Non-fatal: backend keeps the deterministic base IR on failure.
        silentCatch("features/templates/sub_generated/adoption/ChronologyAdoptionView:adjust")(err);
      } finally {
        adjustingRef.current = false;
        setAdjustedPersonaId(personaId);
      }
    })();
  }, [seeded, personaId, currentBuildPhase, hasFilteredQuestions, questionsComplete, build.pendingQuestions, build.buildError, adjustedPersonaId]);

  useEffect(() => {
    if (!seeded || !personaId) return;
    if (currentBuildPhase !== 'draft_ready') return;
    if (autoTestedRef.current === personaId) return;
    if (hasFilteredQuestions && !questionsComplete) return;
    if (build.pendingQuestions && build.pendingQuestions.length > 0) return;
    if (build.buildError) return;
    // Wait for the always-on adjustment pass to finish so the test/promote run
    // against the specialized IR.
    if (adjustedPersonaId !== personaId) return;
    autoTestedRef.current = personaId;
    void lifecycle.handleStartTest();
  }, [seeded, personaId, currentBuildPhase, hasFilteredQuestions, questionsComplete, build.pendingQuestions, build.buildError, adjustedPersonaId, lifecycle]);
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
    // The category passed in may already be a real category key
    // (`messaging`, `email`, `image_generation`) OR a service_type that
    // got promoted to category by the upstream useDynamicQuestionOptions
    // fallback (`gmail`, `notion`, …). QuickAddCredentialModal filters
    // the catalog with `connectorsInCategory(category)` which only
    // matches real category tags — passing a service_type returns an
    // empty candidate list and the modal looks broken. Resolve the
    // service_type → category here so the picker always has candidates.
    const builtin = BUILTIN_CONNECTORS.find((c) => c.name === category);
    const normalizedCategory = builtin
      ? connectorCategoryTags(builtin.name)[0] ?? category
      : category;
    setQuickAddContext({
      category: normalizedCategory,
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

  // Wrapper around the plain `setAdoptionAnswers` that also auto-prompts
  // for credential setup when the user picks an option whose service_type
  // has no matching vault credential. Without this, the user would pick
  // "Gmail OAuth" (just a label) and proceed to build, only to see tests
  // fail with "Missing keys: email" — because the answer doesn't create
  // a credential, it just records intent.
  //
  // Behaviour: set the answer first (so the picked option stays selected
  // visually); then, if the question carries a vault_category and the
  // picked option's service_type has no matching credential in the vault,
  // open the QuickAddCredentialModal scoped to that category. If the user
  // dismisses the modal, the answer remains — they can add the credential
  // later. If they complete the add flow, handleCredentialAdded re-sets
  // the answer to the freshly created service_type.
  const credentialServiceTypesSet = useMemo(
    () => new Set(credentialServiceTypes),
    [credentialServiceTypes],
  );
  const handleAnswerUpdated = useCallback(
    (id: string, answer: string) => {
      setAdoptionAnswers((prev) => ({ ...prev, [id]: answer }));
      const q = filteredAdoptionQuestions.find((qq) => qq.id === id);
      if (!q) return;
      // Resolve the picked option's service_type via the parallel
      // option_service_types[] array. Skip if the question doesn't
      // declare option types or the value isn't a known option (free
      // text fallthrough).
      const options = q.options ?? [];
      const ost = q.option_service_types ?? [];
      if (options.length === 0 || ost.length !== options.length) return;
      const idx = options.indexOf(answer);
      if (idx < 0) return;
      const serviceType = ost[idx];
      if (!serviceType) return; // null fallback option = no credential needed
      if (!q.vault_category) return;
      if (hasMatchingCredential(serviceType, credentialServiceTypesSet)) return;
      // Open the QuickAddCredentialModal — handleAddCredentialForCategory
      // resolves the vault category and sets `quickAddContext`, which
      // mounts QuickAddCredentialModal. After the user completes the add
      // flow, handleCredentialAdded re-sets the answer to the freshly
      // created credential's service_type.
      handleAddCredentialForCategory(q.vault_category);
    },
    [
      filteredAdoptionQuestions,
      credentialServiceTypesSet,
      handleAddCredentialForCategory,
    ],
  );

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
      } catch (err) { silentCatch("features/templates/sub_generated/adoption/ChronologyAdoptionView:catch4")(err); }
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

  // Auto-redirect after promotion (matches UnifiedBuildEntry behavior)
  const buildPhaseForRedirect = useAgentStore((s) => s.buildPhase);
  useEffect(() => {
    if (buildPhaseForRedirect !== 'promoted' || !personaId || fadeOut) return;
    const timer = setTimeout(() => handleViewAgent(), 1500);
    return () => clearTimeout(timer);
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
        ? applyTriggerSelections(designResult, triggerSelections.perUseCase, t, tx)
        : designResult;
      const dimensionData = extractDimensionData(
        effective,
        undefined,
        showUseCasePicker ? selectedUseCaseIds : undefined,
        t,
      );
      store.patchActiveSession({ cellData: dimensionData, draft: effective });
    }
  }, [designResult, triggerSelections.perUseCase, t, tx, showUseCasePicker, selectedUseCaseIds]);

  if (!seeded) {
    // Pre-seed surface — Persona Layout is the only adoption layout. It
    // handles capability selection + the questionnaire inline (its single
    // Continue advances both the use-case-picker step and questionsComplete).
    const personaLayoutBranch = (
      <PersonaLayoutAdoption
        designResult={designResult}
        templateName={templateName}
        selectedUseCaseIds={selectedUseCaseIds}
        onToggleUseCase={toggleUseCase}
        questions={filteredAdoptionQuestions}
        userAnswers={adoptionAnswers}
        onAnswerUpdated={handleAnswerUpdated}
        autoDetectedIds={autoDetectedIds}
        blockedQuestionIds={blockedQuestionIds}
        filteredOptions={filteredOptions}
        dynamicOptions={dynamicOptions}
        onRetryDynamic={retryDynamic}
        onAddCredential={handleAddCredentialForCategory}
        useCaseTitleById={useCaseTitleById}
        onContinue={() => {
          if (showUseCasePicker && !useCasesPicked) setUseCasesPicked(true);
          if (hasFilteredQuestions && !questionsComplete) setQuestionsComplete(true);
        }}
        onClose={onClose}
        errorPolicyByCap={errorPolicyByCap}
        onErrorPolicyChange={handleErrorPolicyChange}
        triggerSelections={perUseCaseTriggerSelections}
        onTriggerChange={handleTriggerChange}
        eventSubsByCap={eventSubsByCap}
        onEventSubsChange={handleEventSubsChange}
        dimPolicyByCap={dimPolicyByCap}
        onDimPolicyChange={handleDimPolicyChange}
        manualConnectors={manualConnectors}
        onManualConnectorsChange={setManualConnectors}
        connectorTables={connectorTables}
        onConnectorTablesChange={setConnectorTables}
        notificationChannels={notificationChannels}
        onNotificationChannelsChange={setNotificationChannels}
      />
    );

    return (
      // `flex-1 min-h-0` (not `h-full`) so this wrapper takes the *remaining*
      // height after AdoptionWizardModal's title bar inside the 92vh modal
      // panel. With `h-full`, the wrapper was 92vh on top of the ~60px title
      // bar — the bottom overflowed `overflow-hidden` on the modal's inner
      // container, the inner scroll container's parent never had a bounded
      // height, and the main content (sigil + rows) wasn't scrollable.
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">
          {personaLayoutBranch}
        </div>
        {/* QuickAddCredentialModal is needed in BOTH branches (Classic and
         *  Persona Layout fire `handleAddCredentialForCategory` which sets
         *  `quickAddContext`). Previously the modal only mounted in the
         *  post-seed return below, so clicking "Add credential" in pre-seed
         *  set state but rendered nothing. */}
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

  return (
    <div className={`flex-1 min-h-0 flex flex-col w-full overflow-x-auto overflow-y-auto px-4 pt-2 transition-opacity duration-400 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      {/* Build / test / promote phases live INSIDE the Persona Layout shell —
          Persona Sigil hero + capability rows + phase-aware controls below,
          the same screen the user just configured. */}
      <PersonaLayoutBuild
        buildPhase={build.buildPhase}
        completeness={build.completeness}
        isBuilding={build.isBuilding}
        buildActivity={build.buildActivity}
        cellStates={build.cellStates}
        pendingQuestions={build.pendingQuestions}
        onAnswerBuildQuestion={build.handleAnswer}
        onStartTest={lifecycle.handleStartTest}
        onApproveTest={lifecycle.handlePromote}
        onApproveTestAnyway={() => { void lifecycle.handlePromote({ force: true }); }}
        onRejectTest={lifecycle.handleRejectTest}
        onDeleteDraft={handleDeleteDraft}
        onRefine={lifecycle.handleRefine}
        onViewAgent={handleViewAgent}
        templateName={templateName}
        testOutputLines={build.buildTestOutputLines}
        testPassed={build.buildTestPassed}
        testError={build.buildTestError}
        toolTestResults={lifecycle.buildToolTestResults}
        testSummary={lifecycle.buildTestSummary}
      />
      {/* Legacy: handleApplyEdits / handleDiscardEdits were wired to the
          original PersonaMatrix variant; keep the callbacks live for build
          flow even though no surface currently invokes them. */}
      {void (handleApplyEdits || handleDiscardEdits)}

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

