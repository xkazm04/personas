import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { errMsg, reportError } from "../../storeTypes";
import { useSystemStore } from "../../systemStore";
import type {
  Persona,
  PersonaWithDetails,
} from "@/lib/types/types";
import type { PartialPersonaUpdate, PersonaOperation } from "@/api/agents/personas";
import { buildUpdateInput, operationToPartial } from "@/api/agents/personas";
import type { PersonaHealth } from "@/lib/bindings/PersonaHealth";
import { createPersona, deletePersona, duplicatePersona, getPersonaDetail, getPersonaSummaries, listPersonas, updatePersona } from "@/api/agents/personas";
import { trackRecentAgent, removeRecentAgent } from "@/hooks/agents/useRecentAgents";
import { classifyUnknownError, categoryLabel } from "@/lib/errorTaxonomy";

const DEGRADATION_THRESHOLD = 3;

export interface PersonaSlice {
  // State
  personas: Persona[];
  selectedPersonaId: string | null;
  selectedPersona: PersonaWithDetails | null;
  personaTriggerCounts: Record<string, number>;
  personaLastRun: Record<string, string | null>;
  personaHealthMap: Record<string, PersonaHealth>;
  summaryConsecutiveFailures: number;
  detailConsecutiveFailures: number;
  degradationError: string | null;

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
}

let fetchDetailSeq = 0;

export const createPersonaSlice: StateCreator<AgentStore, [], [], PersonaSlice> = (set, get) => ({
  personas: [],
  selectedPersonaId: null,
  selectedPersona: null,
  personaTriggerCounts: {},
  personaLastRun: {},
  personaHealthMap: {},
  summaryConsecutiveFailures: 0,
  detailConsecutiveFailures: 0,
  degradationError: null,

  fetchPersonas: async () => {
    set({ isLoading: true, error: null });
    try {
      const personas = await listPersonas();
      set((state) => {
        // Validate persisted selection -- clear if the persona was deleted
        const stillExists =
          state.selectedPersonaId == null ||
          personas.some((p) => p.id === state.selectedPersonaId);
        return {
          personas,
          isLoading: false,
          selectedPersonaId: stillExists ? state.selectedPersonaId : null,
          selectedPersona: stillExists ? state.selectedPersona : null,
        };
      });
      // Fire-and-forget: load sidebar badge data
      get().fetchPersonaSummaries();
    } catch (err) {
      reportError(err, "Failed to fetch personas", set, { stateUpdates: { isLoading: false } });
      throw err;
    }
  },

  fetchPersonaSummaries: async () => {
    try {
      const summaries = await getPersonaSummaries();
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
      const failures = get().summaryConsecutiveFailures + 1;
      const category = classifyUnknownError(err);
      console.warn(`[personaSlice] fetchPersonaSummaries failed (${categoryLabel(category)}, attempt ${failures})`, err);
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

      set({
        selectedPersona: detail,
        selectedPersonaId: id,
        isLoading: false,
        detailConsecutiveFailures: 0,
        degradationError: get().summaryConsecutiveFailures >= DEGRADATION_THRESHOLD
          ? get().degradationError : null,
      });
    } catch (err) {
      if (seq !== fetchDetailSeq) return; // superseded by a newer request
      const failures = get().detailConsecutiveFailures + 1;
      const category = classifyUnknownError(err);
      console.warn(`[personaSlice] fetchDetail(${id}) failed (${categoryLabel(category)}, attempt ${failures})`, err);
      // Clear stale selection so the editor doesn't render with missing data
      set({
        error: errMsg(err, "Failed to fetch persona"),
        isLoading: false,
        selectedPersonaId: null,
        selectedPersona: null,
        detailConsecutiveFailures: failures,
        degradationError: failures >= DEGRADATION_THRESHOLD
          ? `Persona loading degraded (${categoryLabel(category)} error, ${failures} consecutive failures)`
          : get().degradationError,
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
      set((state) => ({
        personas: state.personas.map((p) => (p.id === id ? persona : p)),
        selectedPersona:
          state.selectedPersona?.id === id
            ? { ...state.selectedPersona, ...persona }
            : state.selectedPersona,
      }));
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
      await deletePersona(id);
      removeRecentAgent(id);
      // Invalidate any in-flight fetchDetail for this persona so it can't
      // resurrect the deleted persona in state after the delete completes.
      if (get().selectedPersonaId === id) ++fetchDetailSeq;
      set((state) => ({
        personas: state.personas.filter((p) => p.id !== id),
        selectedPersonaId: state.selectedPersonaId === id ? null : state.selectedPersonaId,
        selectedPersona: state.selectedPersona?.id === id ? null : state.selectedPersona,
      }));
    } catch (err) {
      reportError(err, "Failed to delete persona", set);
    }
  },

  selectPersona: (id) => {
    if (!id) ++fetchDetailSeq; // invalidate any in-flight fetchDetail
    set({ selectedPersonaId: id, queuePosition: null, queueDepth: null });
    useSystemStore.getState().setEditorTab("use-cases");
    if (id) useSystemStore.setState({ sidebarSection: "personas" });
    useSystemStore.setState({ isCreatingPersona: false, resumeDraftId: null });
    if (id) {
      get().fetchDetail(id);
      trackRecentAgent(id);
    } else {
      set({ selectedPersona: null });
    }
  },
});
