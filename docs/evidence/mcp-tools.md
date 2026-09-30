---
subject: mcp-tools
evidence:
  - src-tauri/src/companion/orchestration/mcp/mod.rs   # single-endpoint JSON-RPC server, dual-era discovery, per-session token auth
  - src-tauri/src/companion/orchestration/mcp/pending.rs # pending-request correlation: TTL, session-exit cancellation, waiter-side timeout
  - src-tauri/src/mcp_server/auth.rs                   # per-call token authentication, scopes reused from the key registry
  - src-tauri/src/mcp_server/tools.rs                  # tool catalog: schema declarations + dispatch
  - src-tauri/src/commands/fleet/pty.rs                # build_mcp_spawn: capability token injected via generated client config, reaper coupled to session exit
counter_evidence:
  - src-tauri/src/mcp_server/install.rs                # capability token written into client config with no expiry and no named reaper
deviations:
  - w2-mcp-tools   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Mcp Tools - evidence

How this codebase measures against the [`mcp-tools`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
