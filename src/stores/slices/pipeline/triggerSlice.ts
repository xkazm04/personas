import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";
import type { WebhookStatus } from "@/lib/bindings/WebhookStatus";
import * as api from "@/api/tauriApi";
import { useToastStore } from "@/stores/toastStore";
import type { TriggerRateLimitConfig } from "@/lib/utils/platform/triggerConstants";

/** Discriminated trigger error — `kind` tells UI whether to render inline or toast. */
export type TriggerErrorKind = 'crud' | 'fetch';

export interface TriggerError {
  kind: TriggerErrorKind;
  message: string;
}

/** Per-trigger rate limit runtime state. */
export interface TriggerRateLimitState {
  /** Timestamps (epoch ms) of recent firings within the current window. */
  firingTimestamps: number[];
  /** Number of currently executing (in-flight) runs for this trigger. */
  concurrentCount: number;
  /** Number of queued triggers waiting to fire. */
  queueDepth: number;
  /** Whether this trigger is currently throttled. */
  isThrottled: boolean;
  /** Timestamp (epoch ms) when cooldown expires, or 0 if not in cooldown. */
  cooldownUntil: number;
}

const EMPTY_RATE_LIMIT_STATE: TriggerRateLimitState = {
  firingTimestamps: [],
  concurrentCount: 0,
  queueDepth: 0,
  isThrottled: false,
  cooldownUntil: 0,
};

export interface TriggerSlice {
  // State
  triggerChains: TriggerChainLink[];
  webhookStatus: WebhookStatus | null;
  triggerError: TriggerError | null;
  /** Per-trigger rate limit runtime state, keyed by trigger ID. */
  triggerRateLimits: Record<string, TriggerRateLimitState>;

