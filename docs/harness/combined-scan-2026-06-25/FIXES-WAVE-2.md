# Combined-Scan Fix Wave 2 — Auth / trust-boundary bypass

> 5 atomic commits, 6 findings addressed (2 Critical + 4 High). Dispatched as 5 parallel edit-only fix-subagents (disjoint files); orchestrator ran `cargo test --lib` + committed.
> Baseline preserved: lib + test harness compile clean; **byom 39 pass / 0 fail** (incl. 12 new/updated), **management_api 12 pass / 0 fail** (incl. new scope test); TS untouched.

## Commits

| # | Commit | Finding | Severity | Outcome |
|---|---|---|---|---|
| 1 | `b0971d14a` | dev-tools #1 (GitHub path interpolation) | High | **Fixed** |
| 2 | `dd4d3f7be` | byom #2 (management-API scopes) | High | **Fixed** + unit test |
| 3 | `86c383ec3` | byom #1 (compliance fail-open) + #3 (routing no-op) | Critical + High | **Mitigated** (visible+blocking) / **Fixed** |
| 4 | `1a4f0a461` | webhooks #1 (smee unauth injection) | High | **Improved** (opt-in HMAC) |
| 5 | `8e97617e3` | persona-templates #1 (integrity inert) | Critical | **Comment corrected** — enforcement deferred |

## What was fixed (fully)

1. **GitHub URL path-injection (High).** `owner`/`repo`/`base_branch` flowed unvalidated into `format!("…/repos/{owner}/{repo}/…")` + `reqwest::get`, so `owner="../.."` collapsed (dot-segment normalization) to a different api.github.com endpoint under the user's PAT. Added `validate_repo_segment` / `validate_git_ref` (mirroring n8n's `validate_workflow_id`) at every URL choke point.
2. **Management-API broken authorization (High).** `require_api_key` never checked the persisted `scopes`, so a read-only key could drive the credential proxy / build / rollback. Added a route→scope map (proxy & mutations → `personas:execute`, build → `personas:build`, GET → none) enforced in the middleware with a 403; gating on existing scopes keeps the execute-capable system key working while denying read-only keys.
3. **BYOM inert routing rules (High).** `validate()` now warns when a routing rule uses a non-`Standard` complexity the runner can never produce.
4. **Smee unauth event injection (High → improved).** Stopped treating the attacker-controlled `allowed_repos` field as a security control; added opt-in `x-hub-signature-256` HMAC verification (reusing `webhook.rs`'s constant-time helper) that fails closed on a present-but-invalid signature; secret-less relays keep working but now log an explicit bearer-credential posture warning.

## ⚠️ Two Criticals partially addressed — enforcement DEFERRED (need decisions)

**A. BYOM compliance rules fail open (Critical).** Rules with `workflow_tags` never matched because the runner passes `persona_tags = &[]` (Persona has no tag field). **Done now:** `validate()` emits a *blocking* `Error` warning so the admin can no longer silently save a no-op compliance control. **Deferred:** real runtime enforcement needs a *persona tag source* — what defines a "workflow tag" and where it comes from is a product decision. The control is now honest (visible) but not yet enforcing.

**B. Template-integrity check is inert (Critical).** The checksum manifest is keyed by full file path + whole-file hash, but callers pass a bare id + payload-only JSON, so `is_known_template` is always false and the tamper-reject branch is unreachable. **Done now:** corrected the false "this catches tampered templates" comment. **Deferred:** a naive in-code re-key would *re-brick* the Presets feature (whole-file vs payload hash, JS insertion-order vs Rust serde ordering). Real enforcement needs a **codegen change**: regenerate an id-keyed *payload*-hash manifest in both `scripts/generate-template-checksums.mjs` (JS) and `template_checksums.rs` (Rust), add `verify_template_payload`, then re-enable the reject (unknown/dynamic ids keep warn-and-allow). Requires running the generator + matched hashing.

## Verification

| Gate | Result |
|---|---|
| `cargo test --lib` (compile) | green (lib + full test harness) |
| byom tests | 39 pass / 0 fail |
| management_api tests | 12 pass / 0 fail |
| tsc / vitest | unchanged (no TS files touched) |

## Patterns established (catalogue items 5–8)

5. **Authenticated ≠ authorized** — a middleware that validates the token but never checks the persisted scope/role is a broken-function-level-authorization hole. Map every sensitive route to a required scope; 403 on mismatch; fail closed on corrupt scope JSON.
6. **Trusting a field from the body you're authenticating** — matching an allowlist against an attacker-controlled JSON field (`repository.full_name`) is no auth at all. Authenticate the *envelope* (signature/secret), not a value inside the payload.
7. **Silent fail-open security control** — a compliance/routing rule that can never match is worse than a rejected one: it implies protection that isn't there. If you can't enforce yet, make the no-op *visible and blocking* at config time.
8. **The fix that re-bricks the feature** — when an integrity check was deliberately defanged because a naive reject broke legit use, re-enabling it requires reconciling the *contract* (key + hashed content), not just flipping the branch. Verify the hash inputs match end-to-end before enforcing.

## Cumulative status (Waves 1–2)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1 | Security — code-exec / SSRF / path-safety | 5 (2C/2H/1M) |
| 2 | Auth / trust-boundary bypass | 6 (2C partial / 4H) |

**Remaining working set: ~4 Critical (2 of the 6 now mitigated-but-deferred) + 73 High** + Med/Low tail. Next: Wave 3 — Scheduler + watermark/sync data-flow (cron backfill watermark **C**, webhook_notifier watermark, cloud-sync resync, messages relay).
