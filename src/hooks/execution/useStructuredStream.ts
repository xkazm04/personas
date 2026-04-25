import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import type {
  StructuredExecutionEvent,
  TextEvent,
  ToolUseEvent,
  TodoUpdateEvent,
  ToolResultEvent,
  SystemInitEvent,
  ResultEvent,
  FileChangeEvent,
  HeartbeatEvent,
} from '@/lib/types/terminalEvents';

export interface StreamHandlers {
  onText?: (event: TextEvent) => void;
  onToolUse?: (event: ToolUseEvent) => void;
  onTodoUpdate?: (event: TodoUpdateEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onSystemInit?: (event: SystemInitEvent) => void;
  onResult?: (event: ResultEvent) => void;
  onFileChange?: (event: FileChangeEvent) => void;
  onHeartbeat?: (event: HeartbeatEvent) => void;
}

/**
 * Type-safe listener for structured execution events.
 * Filters by execution_id and dispatches to typed handlers.
 */
export function useStructuredStream(
  executionId: string | null,
  handlers: StreamHandlers,
) {
  // Use ref to avoid re-subscribing when handlers change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!executionId) return;

    let cancelled = false;
    const unlistenPromise = listen<StructuredExecutionEvent>(EventName.EXECUTION_EVENT, (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.execution_id !== executionId) return;

      const h = handlersRef.current;
      switch (payload.type) {
        case 'text':
          h.onText?.(payload);
          break;
        case 'tool_use':
          h.onToolUse?.(payload);
          break;
        case 'todo_update':
          h.onTodoUpdate?.(payload);
          break;
        case 'tool_result':
          h.onToolResult?.(payload);
          break;
        case 'system_init':
          h.onSystemInit?.(payload);
          break;
        case 'result':
          h.onResult?.(payload);
          break;
        case 'file_change':
          h.onFileChange?.(payload);
          break;
        case 'heartbeat':
          h.onHeartbeat?.(payload);
          break;
      }
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [executionId]);
}
