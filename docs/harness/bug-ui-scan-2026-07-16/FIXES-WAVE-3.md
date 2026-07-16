# Bug-UI Scan Fix Wave 3 — Theme B: credential integrity

> 3 commits, 4 findings closed (all High).
> Baseline preserved: cargo check 0 errors; affected-module Rust tests pass / 0 fail; tsc 0 (no TS touched); vitest 2358/2358 unaffected.
> Scope note: Theme C (uncancelled timeouts) was split out to Wave 4 to keep one mental model per wave.

## Commits

| # | Commit | Findings closed | Files |
|---|---|---|---|
| 1 | `5d708e4c0` fix(oauth): persist provider-rotated refresh_token from the resolve path | oauth-api-proxy #1, connector-catalog #1 (2×High, same root cause) | engine/oauth_refresh.rs, engine/api_proxy.rs, engine/healthcheck.rs |
| 2 | `fd6fa0c42` fix(credentials): don't launder corrupt metadata into an empty ledger | credential-vault-crud #2 (High) | db/models/credential_ledger.rs, db/repos/resources/credentials.rs |
| 3 | `6f1b684f0` fix(credential-recipes): stop the negotiator stub from clobbering a verified recipe | credential-design #1 (High) | db/repos/resources/credential_recipes.rs |

## What was fixed

1. **OAuth rotation discarded → credential bricked.** `resolve_auth_token` performs a real refresh exchange for a locally-expired OAuth token; providers that rotate the refresh_token (RFC 6749 §6) revoke the old one immediately. Both `api_proxy` and `healthcheck` took only `.token`, dropping the rotation, so the next refresh hit `invalid_grant`. Added `oauth_refresh::persist_resolved_token` (atomic, commit-retrying) and call it at both sites (they already hold the per-credential lock). One fix closes both findings. **Line 906 in api_proxy was already safe** — the post-401 resolve reads a token force_refresh just persisted, so no exchange happens there.

2. **Corrupt credential metadata laundered into an empty ledger.** `CredentialLedger::parse` returned `Default` on unreadable JSON, and RMW callers serialized that back — one bad read permanently destroyed OAuth expiry/backoff, healthcheck history, usage, and custom keys. Added `try_parse` (Err on present-but-unreadable) and routed the three RMW sites through `refuse_corrupt_metadata`, aborting the write so the original is preserved and the failure is loud.

3. **Negotiator stub clobbered a verified recipe.** The upsert merged only 3 enrichment columns; `oauth_type`/`fields_json`/`healthcheck_json`/`source` were overwritten unconditionally, so opening the negotiator after a Design run nulled the healthcheck (downstream skips verification), demoted OAuth to plain fields, and mislabeled provenance. Extended the merge policy to COALESCE those columns and only re-stamp `source` when the incoming row actually enriches.

## Verification

| Gate | Before | After |
|---|---|---|
| cargo check (desktop) | 0 errors | 0 errors |
| Rust tests (oauth 23, recipe 127, ledger 9, rotation 13, api_proxy 3, healthcheck 60, credentials 64) | — | all pass / 0 fail |
| tsc | 0 | 0 (no TS touched) |
| vitest | 2358/2358 | 2358/2358 (unaffected) |

## Patterns established (catalogue items 9–11)

9. **"Resolve/getter" that can mutate provider-side state is not read-only** — a token-resolve that transparently refreshes must persist what the provider rotated; treating it as a pure read drops the rotation and bricks the credential. Persist under the lock the caller already holds.
10. **Fallible parse for read-modify-write; lossy parse only for read-only** — a parser that returns `Default` on corrupt input must never feed a write-back. Give RMW paths a `try_parse` that errors, and abort the write to preserve the (recoverable) original instead of laundering an empty value over it.
11. **`ON CONFLICT` upserts from a stub row must COALESCE every enriched column, not just the obvious few** — a partial merge policy silently downgrades a rich row when a later stub with NULL/empty fields conflicts. Audit *all* columns, and gate provenance/source updates on actual enrichment.

## What remains

Themes C–K open. **Wave 4 — Theme C (uncancelled timeouts → duplicate/zombie work)**: artist, team-assignment, director, design-reviews.
