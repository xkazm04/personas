import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ── Types ──────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string | null;
  input_schema: Record<string, unknown> | null;
}

export interface McpToolContent {
  content_type: string;
  text: string | null;
}

export interface McpToolResult {
  content: McpToolContent[];
  is_error: boolean;
  duration_ms: number;
}

// ── MCP Tool Discovery & Execution ─────────────────────────────────────

export const listMcpTools = (credentialId: string) =>
  invoke<McpTool[]>('list_mcp_tools', { credentialId });

export const executeMcpTool = (
  credentialId: string,
  toolName: string,
  args: Record<string, unknown>,
) =>
  invoke<McpToolResult>('execute_mcp_tool', {
    credentialId,
    toolName,
    arguments: args,
  });
