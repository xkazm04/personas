---
layer: application
subject: pipeline-dag
technique: external-adapter-nodes
stack: rust
---

# External adapter nodes — Rust automation dispatch & platform deploy

Where the technique lands in this repo: `src-tauri/src/engine/automation_runner.rs`
(webhook/dispatch invocation), `src-tauri/src/engine/platforms/{deploy,n8n,github,zapier}.rs`
(platform adapters), and `src-tauri/src/commands/tools/deploy_automation.rs`
(the privileged command door).

## What conforms

- **SSRF door before the wire.** `invoke_automation` runs
  `url_safety::validate_url_safety` on the user-supplied webhook URL before
  any network call (`automation_runner.rs:38-44`), rejecting
  private/internal/metadata targets. Header hygiene rides the same boundary:
  RFC 7230 header-name validation and control-character stripping on values
  (`automation_runner.rs:159-169`) block header injection from credential
  fields.
- **Per-adapter target policy.** The n8n client pins `base_url` from the
  decrypted credential, parses it structurally (`url::Url::parse`), enforces
  a scheme allowlist, and validates workflow ids as strictly alphanumeric
  before path interpolation (`n8n.rs:13-23,:90-110`) — the
  shrink-the-validated-surface pattern. (Deliberate local-first relaxation:
  `http` is allowed because self-hosted instances on the user's own machine
  are a first-class target; the desktop app runs *as* the user, which changes
  the SSRF threat model relative to a server.)
- **Run record brackets the wire, in the right order.** Auth headers are
  resolved *before* the run record is created — so a credential failure
  cannot orphan a run stuck in its initial status (`automation_runner.rs:46-52`)
  — then `repo::create_run` writes the before-record, the call executes with
  retry/backoff, and `finalize_run` writes the outcome plus warnings.
  A typed audit row (`tool_audit_log::insert`, with `ToolErrorKind`
  classification) lands regardless of outcome (`automation_runner.rs:129-153`).
- **Save on success only.** `deploy.rs` creates the workflow on the remote
  platform first (`client.create_workflow`, `deploy.rs:124`) and mints the
  local automation row only afterward via `create_and_activate`. The partial
  state "created remotely but activation failed" is recorded *as that* —
  `create_with_error` plus a user-facing `activation_warning` — rather than
  as either full success or a phantom (`deploy.rs:136,:534-573`).
  `deploy_automation` is `#[requires(privileged)]`.
- **Retry with honest classification.** Transient-only retry
  (`is_retryable_error`: timeouts, connect failures, 5xx, 401-with-auth-
  refresh, and 429 since 2026-08-16), exponential backoff capped at 30s,
  attempt count clamped 1–5, and the attempt history surfaced as warnings on
  the run record (`automation_runner.rs:56-109,:350-368`).

## Where it deviates from the standard (kept, reported)

- **Rate-limit hints unread.** 429 is now retryable, but nothing reads
  `Retry-After` — the code comment at `automation_runner.rs:356-363` says so
  itself, while connector docs promise the header is honored. Registered at
  `#w2-retry-backoff` (residual of the "omits 429" entry, whose primary
  defect has since been fixed in code).
- **No idempotency key crosses the wire.** Run/attempt identity exists
  locally but is not sent to platforms that support dedup tokens, so
  retry-after-unknown-fate remains a gamble where it could be safe.
- **Redirect policy is inherited, not stated.** The SSRF door screens the
  original URL; re-screening on redirect (or refusing redirects) is not
  visible at this boundary and rests on the shared HTTP client's defaults.

## Worth stealing

Resolve-auth-before-creating-the-run-record is a two-line ordering decision
that eliminates an entire class of orphaned "stuck in initial status" rows;
`create_with_error` shows how to record a half-succeeded external effect
without lying in either direction.
