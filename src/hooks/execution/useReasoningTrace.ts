import { useCallback, useRef, useState } from "react";
import { useStructuredStream } from "./useStructuredStream";

export type ReasoningEntry =
  | { type: "init"; model: string; sessionId?: string; ts: number }
  | { type: "text"; content: string; ts: number }
  | { type: "tool_call"; toolName: string; inputPreview: string; ts: number }
  | { type: "tool_result"; contentPreview: string; ts: number }
  | { type: "heartbeat"; elapsed: number; silence: number; ts: number }
  | { type: "complete"; durationMs: number; cost?: number; tokens?: number; ts: number }
  | { type: "error"; message: string; ts: number };

const MAX_ENTRIES = 500;

function pushEntry(arr: ReasoningEntry[], entry: ReasoningEntry): ReasoningEntry[] {
  const next = [...arr, entry];
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

export function useReasoningTrace(executionId: string | null): {
  entries: ReasoningEntry[];
  isLive: boolean;
} {
  const [entries, setEntries] = useState<ReasoningEntry[]>([]);
  const [isLive, setIsLive] = useState(!!executionId);
  const entriesRef = useRef<ReasoningEntry[]>([]);

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
