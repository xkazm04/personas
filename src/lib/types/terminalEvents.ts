/** Structured execution events emitted by the backend on the 'execution-event' channel. */

/**
 * One item from a Claude `TodoWrite` tool emission. Mirrors the Rust
 * `TodoItem` struct in `src-tauri/src/engine/types.rs`. `status` is a free
 * string at the protocol level — in practice `"pending"` / `"in_progress"` /
 * `"completed"`. Unknown values should be treated as `"pending"` for display.
 */
export interface TodoItem {
  content: string;
  status: string;
  /** Present-tense form ("Reading file") shown while in progress. */
  active_form?: string;
}

export interface TextEvent {
  type: 'text';
  execution_id: string;
  content: string;
}

export interface ToolUseEvent {
  type: 'tool_use';
  execution_id: string;
  tool_name: string;
  input_preview: string;
}

/**
 * Latest plan emitted by Claude's TodoWrite tool. The full list is always
 * carried — TodoWrite re-emits the entire array on every update, so consumers
 * should replace, not merge.
 */
export interface TodoUpdateEvent {
  type: 'todo_update';
  execution_id: string;
  items: TodoItem[];
}

export interface ToolResultEvent {
  type: 'tool_result';
  execution_id: string;
  content_preview: string;
}

export interface SystemInitEvent {
  type: 'system_init';
  execution_id: string;
  model: string;
  session_id?: string;
}

export interface ResultEvent {
  type: 'result';
  execution_id: string;
  duration_ms?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  session_id?: string;
}

export interface FileChangeEvent {
  type: 'file_change';
  execution_id: string;
  path: string;
  change_type: 'read' | 'write' | 'edit';
}

export interface HeartbeatEvent {
  type: 'heartbeat';
  execution_id: string;
  elapsed_ms: number;
  silence_ms: number;
}

export type StructuredExecutionEvent =
  | TextEvent
  | ToolUseEvent
  | TodoUpdateEvent
  | ToolResultEvent
  | SystemInitEvent
  | ResultEvent
  | FileChangeEvent
  | HeartbeatEvent;
