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

/** Write experiment results to the chat thread and clean up working memory. */
async function deliverExperimentResult(
  exp: PendingExperiment,
  phase: "completed" | "failed",
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
  } catch {
    // Message creation failed — non-critical
  }
}

// Track which run IDs we've already delivered results for (prevents duplicates
// between event listener and polling)
const deliveredRunIds = new Set<string>();

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

          deliveredRunIds.add(runId);
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
        if (deliveredRunIds.has(exp.runId)) continue;
        // If the run is no longer in the active list, it must have completed or failed
        if (!activeRunIds.has(exp.runId)) {
          deliveredRunIds.add(exp.runId);
          // We don't have the summary from polling, so deliver a generic message
          await deliverExperimentResult(
            exp, "completed", null, undefined,
          );
        }
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
