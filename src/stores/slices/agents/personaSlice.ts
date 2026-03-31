import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { errMsg, reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("persona");
import type {
  Persona,
  PersonaWithDetails,
  PersonaToolDefinition,
  PersonaTrigger,
  PersonaEventSubscription,
} from "@/lib/types/types";
import type { PersonaAutomation } from "@/lib/bindings/PersonaAutomation";
import type { PartialPersonaUpdate, PersonaOperation } from "@/api/agents/personas";
import { buildUpdateInput, operationToPartial } from "@/api/agents/personas";
import type { PersonaHealth } from "@/lib/bindings/PersonaHealth";
import { createPersona, deletePersona, duplicatePersona, getPersonaDetail, getPersonaSummaries, listPersonas, updatePersona } from "@/api/agents/personas";
import { trackRecentAgent, removeRecentAgent } from "@/hooks/agents/useRecentAgents";
import { classifyUnknownError, categoryLabel } from "@/lib/errorTaxonomy";
import { storeBus } from "@/lib/storeBus";
import { autoAssignPersonaIcons } from "@/lib/icons/autoAssignIcons";

const DEGRADATION_THRESHOLD = 3;

/** Sub-resources fetched via getPersonaDetail, cached by persona ID. */
export interface PersonaDetailExtras {
  tools: PersonaToolDefinition[];
  triggers: PersonaTrigger[];
  subscriptions?: PersonaEventSubscription[];
  automations?: PersonaAutomation[];
  warnings?: string[];
}

/**
 * Derive selectedPersona by merging the canonical Persona from personas[]
 * with the cached sub-resources from detailCache. This eliminates stale
 * sub-resource data that previously survived spread merges after updatePersona().
 */
function deriveSelectedPersona(
  personas: Persona[],
  selectedPersonaId: string | null,
  detailCache: Record<string, PersonaDetailExtras>,
): PersonaWithDetails | null {
  if (!selectedPersonaId) return null;
  const base = personas.find((p) => p.id === selectedPersonaId);
  if (!base) return null;
  const extras = detailCache[selectedPersonaId];
  if (!extras) return null;
  return { ...base, ...extras };
}

export interface PersonaSlice {
  // State
  personas: Persona[];
  selectedPersonaId: string | null;
  selectedPersona: PersonaWithDetails | null;
  /** Cached sub-resources (tools, triggers, etc.) keyed by persona ID. */
  detailCache: Record<string, PersonaDetailExtras>;
  personaTriggerCounts: Record<string, number>;
  personaLastRun: Record<string, string | null>;
  personaHealthMap: Record<string, PersonaHealth>;
  summaryConsecutiveFailures: number;
  detailConsecutiveFailures: number;
  degradationError: string | null;
  /** Whether the editor has unsaved changes -- set by EditorBody. */
  isEditorDirty: boolean;
  /** Persona ID the user tried to switch to while dirty. */
  pendingSelectPersonaId: string | null;

  // Actions
  fetchPersonas: () => Promise<void>;
  fetchPersonaSummaries: () => Promise<void>;
  fetchDetail: (id: string) => Promise<void>;
  createPersona: (input: { name: string; description?: string; system_prompt: string; icon?: string; color?: string; structured_prompt?: string; design_context?: string }) => Promise<Persona>;
  duplicatePersona: (id: string) => Promise<Persona>;
  updatePersona: (id: string, input: PartialPersonaUpdate) => Promise<void>;
  applyPersonaOp: (id: string, op: PersonaOperation) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  selectPersona: (id: string | null) => void;
  /** Called by EditorBody to sync dirty state into the store. */
  setEditorDirty: (dirty: boolean) => void;
  /** Commit the pending switch (after save/discard). Clears pendingSelectPersonaId. */
  commitPendingSwitch: () => void;
  /** Cancel the pending switch without navigating. */
  cancelPendingSwitch: () => void;
}

let fetchDetailSeq = 0;
let fetchSummariesSeq = 0;

export const createPersonaSlice: StateCreator<AgentStore, [], [], PersonaSlice> = (set, get) => ({
  personas: [],
  selectedPersonaId: null,
  selectedPersona: null,
  detailCache: {},
  personaTriggerCounts: {},
  personaLastRun: {},
  personaHealthMap: {},
  summaryConsecutiveFailures: 0,
  detailConsecutiveFailures: 0,
  degradationError: null,
  isEditorDirty: false,
  pendingSelectPersonaId: null,

  fetchPersonas: async () => {
    set({ isLoading: true, error: null });
    try {
      const personas = await listPersonas();
      set((state) => {
        // Validate persisted selection -- clear if the persona was deleted
        const stillExists =
          state.selectedPersonaId == null ||
          personas.some((p) => p.id === state.selectedPersonaId);
        const nextId = stillExists ? state.selectedPersonaId : null;
        const nextCache = stillExists
          ? state.detailCache
          : (() => { const c = { ...state.detailCache }; if (state.selectedPersonaId) delete c[state.selectedPersonaId]; return c; })();
        return {
          personas,
          isLoading: false,
          selectedPersonaId: nextId,
          detailCache: nextCache,
          selectedPersona: deriveSelectedPersona(personas, nextId, nextCache),
        };
      });
      // Fire-and-forget: load sidebar badge data
      get().fetchPersonaSummaries();
      // One-time icon assignment for existing personas (idempotent)
      const needsAssignment = !localStorage.getItem('personas-icon-auto-assigned-v1');
      if (needsAssignment) {
        autoAssignPersonaIcons(personas).then(async () => {
          // Re-fetch to pick up newly assigned icons
          const updated = await listPersonas();
          set((s) => ({
            personas: updated,
            selectedPersona: deriveSelectedPersona(updated, s.selectedPersonaId, s.detailCache),
          }));
        }).catch(() => { /* silent */ });
      }
    } catch (err) {
      reportError(err, "Failed to fetch personas", set, { stateUpdates: { isLoading: false } });
      throw err;
    }
  },

  fetchPersonaSummaries: async () => {
    const seq = ++fetchSummariesSeq;
    try {
      const summaries = await getPersonaSummaries();
      if (seq !== fetchSummariesSeq) return; // superseded by a newer request
      const triggerCounts: Record<string, number> = {};
      const lastRun: Record<string, string | null> = {};
      const healthMap: Record<string, PersonaHealth> = {};
      for (const s of summaries) {
        triggerCounts[s.personaId] = s.enabledTriggerCount;
        lastRun[s.personaId] = s.lastRunAt;
        healthMap[s.personaId] = s.health;
      }
      set({
        personaTriggerCounts: triggerCounts,
        personaLastRun: lastRun,
        personaHealthMap: healthMap,
        summaryConsecutiveFailures: 0,
        degradationError: get().detailConsecutiveFailures >= DEGRADATION_THRESHOLD
          ? get().degradationError : null,
      });
    } catch (err) {
      if (seq !== fetchSummariesSeq) return; // superseded by a newer request
      const failures = get().summaryConsecutiveFailures + 1;
      const category = classifyUnknownError(err);
      logger.warn("fetchPersonaSummaries failed", { category: categoryLabel(category), attempt: failures, error: String(err) });
      set({
        summaryConsecutiveFailures: failures,
        degradationError: failures >= DEGRADATION_THRESHOLD
          ? `Sidebar data unavailable (${categoryLabel(category)} error, ${failures} consecutive failures)`
          : get().degradationError,
      });
    }
  },

  fetchDetail: async (id: string) => {
    const seq = ++fetchDetailSeq;
    set({ isLoading: true, error: null });
    try {
      // Single IPC round trip: persona + tools + triggers + subscriptions + automations
      const detail = await getPersonaDetail(id);
      if (seq !== fetchDetailSeq) return; // superseded by a newer request

      // Split detail into base Persona fields and sub-resource extras
      const { tools, triggers, subscriptions, automations, warnings, ...baseFields } = detail;
      const extras: PersonaDetailExtras = { tools, triggers, subscriptions, automations, warnings };

      set((state) => {
        const nextCache = { ...state.detailCache, [id]: extras };
        // Update the persona in the list if it exists, otherwise add it
        const inList = state.personas.some((p) => p.id === id);
        const nextPersonas = inList
          ? state.personas.map((p) => (p.id === id ? { ...p, ...baseFields } : p))
          : [...state.personas, baseFields as Persona];
        return {
          personas: nextPersonas,
          selectedPersonaId: id,
          detailCache: nextCache,
          selectedPersona: deriveSelectedPersona(nextPersonas, id, nextCache),
          isLoading: false,
          detailConsecutiveFailures: 0,
          degradationError: state.summaryConsecutiveFailures >= DEGRADATION_THRESHOLD
            ? state.degradationError : null,
        };
      });
    } catch (err) {
      if (seq !== fetchDetailSeq) return; // superseded by a newer request
      const failures = get().detailConsecutiveFailures + 1;
      const category = classifyUnknownError(err);
      logger.warn("fetchDetail failed", { personaId: id, category: categoryLabel(category), attempt: failures, error: String(err) });
      // Clear stale selection so the editor doesn't render with missing data
      set((state) => {
        const nextCache = { ...state.detailCache };
        if (id in nextCache) delete nextCache[id];
        return {
          error: errMsg(err, "Failed to fetch persona"),
          isLoading: false,
          selectedPersonaId: null,
          detailCache: nextCache,
          selectedPersona: null,
          detailConsecutiveFailures: failures,
          degradationError: failures >= DEGRADATION_THRESHOLD
            ? `Persona loading degraded (${categoryLabel(category)} error, ${failures} consecutive failures)`
            : state.degradationError,
        };
      });
    }
  },

  createPersona: async (input) => {
    set({ error: null });
    try {
      const persona = await createPersona({
        name: input.name,
        system_prompt: input.system_prompt,
        project_id: null,
        description: input.description ?? null,
        structured_prompt: input.structured_prompt ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        enabled: null,
        max_concurrent: null,
        timeout_ms: null,
        model_profile: null,
        max_budget_usd: null,
        max_turns: null,
        design_context: input.design_context ?? null,
        group_id: null,
        notification_channels: null,
      });
      set((state) => ({ personas: [persona, ...state.personas] }));
      return persona;
    } catch (err) {
      reportError(err, "Failed to create persona", set);
      throw err;
    }
  },

  duplicatePersona: async (id) => {
    set({ error: null });
    try {
      const newPersona = await duplicatePersona(id);
      set((state) => ({ personas: [newPersona, ...state.personas] }));
      return newPersona;
    } catch (err) {
      reportError(err, "Failed to duplicate persona", set);
      throw err;
    }
  },

  updatePersona: async (id, input) => {
    set({ error: null });
    try {
      const persona = await updatePersona(id, buildUpdateInput(input));
      set((state) => {
        const nextPersonas = state.personas.map((p) => (p.id === id ? persona : p));
        return {
          personas: nextPersonas,
          selectedPersona: deriveSelectedPersona(nextPersonas, state.selectedPersonaId, state.detailCache),
        };
      });
    } catch (err) {
      reportError(err, "Failed to update persona", set);
      throw err;
    }
  },

  applyPersonaOp: async (id, op) => {
    await get().updatePersona(id, operationToPartial(op));
  },

  deletePersona: async (id) => {
    set({ error: null });
    try {
      const result = await deletePersona(id);
      removeRecentAgent(id);
      // Invalidate any in-flight fetchDetail for this persona so it can't
      // resurrect the deleted persona in state after the delete completes.
      if (get().selectedPersonaId === id) ++fetchDetailSeq;
      set((state) => {
        const nextPersonas = state.personas.filter((p) => p.id !== id);
        const nextId = state.selectedPersonaId === id ? null : state.selectedPersonaId;
        const nextCache = { ...state.detailCache };
        delete nextCache[id];
        return {
          personas: nextPersonas,
          selectedPersonaId: nextId,
          detailCache: nextCache,
          selectedPersona: deriveSelectedPersona(nextPersonas, nextId, nextCache),
        };
      });

      // Show a summary toast when executions were affected during deletion
      const stopped = result.executionsCancelled + result.executionsForceCancelled;
      if (stopped > 0 || result.cancelFailures.length > 0) {
        const parts: string[] = ["Deleted."];
        if (stopped > 0) {
          parts.push(`${stopped} running execution${stopped !== 1 ? "s were" : " was"} force-stopped.`);
        }
        if (result.cancelFailures.length > 0) {
          parts.push(`${result.cancelFailures.length} execution${result.cancelFailures.length !== 1 ? "s" : ""} could not be cancelled.`);
        }
        if (result.timeoutReached) {
          parts.push("Drain timeout was reached.");
        }
        const hasFailures = result.cancelFailures.length > 0;
        storeBus.emit('toast', {
          message: parts.join(" "),
          type: hasFailures ? "error" : "success",
          duration: hasFailures ? 8000 : 5000,
        });
      }
    } catch (err) {
      reportError(err, "Failed to delete persona", set);
    }
  },

  selectPersona: (id) => {
    const prev = get().selectedPersonaId;

    // Store-level dirty guard: if the editor has unsaved changes and the user
    // is trying to switch to a different persona, stash the target and bail.
    // This prevents fetchDetail from firing for the new persona, eliminating
    // the race where a late-arriving detail response overwrites reverted state.
    if (id !== prev && prev != null && get().isEditorDirty) {
      set({ pendingSelectPersonaId: id });
      return;
    }

    // Warn when navigating away from a persona that has an active/queued execution
    if (id !== prev && prev != null) {
      const { isExecuting, executionPersonaId, queuePosition } = get();
      if (isExecuting && executionPersonaId === prev) {
        const label = queuePosition != null ? "queued" : "running";
        storeBus.emit('toast', {
          message: `Execution still ${label} for the previous agent. Switch back to monitor it.`,
          type: "success",
          duration: 5000,
        });
      }
    }

    if (!id) ++fetchDetailSeq; // invalidate any in-flight fetchDetail
    set((state) => ({
      selectedPersonaId: id,
      pendingSelectPersonaId: null,
      // Derive immediately from cache if available; fetchDetail will refresh below
      selectedPersona: id
        ? deriveSelectedPersona(state.personas, id, state.detailCache)
        : null,
    }));
    storeBus.emit('persona:selected', { personaId: id });
    if (id) {
      get().fetchDetail(id);
      trackRecentAgent(id);
    }
  },

  setEditorDirty: (dirty) => {
    set({ isEditorDirty: dirty });
  },

  commitPendingSwitch: () => {
    const target = get().pendingSelectPersonaId;
    set({ pendingSelectPersonaId: null, isEditorDirty: false });
    if (target !== null) get().selectPersona(target);
  },

  cancelPendingSwitch: () => {
    set({ pendingSelectPersonaId: null });
  },
});
