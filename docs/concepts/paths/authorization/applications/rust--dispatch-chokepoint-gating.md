---
layer: application
subject: authorization
technique: dispatch-chokepoint-gating
stack: rust
---

# Dispatch-chokepoint gating on the desktop IPC surface

The repo's chokepoint is `wrap_invoke_handler` at
`src-tauri/src/ipc_auth.rs:617-665`: it wraps the generated invoke handler,
so every IPC call from the webview passes through it **before** the command
function is dispatched. The module docstring (`ipc_auth.rs:1-27`) names the
four enforcement layers exactly as the technique prescribes — primary gate at
the wrapper, command-level guard as defense-in-depth, plus the cloud guard
and the frontend injection script.

## Channel proof, by the book

- **Minted at startup from a CSPRNG**: `generate_ipc_session_token`
  (`ipc_auth.rs:53-59`) fills 32 random bytes (the repo's own test pins the
  64-hex shape at `:932-936`); stored in a `OnceLock` whose double-init
  panics (`:41`, `:47-51`) — one mint, process lifetime, restart is
  revocation. No token value is ever logged; only its store and shape are
  documented.
- **Injected, not requested**: `generate_ipc_auth_script` (`:691-750`)
  monkey-patches the webview's invoke to attach the proof as the
  `x-ipc-token` header, *and* exposes it as a window global so the app's
  invoke wrapper can attach it explicitly when the patch races startup —
  the "fallback attachment path" the technique calls for, born from a
  measured delivery race on one OS webview.
- **Constant-time comparison**: `constant_time_eq` (`:667-677`), XOR-fold
  over the full length, with unit tests at `:923-929`.
- **Uniform terminal refusal**: an invalid or missing proof rejects with
  one shape (`:644-654`) and a logged warning — no partial dispatch.

## The tripwire layer — and the honest breadcrumb

The wrapper sets a thread-local `IPC_VALIDATED` flag around dispatch
(`:656-660`); `require_privileged_sync` (`:447-474`) fails closed unless the
flag is set — a real tripwire for sync commands. For async commands the
evidence channel does not survive the execution model: the flag is cleared
when dispatch returns, before the async body runs on another executor, so
`require_privileged` (`:547-562`) checks only that the token system booted
and *documents itself* as audit, not enforcement. The codebase states the
distinction rather than pretending both shapes have two layers — exactly
the "know whether you hold a gate or a breadcrumb" demand, though the
consequence is that async commands off the wrapper's list have **zero**
layers (see deviations in the forge report).

## Delivery-reliability downgrade pressure, measured

The technique's warning is live here: `PRIVILEGED_COMMANDS`' own comments
record that startup reads (`list_credentials`, `vault_status`, …) are
"intentionally PUBLIC so the app boots reliably" against a header-forwarding
race (`ipc_auth.rs:111-116`), and that several privileged-by-intent commands
(`execute_api_request`, the data-portability set) are kept **off** the
wrapper list because the injection intermittently fails for batched or
file-dialog invokes (`:242-253`, `:425-433`). Each exclusion is written down
with its reason — the dated-exception discipline — and the drift baseline
that tolerates them is typed and shrink-only (`DRIFT_BASELINE`,
`:1076-1111`).

## The registry-drift guards

Two tests reconcile the annotation (`#[requires(...)]`,
`src-tauri/macros/src/lib.rs:57-102`, command name derived from the fn ident
so a rename cannot desync it) against the wrapper's list:
`all_sync_requires_privileged_commands_are_registered` (`ipc_auth.rs:1034-1053`)
and `every_requires_annotation_is_listed_or_baselined` (`:1156-1213`). Both
assert the instrument before the result (`checked > 50` at `:1039-1044`,
`found.len() > 150` at `:1164-1169`) — a walk that finds nothing is a broken
walk, never a clean codebase — and the baseline may only shrink
(`:1196-1212`).
