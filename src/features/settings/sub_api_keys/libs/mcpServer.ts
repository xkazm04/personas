/**
 * Local MCP management-API base URL.
 *
 * The production HTTP server (engine/webhook.rs, engine/management_api.rs)
 * auto-starts on 127.0.0.1:9420 — no enable toggle needed. Single source of
 * truth so the port only needs to change in one place if it ever moves.
 */
export const MCP_BASE_URL = 'http://127.0.0.1:9420';
