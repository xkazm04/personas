---
layer: application
subject: health-checks
technique: three-state-outcomes
stack: rust
---

# Three-state outcomes — the credential probe's Verified/Unverifiable/Failed

`src-tauri/src/engine/healthcheck.rs` is the technique's cleanest manifestation
in this repo, including the retrofit trap it warns about — caught in the same
file.

## The closed sum

```rust
// src-tauri/src/engine/healthcheck.rs
#[derive(... serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum HealthProbeState {
    Verified,      // a live probe actually ran and passed
    Unverifiable,  // the connector exposes no probe of any kind
    Failed,        // a live probe ran and failed
}
```

The doc-comment on `Unverifiable` states the render rule from the technique
verbatim: *"This is NOT a failure — it renders neutral/muted, never a green
'healthy' check."* This is the structural **cannot-probe-ever** case: a
connector kind with no HTTP healthcheck config, no CLI probe, and no desktop
binary to detect concludes `unverifiable("Connection type does not support
HTTP healthcheck -- credentials stored")` rather than either lie. The enum is
`#[ts(export)]`ed, so the frontend consumes the same vocabulary rather than
hand-copying it (one-authority-per-vocabulary); `HealthProbeState::token()`
pins the persisted metadata form and documents that it must stay in sync with
the serde wire form.

## The retrofit trap, live

The typed state was layered over a legacy boolean, kept for gating:

```rust
pub fn unverifiable(message: impl Into<String>) -> Self {
    HealthcheckResult {
        success: true,   // back-compat: unverifiable does not block gates
        state: HealthProbeState::Unverifiable,
        ...
    }
}
```

`summarize_probe_states` then carries the technique's counting rule, with the
measured bug in its comment: tallying the sweep on `success` *"silently folds
'never probed' into 'passed' — a vault of entirely unprobed credentials would
report 'N passed, 0 failed' and read as fully verified."* The fix buckets on
the typed `state`, and `BulkHealthcheckSummary` keeps `unverifiable: u32` as
its own field precisely *"so the UI can render a neutral, non-green/non-red
badge instead of silently crediting these as verified."*

## Distinct render semantics downstream

`src/features/vault/shared/hooks/health/useCredentialHealth.ts` types the
frontend result as `state?: 'verified' | 'unverifiable' | 'failed' | null`
with legacy fallback to `success`, and its three-layer storage contract marks
results loaded from persisted metadata with `isStale: true` — an old green
rendered as an old green. The banded rendering tests live at
`src/features/vault/shared/utils/__tests__/credentialHealthScore.threestate.test.ts`.

## Where the general system falls short of its own engine

`HealthCheckStatus` in
`src-tauri/src/commands/infrastructure/system/health.rs` (`Ok / Warn / Error /
Inactive / Info`) has no could-not-determine member; e.g. the keyring probe's
"keyring unavailable" arm — a probe obstacle, not an observed failure — maps
to `Warn`. The panel partially compensates with a separate `ipcError` channel
for "the checks themselves could not run" (`useHealthChecks` →
`SystemHealthPanel.tsx`), but per-item unknowns still collapse. The
credential engine, not the system report, is the standard-bearer here.
