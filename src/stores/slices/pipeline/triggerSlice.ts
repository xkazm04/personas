import type { StateCreator } from "zustand";
import { produce } from "immer";
import type { PipelineStore } from "../../storeTypes";
import { errMsg, reportError } from "../../storeTypes";
import { storeBus } from "@/lib/storeBus";
import type { WebhookStatus } from "@/lib/bindings/WebhookStatus";
import { createTrigger, deleteTrigger, getWebhookStatus, updateTrigger } from "@/api/pipeline/triggers";
import type { TriggerRateLimitConfig } from "@/lib/utils/platform/triggerConstants";

/**
 * Discriminated trigger-error tag indicating *how* the error should be presented.
 *
 * Contract — pinned here, enforced by the renderer at
 * `src/features/triggers/lib/triggerError.ts`. Every UI surface that displays
 * a trigger error must dispatch through `useRenderTriggerError` (or call
 * `triggerErrorPresentation` directly) rather than reading `triggerError.message`
 * inline, so the kind→surface mapping stays uniform across builder, studio,
 * dry-run panel, and any future surface.
 *
 *   - `crud`        → INLINE form error. Origin: create/update/delete operations
 *                     where the user has an active form they can correct. Render
 *                     adjacent to the offending control.
 *   - `validation`  → INLINE form error. Origin: validate-before-fire pre-checks
 *                     (cron syntax, missing credential binding, schema mismatch).
 *                     Same surface as `crud` — both are "the user typed something
 *                     we can't accept." Split out so callers (and tests) can
 *                     distinguish "the request reached the backend and failed"
 *                     from "we caught it before sending."
 *   - `fetch`       → TOAST. Origin: passive background loads (webhook status,
 *                     listener registry refresh) where there is no form context.
 *                     Inline rendering would be invisible during a passive load
 *                     and the user has nothing to correct.
 *
 * Adding a new kind requires updating `triggerErrorPresentation()` — the
 * exhaustive `switch` there fails the type-check until you classify it.
 */
export type TriggerErrorKind = 'crud' | 'fetch' | 'validation';

export interface TriggerError {
  kind: TriggerErrorKind;
  message: string;
}

/** Snapshot of a trigger's configured limits, stored on the runtime state so
 *  `recordTriggerComplete` and `getRateLimitSummary` can recompute throttle
 *  status from live signals without the config being threaded through every
 *  call site. `null` until the first firing is recorded. */
export interface StoredRateLimits {
  windowSeconds: number;
  maxPerWindow: number;
  maxConcurrent: number;
  cooldownSeconds: number;
}

/** Per-trigger rate limit runtime state. */
export interface TriggerRateLimitState {
  /** Timestamps (epoch ms) of recent firings within the current window. */
  firingTimestamps: number[];
  /** Number of currently executing (in-flight) runs for this trigger. */
  concurrentCount: number;
  /** Number of throttled firings backed up in the current throttle episode.
   *  Drains to 0 the moment capacity frees (an allowed firing, or a completion
   *  that clears the limit) — it is NOT an unbounded tally of every rejection. */
  queueDepth: number;
  /** Whether this trigger is currently throttled. Always recomputed from live
   *  signals (recent firings, in-flight count, cooldown) — never a sticky flag. */
  isThrottled: boolean;
  /** Timestamp (epoch ms) when cooldown expires, or 0 if not in cooldown. */
  cooldownUntil: number;
  /** Limits from the most recent firing, for live recompute. */
  limits: StoredRateLimits | null;
}

const EMPTY_RATE_LIMIT_STATE: TriggerRateLimitState = {
  firingTimestamps: [],
  concurrentCount: 0,
  queueDepth: 0,
  isThrottled: false,
  cooldownUntil: 0,
  limits: null,
};

/**
 * Would a trigger in state `s` be throttled right now? Pure function of LIVE
 * signals — recent firings still inside the window, in-flight run count, and
 * cooldown — plus the configured `limits`. This is the single source of truth
 * for throttle status, replacing the old sticky `queueDepth > 0 || prev.isThrottled`
 * recompute that could never clear back to "ready" after a burst.
 */
