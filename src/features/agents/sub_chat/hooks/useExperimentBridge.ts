/**
 * Experiment Bridge — tracks lab experiments started from advisory chat
 * and writes completion results back into the chat thread.
 *
 * Two delivery mechanisms:
 * 1. Event listener — catches lab completion events in real-time
 * 2. Polling fallback — checks DB every 30s for completed experiments
 *    (handles cases where the event fires before the listener is registered)
 */

import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAgentStore } from "@/stores/agentStore";
import { createChatMessage, saveChatSessionContext } from "@/api/agents/chat";
import { invokeWithTimeout } from "@/lib/tauriInvoke";

// ── Types ──────────────────────────────────────────────────────────────

export interface PendingExperiment {
  runId: string;
  mode: "arena" | "matrix" | "ab" | "eval";
  hypothesis: string;
  startedAt: string;
  sessionId: string;
  personaId: string;
}

interface LabStatusPayload {
  run_id?: string;
  phase?: string;
  summary?: unknown; // serde_json::Value — can be object, string, or null
  error?: string;
}

// ── Working Memory Helpers ──────────────────────────────────────────────

function parseExperiments(workingMemory: string | null | undefined): PendingExperiment[] {
  if (!workingMemory) return [];
  try {
    const wm = JSON.parse(workingMemory);
    return Array.isArray(wm.experiments) ? wm.experiments : [];
  } catch {
    return [];
  }
}

function serializeExperiments(experiments: PendingExperiment[]): string {
  return JSON.stringify({ experiments });
}

/** Convert a lab summary (which may be a JSON object) to a readable string. */
function formatSummary(summary: unknown): string {
  if (!summary) return "Experiment completed successfully.";
  if (typeof summary === "string") return summary;
  // Lab summaries are JSON objects with model scores, averages, etc.
  try {
    const obj = summary as Record<string, unknown>;
    // Try to extract a readable format
    if (obj.best_quality_model || obj.per_model) {
      return `Results:\n\`\`\`json\n${JSON.stringify(summary, null, 2).slice(0, 1000)}\n\`\`\``;
    }
    return JSON.stringify(summary, null, 2).slice(0, 1000);
  } catch {
    return String(summary);
  }
}

// ── Core delivery function ──────────────────────────────────────────────

/** Write experiment results to the chat thread and clean up working memory.
 *
 *  Phase 'finished-unknown' is used by the polling fallback (mechanism 2) when
 *  it can only tell that the run is no longer active — it doesn't know if it
 *  succeeded, failed, or was cancelled. Says so honestly instead of lying. */
async function deliverExperimentResult(
  exp: PendingExperiment,
  phase: "completed" | "failed" | "finished-unknown",
  summary: unknown,
  error?: string,
) {
  let content: string;
  if (phase === "completed") {
    const summaryText = formatSummary(summary);
    content = `**Experiment Complete: ${exp.hypothesis}**\n\n${summaryText}`;
    if (exp.mode === "matrix") {
      content += "\n\n> You can review the results in the Lab tab, or ask me to analyze them here.";
    }
  } else if (phase === "finished-unknown") {
    content =
      `**Experiment Finished: ${exp.hypothesis}**\n\n` +
      `The run is no longer active. Open the Lab tab to see whether it ` +
      `completed, failed, or was cancelled — the realtime status event was ` +
      `not received here so I can't show the result inline.`;
  } else {
    content = `**Experiment Failed: ${exp.hypothesis}**\n\nError: ${error || "Unknown error"}`;
  }

  try {
    const msg = await createChatMessage({
      personaId: exp.personaId,
      sessionId: exp.sessionId,
      role: "assistant",
      content,
    });

    // Update in-memory messages if this is the active session
    const state = useAgentStore.getState();
    if (state.activeChatSessionId === exp.sessionId) {
      useAgentStore.setState((s) => ({
        chatMessages: [...s.chatMessages, msg].slice(-500),
      }));
    }

    // Remove this experiment from working memory
    const ctx = useAgentStore.getState().chatSessionContext;
    const remaining = parseExperiments(ctx?.workingMemory).filter((e) => e.runId !== exp.runId);
    await saveChatSessionContext({
      sessionId: exp.sessionId,
      personaId: exp.personaId,
      workingMemory: remaining.length > 0 ? serializeExperiments(remaining) : null,
    }).catch(() => {/* best effort */});
  } catch (err) {
    // Non-critical: the result is in the lab tab regardless. But keep a
    // breadcrumb — silent failure here makes "experiment results vanished"
    // bug reports impossible to diagnose.
    console.warn('[experiment-bridge] failed to deliver result for run', exp.runId, err);
  }
}

// Track which run IDs we've already delivered results for (prevents duplicates
// between event listener and polling). Bounded with FIFO eviction so the set
// doesn't grow without limit across long sessions, HMR, or many experiments.
// Set iteration is insertion order, so the first .values() entry is the oldest.
const DELIVERED_CACHE_LIMIT = 200;
const deliveredRunIds = new Set<string>();

