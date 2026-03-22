/** Structured execution events emitted by the backend on the 'execution-event' channel. */

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
  | ToolResultEvent
  | SystemInitEvent
  | ResultEvent
  | FileChangeEvent
  | HeartbeatEvent;
