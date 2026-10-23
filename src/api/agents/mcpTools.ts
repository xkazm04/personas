import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { McpTool } from "@/lib/bindings/McpTool";
import type { McpToolResult } from "@/lib/bindings/McpToolResult";
import type { McpPingResult } from "@/lib/bindings/McpPingResult";
import type { StdioPoolMetrics } from "@/lib/bindings/StdioPoolMetrics";
import type { McpServerLiveness } from "@/lib/bindings/McpServerLiveness";

export type { McpServerLiveness } from "@/lib/bindings/McpServerLiveness";
export type { McpTool } from "@/lib/bindings/McpTool";
export type { McpToolContent } from "@/lib/bindings/McpToolContent";
export type { McpToolResult } from "@/lib/bindings/McpToolResult";
export type { McpPingResult } from "@/lib/bindings/McpPingResult";
export type { StdioPoolMetrics } from "@/lib/bindings/StdioPoolMetrics";

/**
 * IPC ceiling for the calls that open an MCP stdio session. The backend bounds
 * one session (spawn + handshake + call) at 120 s (`MCP_SESSION_TIMEOUT`,
 * `src-tauri/src/engine/mcp_tools.rs`) and answers its own timeout with a
 * readable error. At the 90 s default the wrapper rejected first: a slow server
 * start surfaced a bare IPC timeout, and a tool call kept running (and acting)
 * after the panel reported it failed. The margin covers the rate-limit check
 * and result serialisation. A gateway's `tools/list` walks its members one
 * session at a time, so it can still exceed this; that is a backend deadline
 * question, not a wrapper one.
 */
export const MCP_SESSION_IPC_TIMEOUT_MS = 135_000;

export const healthcheckMcpPreview = (fields: Record<string, string>) =>
  invoke<McpPingResult>('healthcheck_mcp_preview', { fields }, { timeoutMs: MCP_SESSION_IPC_TIMEOUT_MS });

// -- MCP Tool Discovery & Execution -------------------------------------

export const listMcpTools = (credentialId: string) =>
  invoke<McpTool[]>('list_mcp_tools', { credentialId }, { timeoutMs: MCP_SESSION_IPC_TIMEOUT_MS });

export const executeMcpTool = (
  credentialId: string,
  toolName: string,
  args: Record<string, unknown>,
) =>
  invoke<McpToolResult>('execute_mcp_tool', {
    credentialId,
    toolName,
    arguments: args,
  }, { timeoutMs: MCP_SESSION_IPC_TIMEOUT_MS });

// -- MCP Stdio Pool Observability -----------------------------------------

export const getMcpPoolMetrics = () =>
  invoke<StdioPoolMetrics>('get_mcp_pool_metrics');

// -- MCP Server Liveness --------------------------------------------------

/** Live `/health` probe of the local management (":9420") server. */
export const probeMcpServer = () =>
  invoke<McpServerLiveness>('probe_mcp_server');