function computeThrottled(
  s: Pick<TriggerRateLimitState, 'firingTimestamps' | 'concurrentCount' | 'cooldownUntil'>,
  limits: StoredRateLimits | null,
  now: number,
): boolean {
  // Without stored limits (e.g. state rehydrated before any firing) the only
  // signal we can trust is cooldown.
  if (!limits) return s.cooldownUntil > now;
  const windowStart = now - limits.windowSeconds * 1000;
  const recent = s.firingTimestamps.reduce((n, t) => (t > windowStart ? n + 1 : n), 0);
  return (
    (limits.cooldownSeconds > 0 && s.cooldownUntil > now) ||
    (limits.maxPerWindow > 0 && recent >= limits.maxPerWindow) ||
    (limits.maxConcurrent > 0 && s.concurrentCount >= limits.maxConcurrent)
  );
}

export interface TriggerSlice {
  // State
  webhookStatus: WebhookStatus | null;
  triggerError: TriggerError | null;
  /** Per-trigger rate limit runtime state, keyed by trigger ID. */
  triggerRateLimits: Record<string, TriggerRateLimitState>;

  // Actions
  createTrigger: (personaId: string, input: { trigger_type: string; config?: object; enabled?: boolean; use_case_id?: string | null }) => Promise<void>;
  updateTrigger: (personaId: string, triggerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteTrigger: (personaId: string, triggerId: string) => Promise<void>;
  fetchWebhookStatus: () => Promise<void>;
  clearTriggerError: () => void;
  /** Record a trigger firing -- enforces rate limits and returns whether the firing is allowed. */
  recordTriggerFiring: (triggerId: string, rateLimitConfig: TriggerRateLimitConfig) => boolean;
  /** Record that a trigger execution completed (decrements concurrent count, drains queue). */
  recordTriggerComplete: (triggerId: string) => void;
  /** Get the aggregate rate limit summary across all triggers. */
  getRateLimitSummary: () => { totalQueued: number; totalThrottled: number; throttledTriggerIds: string[] };
}

export const createTriggerSlice: StateCreator<PipelineStore, [], [], TriggerSlice> = (set, get) => ({
  webhookStatus: null,
  triggerError: null,
  triggerRateLimits: {},

  createTrigger: async (personaId, input) => {
    set({ triggerError: null });
    try {
      await createTrigger({
        persona_id: personaId,
        trigger_type: input.trigger_type,
        config: input.config != null ? JSON.stringify(input.config) : null,
        enabled: input.enabled ?? null,
        use_case_id: input.use_case_id ?? null,
      });
      storeBus.emit('trigger:changed', { personaId });
    } catch (err) {
      set({ triggerError: { kind: 'crud', message: errMsg(err, "Failed to create trigger") } });
    }
  },

  updateTrigger: async (personaId, triggerId, updates) => {
    set({ triggerError: null });
    try {
      await updateTrigger(triggerId, personaId, {
        trigger_type: (updates.trigger_type as string) ?? null,
        config: updates.config != null ? JSON.stringify(updates.config) : null,
        enabled: updates.enabled !== undefined ? (updates.enabled as boolean) : null,
        next_trigger_at: null,
      });
      storeBus.emit('trigger:changed', { personaId });
    } catch (err) {
      set({ triggerError: { kind: 'crud', message: errMsg(err, "Failed to update trigger") } });
    }
  },

  deleteTrigger: async (personaId, triggerId) => {
    set({ triggerError: null });
    try {
      await deleteTrigger(triggerId, personaId);
      storeBus.emit('trigger:changed', { personaId });
    } catch (err) {
      set({ triggerError: { kind: 'crud', message: errMsg(err, "Failed to delete trigger") } });
    }
  },

  fetchWebhookStatus: async () => {
    try {
      const status = await getWebhookStatus();
      set({ webhookStatus: status });
    } catch (err) {
      reportError(err, "Failed to load webhook status", set, { stateUpdates: { triggerError: { kind: 'fetch', message: errMsg(err, "Failed to load webhook status") } } });
    }
  },

  clearTriggerError: () => set({ triggerError: null }),

  recordTriggerFiring: (triggerId, rl) => {
    const now = Date.now();
    const prev = get().triggerRateLimits[triggerId] ?? { ...EMPTY_RATE_LIMIT_STATE };

    // Prune timestamps outside the window
    const windowStart = now - rl.window_seconds * 1000;
    const recentTimestamps = prev.firingTimestamps.filter((t) => t > windowStart);

    const limits: StoredRateLimits = {
      windowSeconds: rl.window_seconds,
      maxPerWindow: rl.max_per_window,
      maxConcurrent: rl.max_concurrent,
      cooldownSeconds: rl.cooldown_seconds,
    };

    // Determine whether THIS firing is allowed (trigger already at a limit?)
    const throttled =
      (rl.cooldown_seconds > 0 && prev.cooldownUntil > now) ||
      (rl.max_per_window > 0 && recentTimestamps.length >= rl.max_per_window) ||
      (rl.max_concurrent > 0 && prev.concurrentCount >= rl.max_concurrent);

    let newState: TriggerRateLimitState;
    if (throttled) {
      // Rejected → it backs up. queueDepth can no longer leak: it drains on the
      // next allowed firing (below) or when a completion clears the limit.
      newState = {
        ...prev,
        firingTimestamps: recentTimestamps,
        queueDepth: prev.queueDepth + 1,
        isThrottled: true,
        limits,
      };
    } else {
      // Allowed → capacity was available, so nothing is backed up: the backlog
      // is cleared (these firings are rejected, not replayed, so a successful
      // fire means prior pressure is gone). Recompute isThrottled for the
      // POST-firing state so the dashboard reflects whether the NEXT firing
      // would now be limited.
      const post = {
        firingTimestamps: [...recentTimestamps, now],
        concurrentCount: prev.concurrentCount + 1,
        cooldownUntil: rl.cooldown_seconds > 0 ? now + rl.cooldown_seconds * 1000 : 0,
      };
      newState = {
        ...post,
        queueDepth: 0,
        isThrottled: computeThrottled(post, limits, now),
        limits,
      };
    }

    // Single O(1) structural-sharing update via immer — avoids spreading the entire map
    set(produce((draft: PipelineStore) => {
      draft.triggerRateLimits[triggerId] = newState;
    }));

    return !throttled;
  },

  recordTriggerComplete: (triggerId) => {
    const prev = get().triggerRateLimits[triggerId];
    if (!prev) return;
    const now = Date.now();

    set(produce((draft: PipelineStore) => {
      const entry = draft.triggerRateLimits[triggerId];
      if (!entry) return;
      // A real in-flight run finished — free its concurrency slot.
      entry.concurrentCount = Math.max(0, entry.concurrentCount - 1);
      // Recompute throttle PURELY from live signals (recent firings, the now-lower
      // concurrent count, cooldown) + the stored limits — not the old sticky
      // `queueDepth > 0 || prev.isThrottled`. Crucially, do NOT decrement
      // queueDepth in lockstep with concurrentCount: completions correspond to
      // ALLOWED firings, which never incremented queueDepth, so the old `-1`
      // drained a queue that only THROTTLED firings filled, leaving it positive
      // forever after a burst. Instead, when the freed capacity clears the
      // limit, the backlog has drained → reset queueDepth to 0.
      const throttled = computeThrottled(entry, entry.limits, now);
      entry.isThrottled = throttled;
      if (!throttled) {
        entry.queueDepth = 0;
      }
    }));
  },

  getRateLimitSummary: () => {
    const limits = get().triggerRateLimits;
    const now = Date.now();
    let totalQueued = 0;
    let totalThrottled = 0;
    const throttledTriggerIds: string[] = [];

    for (const [id, state] of Object.entries(limits)) {
      // Recompute live so a trigger whose window has since slid (or cooldown
      // expired) reports as ready even if no firing/completion has refreshed its
      // stored flag — and so a drained queue is never over-reported.
      const throttled = computeThrottled(state, state.limits, now);
      if (throttled) {
        totalThrottled++;
        throttledTriggerIds.push(id);
        totalQueued += state.queueDepth;
      }
    }

    return { totalQueued, totalThrottled, throttledTriggerIds };
  },
});
