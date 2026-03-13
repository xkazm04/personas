import type { StateCreator } from "zustand";
import type { VaultStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import type {
  PersonaAutomation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@/lib/bindings/PersonaAutomation";
import type { DeployAutomationInput, DeployAutomationResult, ZapierZap, ZapierWebhookResult } from "@/api/agents/automations";
import * as api from "@/api/agents/automations";
import { useToastStore } from "@/stores/toastStore";

export interface AutomationSlice {
  // State
  automations: PersonaAutomation[];
  automationRuns: Record<string, AutomationRun[]>;
  zapierZaps: ZapierZap[];
  zapierZapsLoading: boolean;

  // Actions
  fetchAutomations: (personaId: string) => Promise<void>;
  createAutomation: (input: CreateAutomationInput) => Promise<PersonaAutomation | null>;
  updateAutomation: (id: string, input: UpdateAutomationInput) => Promise<void>;
  deleteAutomation: (id: string) => Promise<void>;
  triggerAutomation: (id: string, inputData?: string) => Promise<AutomationRun | null>;
  testAutomation: (id: string) => Promise<AutomationRun | null>;
  fetchAutomationRuns: (automationId: string) => Promise<void>;
  deployAutomation: (input: DeployAutomationInput) => Promise<DeployAutomationResult | null>;
  fetchZapierZaps: (credentialId: string) => Promise<void>;
  zapierTestWebhook: (credentialId: string, webhookUrl: string, body?: Record<string, unknown>) => Promise<ZapierWebhookResult | null>;
}

export const createAutomationSlice: StateCreator<VaultStore, [], [], AutomationSlice> = (set, get) => ({
  automations: [],
  automationRuns: {},
  zapierZaps: [],
  zapierZapsLoading: false,

  fetchAutomations: async (personaId) => {
    try {
      const automations = await api.listAutomations(personaId);
      set({ automations });
    } catch {
      useToastStore.getState().addToast('Failed to load automations', 'error');
    }
  },

  createAutomation: async (input) => {
    try {
      const automation = await api.createAutomation(input);
      set((state) => ({ automations: [...state.automations, automation] }));
      return automation;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create automation") });
      return null;
    }
  },

  updateAutomation: async (id, input) => {
    try {
      const updated = await api.updateAutomation(id, input);
      set((state) => ({
        automations: state.automations.map((a) => (a.id === id ? updated : a)),
      }));
    } catch (err) {
      set({ error: errMsg(err, "Failed to update automation") });
    }
  },

  deleteAutomation: async (id) => {
    const itemToDelete = get().automations.find((a) => a.id === id);
    if (!itemToDelete) return;

    set((state) => ({ automations: state.automations.filter((a) => a.id !== id) }));
    try {
      await api.deleteAutomation(id);
    } catch (err) {
      // Re-fetch from backend instead of appending stale item to avoid
      // duplicates if a concurrent fetch already restored the list.
      const personaId = itemToDelete.personaId;
      if (personaId) {
        await get().fetchAutomations(personaId);
      }
      set({ error: errMsg(err, "Failed to delete automation") });
    }
  },

  triggerAutomation: async (id, inputData) => {
    try {
      const run = await api.triggerAutomation(id, inputData);
      // Refresh automation to get updated last_triggered_at
      const personaId = get().automations.find((a) => a.id === id)?.personaId;
      if (personaId) get().fetchAutomations(personaId);
      return run;
    } catch (err) {
      set({ error: errMsg(err, "Failed to trigger automation") });
      return null;
    }
  },

  testAutomation: async (id) => {
    try {
      return await api.testAutomationWebhook(id);
    } catch (err) {
      set({ error: errMsg(err, "Automation test failed") });
      return null;
    }
  },

  fetchAutomationRuns: async (automationId) => {
    try {
      const runs = await api.getAutomationRuns(automationId);
      set({
        automationRuns: { ...get().automationRuns, [automationId]: runs },
        // Note: automationRuns uses get() intentionally -- runs are keyed by
        // automationId and concurrent fetches for different IDs are safe.
      });
    } catch {
      useToastStore.getState().addToast('Failed to load automation runs', 'error');
    }
  },

  deployAutomation: async (input) => {
    try {
      const result = await api.deployAutomation(input);
      set((state) => ({ automations: [...state.automations, result.automation] }));
      return result;
    } catch (err) {
      set({ error: errMsg(err, "Failed to deploy automation") });
      return null;
    }
  },

  fetchZapierZaps: async (credentialId) => {
    set({ zapierZapsLoading: true });
    try {
      const zaps = await api.zapierListZaps(credentialId);
      set({ zapierZaps: zaps, zapierZapsLoading: false });
    } catch {
      set({ zapierZapsLoading: false });
      useToastStore.getState().addToast('Failed to load Zapier zaps', 'error');
    }
  },

  zapierTestWebhook: async (credentialId, webhookUrl, body) => {
    try {
      return await api.zapierTriggerWebhook(credentialId, webhookUrl, body);
    } catch (err) {
      set({ error: errMsg(err, "Failed to trigger Zapier webhook") });
      return null;
    }
  },
});
