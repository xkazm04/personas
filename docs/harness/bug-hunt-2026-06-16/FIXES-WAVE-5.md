# Bug Hunter Fix Wave 5 — Highest-blast-radius remaining criticals

> 5 criticals closed across 5 commits, 0 regressions.
> Not a single theme — the five highest-impact open criticals: a money/safety
> bypass, a foundation-wide concurrency corruption, two silent data-corruption
> bugs, and a chat double-persist.
> Baseline preserved: `tsc --noEmit` 0 → 0, `cargo check --features desktop` 0 → 0.
> The 5 pre-existing vitest failures are unrelated and unchanged.

## Commits

| # | Commit | Finding closed | File |
|---|---|---|---|
| 1 | `0cc857b18` | capabilities-use-cases-model-config #1 — budget bypass | `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts` |
| 2 | `8a7c10d7a` | error-handling-hooks-utilities #1 — dedup shared reference | `src/lib/tauriInvoke.ts` |
| 3 | `c6ff22739` | agent-chat #1 — triple-finalization double-persist | `src/stores/slices/agents/chatSlice.ts` |
| 4 | `4ed373a17` | credential-vault-crud #1 — ledger regex wipe | `src-tauri/src/db/repos/resources/credentials.rs` |
| 5 | `1383a2ff6` | database-schema-migrations #1 — FK-off inside txn | `src-tauri/src/db/migrations/fk_hygiene.rs` |

## What was fixed

1. **Budget-enforcement bypass (money/safety).** The Use Case "Run" called the raw `executePersona` IPC binding directly (real, paid CLI spawn), skipping the `isBudgetBlocked` gate that lives in the store action — so a budget-exceeded/stale persona, correctly blocked in the Persona Runner, could still spend through this second button (and fire emit_event cascades). Added the same gate the other call sites use before the IPC call. (Server-side enforcement in `execute_persona_inner` is the deeper fix; the backend has no budget-pause state today.)
2. **IPC auto-dedup shared mutable reference (foundation-wide).** Auto-dedup folded identical read-only calls into one round-trip and returned the same resolved object/array instance to every concurrent caller (held for the 250ms TTL). One caller mutating in place (`.sort()`/`.push()`, a mutating reducer) silently corrupted the others and any store slice holding the value — a concurrency-only Heisenbug. On a dedup hit, additional callers now get a `structuredClone` of the settled value; the single-caller path is unchanged.
3. **Chat double-persist.** A single terminal `EXECUTION_STATUS` event is observed by both chatSlice's listener and `executionSlice.finishExecution` (and `cancelExecution`). `chatStreaming` was only flipped false after `await createChatMessage`, so two callers both saw it `true` and both INSERTed an assistant row — permanent duplicate messages. `finishChatStream` now flips `chatStreaming` false synchronously (guarded on its value) as the first statement, so concurrent callers short-circuit.
4. **Credential-ledger regex wipe.** Every ledger persist path ran `sanitize_secrets` (a log/string redactor, not JSON-aware) over the serialized ledger; a key/value containing `token`/`secret`/`session_id`/etc. got rewritten to invalid JSON, and the next `CredentialLedger::parse` `.ok().unwrap_or_default()`'d it — silently wiping the whole ledger (OAuth expiry/backoff, healthcheck history, usage), so the refresh engine stopped refreshing. Secrets never reach this column (they live in `credential_fields`), so a new `sanitize_ledger_json` keeps the sanitized output only when it's still valid JSON, else persists the original; applied to all five metadata-column writers.
5. **FK-off inside transaction (legacy-upgrade data loss).** `recreate_with_fk` ran `PRAGMA foreign_keys = OFF` *inside* the transaction — a documented SQLite no-op — so FKs stayed ON and `DROP TABLE` fired other tables' `ON DELETE CASCADE`, silently wiping child rows on legacy upgrades (fresh installs early-return, so tests passed). Now wraps the rebuild in `FkDisabledGuard::new(conn)` *before* the transaction (the executions-rebuild pattern) and drops the two in-txn pragma no-ops.

## Verification (before / after)

| Gate | Baseline | After Wave 5 | Notes |
|---|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors | 3 frontend fixes. |
| `cargo check --features desktop` | 0 errors | 0 errors | 2 Rust fixes verified together. |
| `vitest run` | 5 pre-existing failing | 5 (same) | Frontend fixes are in untouched-by-those-tests areas. |

No regressions introduced.

## Cumulative status (across all waves)

| Wave | Theme | Criticals closed | Commits |
|---|---|---:|---|
| 1 | Concurrency / missing-CAS double-execution | 5 | `c3ab4aa7f` `6e960f1b5` `fa326eb14` `9d1de3d78` `0ff899369` |
| 2 | Security & trust-boundary | 5 | `b8f759842` `a3eebc13c` `a02e21210` `34a3fc3f3` `a0b13eaec` |
| 3 | Data-loss: watermark/cursor | 3 | `906645e6d` `d39a6f503` |
| 4 | Recovery/healing & execution-runtime | 4 | `141fab909` `6acedb8f1` `965e3449e` |
| 5 | Highest-blast-radius remaining | 5 | `0cc857b18` `8a7c10d7a` `c6ff22739` `4ed373a17` `1383a2ff6` |

Criticals closed: **22 / 42**. Findings closed overall: **22 / 260**.

## Patterns established (catalogue additions, items 15–18)

15. **Enforce a limit/gate at the chokepoint, not per-call-site.** A budget/permission/rate gate implemented in one of N call paths is bypassable through the others. Put the check at the single boundary every path shares (ideally server-side); a second equally-prominent action that skips it silently defeats the gate.
16. **A deduped Promise resolves to a shared reference, not a copy.** Folding concurrent calls into one in-flight promise hands every caller the *same* object; one caller's in-place mutation corrupts the rest (and anything that stored it). Clone per additional consumer (`structuredClone`), or freeze, or restrict dedup to provably read-only-immutable consumers.
17. **Don't run a non-format-aware transform over structured data that's parsed back.** A regex/string redactor (or any lossy transform) applied to JSON that's later deserialized can break its structure; if the parse then `.unwrap_or_default()`s, it silently wipes the record. Keep the transform only when its output still parses — or don't apply it to structured data at all.
18. **Some connection settings are no-ops inside a transaction.** SQLite `PRAGMA foreign_keys` (and similar) can only change in autocommit; setting it inside a transaction silently does nothing — and a destructive op then runs with the *wrong* setting. Apply such settings via an RAII guard *before* opening the transaction, and verify with a check that's independent of the setting (`PRAGMA foreign_key_check`).

## What remains

20 criticals across the other themes (see `INDEX.md`): e.g. agent-lab `activateVersion` cross-persona write, genome fitness-scale mismatch, mcp-gateways JSON-RPC id desync, connector stale-readiness, design-reviews missing-nodes/edges crash, recipes curation-never-fires, build-sessions simulate clobber, persona-templates checksum-dead, knowledge-base conflict-wrong-winner, fleet broadcast success-theater, companion wake-gate re-entry / stale-session retry, cockpit TTS overlap, approvals orb-clears-before-IPC, google-drive copy-overwrite, research-lab cross-project leak, personas-twin shared-slice overwrite, onboarding skip-marks-complete. Plus the full High/Medium tail. All resumable from `INDEX.md`.
