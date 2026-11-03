/**
 * Local MCP management-API base URL.
 *
 * The production HTTP server (engine/webhook.rs, engine/management_api.rs)
 * auto-starts on 127.0.0.1 — no enable toggle needed. Its port defaults to
 * 9420 but `PERSONAS_WEBHOOK_PORT` overrides it (webhook.rs `webhook_port`),
 * and `probe_mcp_server` reports the port it actually reached. Prefer
 * `mcpBaseUrl(probedPort)` wherever a probe result is at hand;
 * `MCP_BASE_URL` is the default-port form for callers that have none.
 */
export const DEFAULT_MCP_PORT = 9420;

export function mcpBaseUrl(port: number = DEFAULT_MCP_PORT): string {
  return `http://127.0.0.1:${port}`;
}

export const MCP_BASE_URL = mcpBaseUrl();
