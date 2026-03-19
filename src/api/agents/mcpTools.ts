import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { McpTool } from "@/lib/bindings/McpTool";
import type { McpToolResult } from "@/lib/bindings/McpToolResult";
import type { McpPingResult } from "@/lib/bindings/McpPingResult";
import type { StdioPoolMetrics } from "@/lib/bindings/StdioPoolMetrics";

export type { McpTool } from "@/lib/bindings/McpTool";
export type { McpToolContent } from "@/lib/bindings/McpToolContent";
export type { McpToolResult } from "@/lib/bindings/McpToolResult";
export type { McpPingResult } from "@/lib/bindings/McpPingResult";
export type { StdioPoolMetrics } from "@/lib/bindings/StdioPoolMetrics";

export const healthcheckMcpPreview = (fields: Record<string, string>) =>
  invoke<McpPingResult>('healthcheck_mcp_preview', { fields }, undefined, 90_000);

// -- MCP Tool Discovery & Execution -------------------------------------

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

// -- MCP Stdio Pool Observability -----------------------------------------

export const getMcpPoolMetrics = () =>
  invoke<StdioPoolMetrics>('get_mcp_pool_metrics');
