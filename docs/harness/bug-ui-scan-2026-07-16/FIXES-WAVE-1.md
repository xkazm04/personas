# Bug-UI Scan Fix Wave 1 — The 4 Criticals

> 4 commits, 4 findings closed (all Critical).
> Baseline preserved: cargo check 0 errors; affected-module Rust tests 174 pass / 0 fail; tsc 0 (no TS touched); vitest 2358/2358 unaffected.
> Branch: `vibeman/bug-ui-scan-2026-07-16-fixes` (off master).

## Commits

| # | Commit | Finding closed | Files |
|---|---|---|---|
| 1 | `d05eee714` fix(enclave): bind signer public key to claimed peer_id | crypto-secure-storage #1 (CRIT) | engine/enclave.rs, engine/identity.rs |
| 2 | `05490c9f6` fix(memories): never let review delete pinned core | knowledge-base-memories #1 (CRIT) | commands/core/memories.rs, db/repos/core/memories.rs |
| 3 | `60281608b` fix(obsidian): contain resolve_conflict writes + TOCTOU | obsidian-brain #1 (CRIT) | commands/obsidian_brain/mod.rs |
| 4 | `d88885da5` fix(pipeline): recover pipeline runs after unclean shutdown | pipeline-agent-chains #1 (CRIT) | db/repos/resources/teams.rs, lib.rs |

## What was fixed

1. **Enclave trust bypass (security).** `verify()` verified the signature against the archive-embedded public key while deriving trust from the separately-supplied `signer_peer_id`, with nothing binding them — a forged enclave signed with the attacker's key but claiming a trusted peer's id read as `signature_valid` AND `creator_trusted`. Now the embedded key must hash to the claimed peer_id (peer_id = base58(sha256(key))) before the signature counts, and trust additionally requires the peer's *stored* key to match. Added reusable `identity::peer_id_from_public_key_b64`. Mirrors the known-good `bundle.rs` / `parse_identity_card` patterns.

2. **Core-memory deletion by LLM review (data loss).** The review pipeline never shows the LLM a memory's tier, yet any low-scored memory was hard-deleted — so "Review memories" could irreversibly destroy a user-pinned `core` memory. Low-scoring core memories are now kept/skipped in the pipeline, plus a defence-in-depth `repo::delete_non_core` (DELETE … WHERE tier != 'core') backs both apply paths. Explicit user delete is unchanged.

3. **Obsidian conflict-resolve path traversal (security).** The `use_app` arm joined a caller-supplied `file_path` to the vault verbatim — `..` or a Windows absolute path escaped into an arbitrary-file overwrite. Now routed through `resolve_vault_subpath`, with a pre-write re-hash of the on-disk file that refuses to clobber a vault edit made while the dialog was open (TOCTOU).

4. **Pipeline run bricks team after crash (availability).** A crash/quit mid-run left `pipeline_runs` at `running` forever; two guards (execute + delete) key off it and cancel is in-memory-only, so the team became permanently unusable. Added `recover_interrupted_pipeline_runs` (marks running/awaiting_approval rows failed) called once at startup beside `recover_stale_executions`.

## Verification

| Gate | Before | After |
|---|---|---|
| cargo check (desktop) | 0 errors | 0 errors |
| Rust tests (enclave/memories/obsidian/teams/pipeline) | — | 174 pass / 0 fail |
| tsc | 0 | 0 (no TS touched) |
| vitest | 2358/2358 | 2358/2358 (unaffected) |

## Patterns established (catalogue items 1–4)

1. **Untrusted key↔identity binding** — when a signature carries both a public key and a claimed identity id, never trust the key for the signature and the id for the trust lookup independently; require `derive_id(key) == claimed_id` first. (enclave, cf. bundle/card)
2. **Tier/pin guard on the irreversible action, not just the mutation** — a batch that protects `core` on update/merge/archive must also protect it on *delete*; the destructive branch is the one that most needs the guard. Belt-and-braces with a `_non_core` repo variant.
3. **Every caller-supplied path joins through one containment helper** — a new write/read site that joins an IPC path to a sandbox root must reuse the existing `resolve_*_subpath` guard; siblings drift otherwise. Pair with a TOCTOU re-hash before destructive overwrites.
4. **Every `running`-state table needs a startup recovery sweep** — a plain async task that writes a terminal status only on the happy path leaves an owner-less `running` row after a crash; if any guard keys off that state, one unclean shutdown bricks the feature. Sweep it at startup like `recover_stale_executions`.

## What remains

Themes A–K from the INDEX are open. Suggested next: **Wave 2 — Theme A (crash-orphaned `running` rows)**, which reuses pattern #4 across approvals, agent-lab, dev-tools automations, the repositories zombie-sweep, and the healing slot leak.