  // Actions
  createTrigger: (personaId: string, input: { trigger_type: string; config?: object; enabled?: boolean; use_case_id?: string | null }) => Promise<void>;
  updateTrigger: (personaId: string, triggerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteTrigger: (personaId: string, triggerId: string) => Promise<void>;
  fetchTriggerChains: () => Promise<void>;
  fetchWebhookStatus: () => Promise<void>;
  clearTriggerError: () => void;
  /** Record a trigger firing — enforces rate limits and returns whether the firing is allowed. */
  recordTriggerFiring: (triggerId: string, rateLimitConfig: TriggerRateLimitConfig) => boolean;
  /** Record that a trigger execution completed (decrements concurrent count, drains queue). */
  recordTriggerComplete: (triggerId: string) => void;
  /** Get the aggregate rate limit summary across all triggers. */
  getRateLimitSummary: () => { totalQueued: number; totalThrottled: number; throttledTriggerIds: string[] };
}

export const createTriggerSlice: StateCreator<PersonaStore, [], [], TriggerSlice> = (set, get) => ({
  triggerChains: [],
  webhookStatus: null,
  triggerError: null,
  triggerRateLimits: {},

  createTrigger: async (personaId, input) => {
    set({ triggerError: null });
    try {
      await api.createTrigger({
        persona_id: personaId,
        trigger_type: input.trigger_type,
        config: input.config != null ? JSON.stringify(input.config) : null,
        enabled: input.enabled ?? null,
        use_case_id: input.use_case_id ?? null,
      });
      get().fetchDetail(personaId);
    } catch (err) {
      set({ triggerError: { kind: 'crud', message: errMsg(err, "Failed to create trigger") } });
    }
  },

  updateTrigger: async (personaId, triggerId, updates) => {
    set({ triggerError: null });
    try {
      await api.updateTrigger(triggerId, personaId, {
        trigger_type: (updates.trigger_type as string) ?? null,
        config: updates.config != null ? JSON.stringify(updates.config) : null,
        enabled: updates.enabled !== undefined ? (updates.enabled as boolean) : null,
        next_trigger_at: null,
      });
      get().fetchDetail(personaId);
    } catch (err) {
      set({ triggerError: { kind: 'crud', message: errMsg(err, "Failed to update trigger") } });
    }
  },

  deleteTrigger: async (personaId, triggerId) => {
    set({ triggerError: null });
    try {
      await api.deleteTrigger(triggerId, personaId);
      get().fetchDetail(personaId);
    } catch (err) {
      set({ triggerError: { kind: 'crud', message: errMsg(err, "Failed to delete trigger") } });
    }
  },

  fetchTriggerChains: async () => {
    try {
      const chains = await api.listTriggerChains();
      set({ triggerChains: chains });
    } catch (err) {
      set({ triggerError: { kind: 'fetch', message: errMsg(err, "Failed to load trigger chains") } });
      useToastStore.getState().addToast('Failed to load trigger chains', 'error');
    }
  },

  fetchWebhookStatus: async () => {
    try {
      const status = await api.getWebhookStatus();
      set({ webhookStatus: status });
    } catch (err) {
      set({ triggerError: { kind: 'fetch', message: errMsg(err, "Failed to load webhook status") } });
      useToastStore.getState().addToast('Failed to load webhook status', 'error');
    }
  },

  clearTriggerError: () => set({ triggerError: null }),

  recordTriggerFiring: (triggerId, rl) => {
    const now = Date.now();
    const prev = get().triggerRateLimits[triggerId] ?? { ...EMPTY_RATE_LIMIT_STATE };

    // Prune timestamps outside the window
    const windowStart = now - rl.window_seconds * 1000;
    const recentTimestamps = prev.firingTimestamps.filter((t) => t > windowStart);

    // Check cooldown
    if (rl.cooldown_seconds > 0 && prev.cooldownUntil > now) {
      set({
        triggerRateLimits: {
          ...get().triggerRateLimits,
          [triggerId]: { ...prev, firingTimestamps: recentTimestamps, queueDepth: prev.queueDepth + 1, isThrottled: true },
        },
      });
      return false;
    }

    // Check window rate limit
    if (rl.max_per_window > 0 && recentTimestamps.length >= rl.max_per_window) {
      set({
        triggerRateLimits: {
          ...get().triggerRateLimits,
          [triggerId]: { ...prev, firingTimestamps: recentTimestamps, queueDepth: prev.queueDepth + 1, isThrottled: true },
        },
      });
      return false;
    }

    // Check concurrent execution cap
    if (rl.max_concurrent > 0 && prev.concurrentCount >= rl.max_concurrent) {
      set({
        triggerRateLimits: {
          ...get().triggerRateLimits,
          [triggerId]: { ...prev, firingTimestamps: recentTimestamps, queueDepth: prev.queueDepth + 1, isThrottled: true },
        },
      });
      return false;
    }

    // Allowed — record the firing
    set({
      triggerRateLimits: {
        ...get().triggerRateLimits,
        [triggerId]: {
          firingTimestamps: [...recentTimestamps, now],
          concurrentCount: prev.concurrentCount + 1,
          queueDepth: prev.queueDepth,
          isThrottled: false,
          cooldownUntil: rl.cooldown_seconds > 0 ? now + rl.cooldown_seconds * 1000 : 0,
        },
      },
    });
    return true;
  },

  recordTriggerComplete: (triggerId) => {
    const prev = get().triggerRateLimits[triggerId];
    if (!prev) return;

    const newConcurrent = Math.max(0, prev.concurrentCount - 1);
    const newQueueDepth = Math.max(0, prev.queueDepth - 1);

    set({
      triggerRateLimits: {
        ...get().triggerRateLimits,
        [triggerId]: {
          ...prev,
          concurrentCount: newConcurrent,
          queueDepth: newQueueDepth,
          isThrottled: newQueueDepth > 0 || prev.isThrottled,
        },
      },
    });
  },

  getRateLimitSummary: () => {
    const limits = get().triggerRateLimits;
    let totalQueued = 0;
    let totalThrottled = 0;
    const throttledTriggerIds: string[] = [];

    for (const [id, state] of Object.entries(limits)) {
      totalQueued += state.queueDepth;
      if (state.isThrottled) {
        totalThrottled++;
        throttledTriggerIds.push(id);
      }
    }

    return { totalQueued, totalThrottled, throttledTriggerIds };
  },
});
