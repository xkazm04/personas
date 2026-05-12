# Code-refactor scan — Companion Runtime & Approvals

> Total: 10 findings (2 high, 5 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: significant — none of the listed paths exist. Actual locations: companion frontend lives under `src/features/plugins/companion/` (not `src/features/companion/`); `src/api/companion.ts` exists (singular file holds all of Athena's IPC surface, including approvals); `src/api/approvals.ts` does not exist; `src/lib/companion` and `src/lib/approvals` do not exist; companion store is `src/features/plugins/companion/companionStore.ts` (not `src/stores/slices/companionSlice.ts`); approval state is part of that same store, not `approvalSlice.ts`; Rust commands live in `src-tauri/src/commands/companion/` (approvals at `approvals.rs`), Rust runtime in `src-tauri/src/companion/` (not `src-tauri/src/lib/companion`); there are no separate `db/models/companion.rs` or `db/repos/companion` files — companion uses raw SQL via `state.user_db` against the `companion_approval`, `companion_node`, `companion_episode`, … schema. Companion plugin slice is `src/stores/slices/system/companionPluginSlice.ts` (not `companionSlice.ts`). `companion-bridge.ts` exists under `tests/playwright/`.

## 1. `execute_use_connector` is unreachable dead code (54 LOC)

- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/commands/companion/approvals.rs:1101-1155`
- **Scenario**: A complete `execute_use_connector` function — argument parsing, connector pinned/enabled check, capability registry lookup, per-connector stub message — is defined but never called. The `companion_approve_action` match in `approvals.rs:175-217` does not include a `"use_connector" =>` arm, and dispatch of `use_connector` ops is now intercepted in `companion/dispatcher.rs:358-437` which auto-fires through the background job worker (`companion/jobs/connector_use.rs`) instead of creating an approval row.
- **Root cause**: When `use_connector` was flipped from approval-required to auto-fire (template v5 per `templates/mod.rs:23`), the dispatcher and job-worker paths were added but the original approval executor was left behind. The comment at `approvals.rs:207-210` explicitly states "use_connector no longer reaches here — it auto-fires through the dispatcher → background-job worker." but the function body remained.
- **Impact**: 54 LOC of validation logic duplicated against `connector_use.rs` and `dispatcher.rs:358-437`; misleading to readers tracing the approval flow; will rot relative to the real validation in `connector_use::run`.
- **Fix sketch**: Delete `execute_use_connector` (lines 1101-1155). The dispatcher path covers chat-side validation and `connector_use::run` covers job-time validation — no fallback path needs it.

## 2. Three-way duplication of sidebar route allowlist

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/companion/dispatcher.rs:150-160`, `src/features/plugins/companion/ApprovalCard.tsx:14-24`, `src/features/plugins/companion/CompanionPanel.tsx:79-89`
- **Scenario**: The 9-entry sidebar route list (`'home','overview','personas','events','credentials','design-reviews','plugins','schedules','settings'`) is hand-written in three places: Rust `ALLOWED_ROUTES`, frontend `VALID_ROUTES`, and frontend `VALID_NAV_ROUTES`. The frontend type `SidebarSection` at `src/lib/types/types.ts:384` is the canonical union but is not used as a runtime allowlist.
- **Root cause**: No shared cross-language source. The two frontend copies were added independently (ApprovalCard for client-action navigate, CompanionPanel for the open_route event). Both comments call themselves "defensive mirrors of the backend list" but neither imports from the type definition.
- **Impact**: Adding a new sidebar section requires updating four files (the type, two TS allowlists, one Rust allowlist). Stale frontend copies will silently drop legitimate navigations.
- **Fix sketch**: Frontend — derive a runtime const from `SidebarSection` once in `src/lib/types/types.ts` (e.g. `export const SIDEBAR_SECTIONS: readonly SidebarSection[]`) and import it from both ApprovalCard and CompanionPanel. Rust — generate `ALLOWED_ROUTES` from a single shared registry file or accept "the frontend will drop unknown routes" and let dispatcher accept any string (it's already best-effort).

## 3. Four near-identical `execute_delete_*` executors

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/companion/approvals.rs:595-607` (fact), `:684-696` (procedural), `:759-771` (goal), `:841-853` (ritual)
- **Scenario**: Four executors differ only by (a) the error-message action name, (b) the `crate::companion::brain::X::delete_*` call, and (c) the result-message folder name. Each is 12-13 LOC with the same `params.get("id").and_then.ok_or_else(...).map(...)` boilerplate.
- **Root cause**: Pattern was copy-pasted as each Phase D entity (procedural, goal, ritual) joined the approval set. No shared helper.
- **Impact**: ~50 LOC of duplication; each new entity adds another copy; the four error strings (`"delete_fact: missing id"` etc.) drift independently.
- **Fix sketch**: Introduce `fn execute_delete_generic<F: FnOnce(&UserDbPool, &str) -> Result<()>>(state, params, action_name: &str, archive_path: &str, delete_fn: F)` and have each match arm in the dispatch (`approvals.rs:180-189`) call it with the brain-module function pointer.

## 4. Sources-array extraction triplicated across write executors

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/companion/approvals.rs:532-545` (write_fact), `:630-643` (write_procedural), `:713-721` (write_goal), `:798-806` (write_ritual)
- **Scenario**: The 8-line `params.get("sources").and_then(as_array).map(|arr| arr.iter().filter_map.collect()).unwrap_or_default()` pattern plus the `if sources.is_empty() { return Err(... "must be non-empty array of episode_id strings"...) }` follow-up appears 4 times (with write_goal/write_ritual omitting the empty-check). The dispatcher also performs a parallel "has at least one non-empty source" check at `dispatcher.rs:485-502`.
- **Root cause**: Each write executor was written standalone; no shared param-extraction helper.
- **Impact**: ~50 LOC duplicated; consistency hazard — the dispatcher and executor empty-check semantics drift (executor checks `sources.is_empty()` after silent filter of non-strings; dispatcher checks `any(|x| as_str().is_some_and(|s| !s.is_empty()))` — subtly different on a `[42]` payload).
- **Fix sketch**: Extract `fn parse_sources(params: &Value, action: &str, required: bool) -> Result<Vec<String>>` returning the validated vec, then call it from all four executors.

## 5. `embedding_manager` ml-feature pattern repeated 3+ times

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/companion/approvals.rs:355-378` (log_action_episode), `:569-585` (write_fact), `:662-674` (write_procedural)
- **Scenario**: The "`#[cfg(feature = "ml")]` → `match state.embedding_manager.as_ref()` → `Some(emb) => X_and_embed(..) | None => X(..)` else `#[cfg(not(feature = "ml"))] X(..)`" block is duplicated three times in `approvals.rs` alone, and appears elsewhere in `companion/brain/episodic.rs` / `chat.rs` paths.
- **Root cause**: Each new "write a brain item" path was implemented standalone with its own conditional embedding wiring instead of pushing the ml feature gate inside the brain-module functions.
- **Impact**: ~60 LOC duplicated across the file; each new embed-capable write executor copies the pattern; conditional-compilation drift risk.
- **Fix sketch**: Push the `#[cfg(feature = "ml")]` decision into each brain module's `write_*` (single entry point that internally calls `write_*_and_embed` when ml is on and an embedder is available). Approval executors then call one function.

## 6. Three-store-call sidebar-→-plugin-→-tab navigation duplicated

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/plugins/companion/ApprovalCard.tsx:61-65` and `src/features/plugins/companion/CompanionPanel.tsx:634-637`
- **Scenario**: The exact sequence `useSystemStore.getState().setSidebarSection('plugins'); setPluginTab('companion'); setCompanionPluginTab(tab)` is open-coded in two places: the `open_companion_tab` client-action handler in ApprovalCard and the `COMPANION_COMPOSE_DASHBOARD_EVENT` listener in CompanionPanel. Comments in CompanionPanel explicitly note "Same three-store-call pattern as the OpenCompanionTab client action; kept inline".
- **Root cause**: No shared helper for "deep-link into companion tab N". Each surface inlined the sequence.
- **Impact**: 2 sites, will become 3 if another auto-fire op (e.g. compose_cockpit if it ever targets a companion tab) needs the same deep-link.
- **Fix sketch**: Add `useSystemStore.getState().openCompanionTab(tab: CompanionPluginTab)` action in `companionPluginSlice.ts` that batches the three sets. Both call sites reduce to one line.

## 7. Voice-readiness predicate duplicated in panel + footer

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:714-722` (`voiceActive`, `synthesisCredentialId`, `synthesisVoiceId`) and `src/features/plugins/companion/CompanionFooterIcon.tsx:84-92` (`voiceConfigured`, `synthesisCredentialId`, `synthesisVoiceId`)
- **Scenario**: Both files compute "is the chosen engine ready?" and the per-engine credential/voice resolution. The CompanionFooterIcon's comment at line 83 even acknowledges: "Per-engine readiness check — same shape as CompanionPanel's `voiceActive` predicate."
- **Root cause**: The predicate was inlined in each consumer rather than extracted to a hook or selector.
- **Impact**: 2 sites today, will grow as e.g. Setup / Voice tabs need the same readiness check. Changes to engine resolution must touch both places.
- **Fix sketch**: Add `useVoiceReadiness(): { active: boolean; credentialId: string|null; voiceId: string|null }` hook reading from `useSystemStore` and returning the resolved triple. Both call sites reduce to one hook call.

## 8. Two `companion://navigate` listeners in the same component

- **Severity**: low
- **Category**: structure
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:581-589` (open_route nav) and `src/features/plugins/companion/ApprovalCard.tsx:28-33` (navigate client-action)
- **Scenario**: There are two distinct paths through the frontend for "switch sidebar section because Athena said so": (a) `COMPANION_NAVIGATE_EVENT` for auto-fire `open_route` ops, (b) `ClientAction { type: 'navigate' }` payload from an approval outcome. They do the same thing (validate against an allowlist, call `setSidebarSection`) via different mechanisms. Note also the Rust-side comment at `approvals.rs:506-510` says the Navigate ClientAction is "preserved on `ApprovalOutcome` for future approval-gated UI ops (e.g., `prefill_persona_create` once that's wired)" but `prefill_persona_create` does NOT emit a Navigate action — it emits PrefillPersonaCreate.
- **Root cause**: Two protocol surfaces evolved in parallel — the auto-fire Tauri event and the approval-outcome client action. Both still exist for symmetry, but no current backend code path emits `ClientAction::Navigate`.
- **Impact**: Small dead/speculative surface area; readers tracing "how does Athena navigate me?" find two answers; the unused `ClientAction::Navigate` variant in `approvals.rs:67` is essentially future-proofing that may never land.
- **Fix sketch**: Either (a) delete `ClientAction::Navigate` and the matching frontend handler at `ApprovalCard.tsx:28-33` (and the `VALID_ROUTES` const guarding it), or (b) explicitly document it as a stability boundary the dispatcher might emit later — current state is mid-decision.

## 9. Build-oneshot is a thin wrapper over prefill_persona_create

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/companion/approvals.rs:911-953` (prefill_persona_create) and `:959-990` (build_oneshot)
- **Scenario**: `execute_build_oneshot` re-implements ~90% of `execute_prefill_persona_create`: same param extraction (intent/name/companion_session_id), same emptiness check, same `ClientAction::PrefillPersonaCreate` return — differing only in (a) `auto_launch=true` and `mode="one_shot"` hard-coded, (b) a different chat-side message string.
- **Root cause**: `build_oneshot` was added as a "deliberate prompt-vocabulary alias" (per the inline comment at lines 194-199) for ergonomic Athena phrasing, but the implementation forked rather than parameterizing.
- **Impact**: 32 LOC near-clone; future changes to prefill_persona_create's param parsing won't reach build_oneshot.
- **Fix sketch**: Extract `fn build_prefill_action(params, default_auto_launch: bool, default_mode: Option<&str>, message: &str) -> Result<ExecuteResult>` and have both arms call it. Or delete `build_oneshot` and have Athena emit `prefill_persona_create` with explicit `auto_launch: true, mode: "one_shot"`.

## 10. `Allow ml-feature embedding pattern` open-coded duplication of `log_action_episode`

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/companion/approvals.rs:353-382`
- **Scenario**: The `log_action_episode` helper is itself an instance of the same ml-feature-vs-not pattern as finding #5: 23 LOC choosing between `append_episode_and_embed` and `append_episode` based on the `ml` cfg and whether `state.embedding_manager` is Some. It's effectively the same shape as the inline blocks in write_fact / write_procedural.
- **Root cause**: As above — the conditional belongs inside `episodic::append_episode` not at every call site.
- **Impact**: ~25 LOC; once #5 is fixed this becomes a trivial single call.
- **Fix sketch**: Subsumed by finding #5 — once `episodic::append_episode_smart(pool, embedder_opt, ...)` exists, `log_action_episode` collapses to ~5 LOC (just the warn-on-error).
