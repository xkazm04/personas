import { useCallback, useRef, useState } from "react";
import { useStructuredStream } from "./useStructuredStream";

export type ReasoningEntry =
  | { type: "init"; model: string; sessionId?: string; ts: number }
  | { type: "text"; content: string; ts: number }
  | { type: "tool_call"; toolName: string; inputPreview: string; ts: number }
  | { type: "tool_result"; contentPreview: string; ts: number }
  | { type: "file_change"; path: string; changeType: "read" | "write" | "edit"; ts: number }
  | { type: "heartbeat"; elapsed: number; silence: number; ts: number }
  | { type: "complete"; durationMs: number; cost?: number; tokens?: number; ts: number }
  | { type: "error"; message: string; ts: number };

const MAX_ENTRIES = 500;

function pushEntry(arr: ReasoningEntry[], entry: ReasoningEntry): ReasoningEntry[] {
  // One copy, not two. The previous form built `[...arr, entry]` and THEN
  // sliced it, so every event past the cap allocated two 500-element arrays.
  if (arr.length < MAX_ENTRIES) return [...arr, entry];
  const next = arr.slice(arr.length - MAX_ENTRIES + 1);
  next.push(entry);
  return next;
}

export function useReasoningTrace(executionId: string | null): {
  entries: ReasoningEntry[];
  isLive: boolean;
} {
  const [entries, setEntries] = useState<ReasoningEntry[]>([]);
  const [isLive, setIsLive] = useState(!!executionId);
  const entriesRef = useRef<ReasoningEntry[]>([]);
  const prevIdRef = useRef<string | null>(executionId);

  // `isLive` used to be initial-state-only, with `setIsLive(false)` on the
  // result event as its ONLY writer, and `entries` was never cleared. Switching
  // the mini-player or the monitor drawer to a SECOND live run therefore kept
  // showing run A's steps, labelled "completed" — and the summary derived from
  // them reported a completed run with no cost. Re-arm on a new id, in the
  // render phase so no frame ever paints the previous run's trace as this
  // run's. Clearing the id (the run ended and the store dropped it) is NOT a
  // new run: keep the trace so the completed view can still summarise it.
  if (prevIdRef.current !== executionId) {
    const previousId = prevIdRef.current;
    prevIdRef.current = executionId;
    if (executionId) {
      entriesRef.current = [];
      setEntries(entriesRef.current);
      setIsLive(true);
    } else if (previousId) {
      setIsLive(false);
    }
  }

  const push = useCallback((entry: ReasoningEntry) => {
    entriesRef.current = pushEntry(entriesRef.current, entry);
    setEntries(entriesRef.current);
  }, []);

  useStructuredStream(executionId, {
    onSystemInit: useCallback(
      (e) => {
        push({ type: "init", model: e.model, sessionId: e.session_id, ts: Date.now() });
      },
      [push],
    ),
    onText: useCallback(
      (e) => {
        push({ type: "text", content: e.content, ts: Date.now() });
      },
      [push],
    ),
    onToolUse: useCallback(
      (e) => {
        push({ type: "tool_call", toolName: e.tool_name, inputPreview: e.input_preview, ts: Date.now() });
      },
      [push],
    ),
    onToolResult: useCallback(
      (e) => {
        push({ type: "tool_result", contentPreview: e.content_preview, ts: Date.now() });
      },
      [push],
    ),
    onHeartbeat: useCallback(
      (e) => {
        push({ type: "heartbeat", elapsed: e.elapsed_ms, silence: e.silence_ms, ts: Date.now() });
      },
      [push],
    ),
    onFileChange: useCallback(
      (e) => {
        push({ type: "file_change", path: e.path, changeType: e.change_type, ts: Date.now() });
      },
      [push],
    ),
    onResult: useCallback(
      (e) => {
        push({
          type: "complete",
          durationMs: e.duration_ms ?? 0,
          cost: e.cost_usd,
          tokens: e.input_tokens != null && e.output_tokens != null ? e.input_tokens + e.output_tokens : undefined,
          ts: Date.now(),
        });
        setIsLive(false);
      },
      [push],
    ),
  });

  return { entries, isLive };
}
