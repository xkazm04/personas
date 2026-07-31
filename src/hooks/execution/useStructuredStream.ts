import { useRef } from 'react';
import { EventName } from '@/lib/eventRegistry';
import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
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
  SubagentStartedEvent,
  SubagentUpdateEvent,
  SubagentMessageEvent,
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
  onSubagentStarted?: (event: SubagentStartedEvent) => void;
  onSubagentUpdate?: (event: SubagentUpdateEvent) => void;
  onSubagentMessage?: (event: SubagentMessageEvent) => void;
}

// EXECUTION_EVENT is the highest-frequency channel in the app (every text
// token, tool call and heartbeat of every running persona). Every call site
// used to open its OWN raw `listen()` on it -- useReasoningTrace and any
// concurrent inspector (e.g. SubagentTree) each add a full Tauri IPC
// subscription for the same traffic. Route through the same singleton
// pattern the rest of `hooks/realtime` uses (see createSingletonListener.ts)
// so N mounted consumers share exactly one subscription.
const useExecutionEventListener = createSingletonListener<StructuredExecutionEvent>(
  EventName.EXECUTION_EVENT,
);

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

  useExecutionEventListener((payload) => {
    if (!executionId || payload.execution_id !== executionId) return;

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
      case 'subagent_started':
        h.onSubagentStarted?.(payload);
        break;
      case 'subagent_update':
        h.onSubagentUpdate?.(payload);
        break;
      case 'subagent_message':
        h.onSubagentMessage?.(payload);
        break;
    }
  });
}
