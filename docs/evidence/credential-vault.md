---
subject: credential-vault
evidence:
  - src-tauri/src/engine/credential_broker.rs      # the cardinal rule as code: intent in, outcome out, plaintext never
  - src-tauri/core/src/crypto.rs                   # sealing, key custody ladder, zeroization, instrumented legacy-path retirement
  - src-tauri/src/engine/oauth_refresh.rs          # the maintenance loop: refresh-ahead, startup staleness sweep, honest failure classes
  - src-tauri/src/engine/healthcheck.rs            # three-state probe honesty (verified / failed / unverifiable)
counter_evidence:
  - src-tauri/src/mcp_server/install.rs            # a never-expiring token written into a config file with no named reaper — vault discipline absent one step outside the vault
deviations:
  - w1-credential-vault   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Credential Vault - evidence

How this codebase measures against the [`credential-vault`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
