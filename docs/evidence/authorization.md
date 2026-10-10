---
subject: authorization
evidence:
  - src-tauri/src/ipc_auth.rs                       # three-tier vocabulary (AuthTier), gate at the invoke wrapper before dispatch, CSPRNG channel proof, constant-time compare, drift-guard tests with instrument assertions
  - src-tauri/macros/src/lib.rs                     # #[requires(level)] — declarative requirement adjacent to the handler; name derived from the fn ident; unknown level = compile error
  - src-tauri/engine/src/credential_broker.rs       # the pure default-deny kernel: exact-match scope intersection, empty set authorizes nothing, returns WHICH grant authorized (not a boolean)
  - src-tauri/engine/src/scope_enforcement.rs       # three-outcome allow/warn-only/block; corrupt metadata resolves stricter than absent metadata
  - src-tauri/src/engine/management_api.rs          # per-route scope matrix on issued keys; parsed_scopes fails closed to empty; derived handles cannot mint handles
counter_evidence:
  - src-tauri/src/ipc_auth.rs                       # same file, other face: command_tier falls through to Public (unlisted = ungated, not refused), and the async in-handler guard verifies only that the system booted — audit, not enforcement
deviations:
  - w3-authorization   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Authorization - evidence

How this codebase measures against the [`authorization`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