/**
 * First time the polling fallback observed each runId as "no longer active".
 * Used to require a grace window before declaring "finished-unknown" — without
 * this, a run that completes a microsecond before the poll fires would have
 * its realtime "completed/failed" event locked out, because the poll would
 * markDelivered() the runId before the listener saw the event. The grace gap
 * between the first inactive observation and the eventual declaration MUST be
 * large enough for the realtime channel to deliver under normal load. We pick
 * 5_000 ms — comfortably longer than the typical event flush, smaller than
 * the 30 s poll interval so legitimate "finished-unknown" delivery for runs
 * with no realtime event is only delayed by ~one extra poll cycle.
 */
const INACTIVE_GRACE_MS = 5_000;
const inactiveSinceMap = new Map<string, number>();

function markDelivered(runId: string): void {
  // Always clean up the grace-window entry — whichever mechanism delivered,
  // we no longer need to wait on this runId.
  inactiveSinceMap.delete(runId);
  if (deliveredRunIds.has(runId)) return;
  deliveredRunIds.add(runId);
  if (deliveredRunIds.size > DELIVERED_CACHE_LIMIT) {
    const oldest = deliveredRunIds.values().next().value;
    if (oldest !== undefined) deliveredRunIds.delete(oldest);
  }
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useExperimentBridge() {
  const chatSessionContext = useAgentStore((s) => s.chatSessionContext);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Mechanism 1: Event listeners ──────────────────────────────────
  useEffect(() => {
    const events = [
      { event: "lab-arena-status", mode: "arena" as const },
      { event: "lab-matrix-status", mode: "matrix" as const },
      { event: "lab-ab-status", mode: "ab" as const },
      { event: "lab-eval-status", mode: "eval" as const },
    ];

    const setupListeners = async () => {
      for (const { event, mode } of events) {
        const unlisten = await listen<LabStatusPayload>(event, async (evt) => {
          const payload = evt.payload;
          const phase = payload.phase;
          if (phase !== "completed" && phase !== "failed") return;

          const runId = payload.run_id;
          if (!runId || deliveredRunIds.has(runId)) return;

          // Check if this run is tracked in any chat session
          const ctx = useAgentStore.getState().chatSessionContext;
          const experiments = parseExperiments(ctx?.workingMemory);
          const exp = experiments.find((e) => e.runId === runId && e.mode === mode);
          if (!exp) return;

          markDelivered(runId);
          await deliverExperimentResult(exp, phase as "completed" | "failed", payload.summary, payload.error);
        });
        unlistenRefs.current.push(unlisten);
      }
    };

    void setupListeners();

    return () => {
      for (const unlisten of unlistenRefs.current) unlisten();
      unlistenRefs.current = [];
    };
  }, []);

  // ── Mechanism 2: Polling fallback ─────────────────────────────────
  // Checks for completed experiments every 30s. Handles cases where the
  // Tauri event fires before the listener was registered, or on session restore.
  useEffect(() => {
    const checkPendingExperiments = async () => {
      const ctx = useAgentStore.getState().chatSessionContext;
      const experiments = parseExperiments(ctx?.workingMemory);
      if (experiments.length === 0) return;

      // Get active progress for this persona
      const personaId = experiments[0]?.personaId;
      if (!personaId) return;

      let activeRunIds: Set<string>;
      try {
        const active = await invokeWithTimeout<Array<{ mode: string; runId: string }>>(
          "lab_get_active_progress", { personaId },
        );
        activeRunIds = new Set(active.map((a) => a.runId));
      } catch {
        return; // Can't check — retry next poll
      }

      for (const exp of experiments) {
        if (deliveredRunIds.has(exp.runId)) {
          inactiveSinceMap.delete(exp.runId);
          continue;
        }
        if (activeRunIds.has(exp.runId)) {
          // Still running — clear any stale grace-window entry from a
          // previous restart-window glitch.
          inactiveSinceMap.delete(exp.runId);
          continue;
        }
        // The run is no longer in the active list it has *terminated* —
        // but 'not active' conflates 'completed', 'failed', and 'cancelled'.
        // We can't tell from the active-progress API alone, and the realtime
        // event listener (mechanism 1) is the authoritative source of phase.
        // Require a small grace window (INACTIVE_GRACE_MS) between the FIRST
        // poll where we saw the run as inactive and the declaration, so a
        // realtime "completed/failed" event arriving microseconds after a
        // poll fires is not locked out by markDelivered. After the grace
        // expires we deliver an ambiguous 'finished' message that points the
        // user to the Lab tab — better than falsely claiming
        // 'Experiment Complete: ...' for failed/cancelled runs.
        const firstSeen = inactiveSinceMap.get(exp.runId);
        if (firstSeen === undefined) {
          inactiveSinceMap.set(exp.runId, Date.now());
          continue;
        }
        if (Date.now() - firstSeen < INACTIVE_GRACE_MS) {
          continue; // Still inside the grace window — give realtime more time
        }
        markDelivered(exp.runId);
        await deliverExperimentResult(
          exp,
          "finished-unknown",
          null,
          undefined,
        );
      }
    };

    pollIntervalRef.current = setInterval(checkPendingExperiments, 30_000);
    // Also run immediately on mount to catch already-completed experiments
    void checkPendingExperiments();

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [chatSessionContext?.workingMemory]); // Re-run when working memory changes

  return { pendingExperiments: parseExperiments(chatSessionContext?.workingMemory) };
}
