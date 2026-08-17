# Golden path — IPC command authorization

> **Corrections pass — 2026-08-13.** Applied after the wave-1 expert review
> (`REVIEW-wave1.md`). Command counts across the corpus disagreed (1,649 /
> 1,657 / 1,661 / 1,666) because each composer counted with a slightly
> different grep; the authoritative figure, measured once with
> `grep -rn --include=*.rs -o '#\[tauri::command' src-tauri | wc -l`, is
> **1,673**, and every occurrence below now reads that. Any §9 floor
> assertion seeded from the old number must be re-derived from 1,673.

> Situation node: `backend-runtime/command-authorization/ipc-command-authorization` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of all 564 `.rs` files under
> `src-tauri/src/` (236 of them defining commands) plus the frontend IPC wrapper,
> against `master` @ `7bb572e2b`. Every count below was produced by parsing the
> real source, not estimated. `.claude/worktrees/**` excluded.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

**Adjacent leaves — do not absorb them here.** The Windows WebView2 header race
(`ipc_auth.rs:633` + `tauriInvoke.ts`), exposing an operation on a second
transport, path/id validation at the boundary, ownership verification on a
scoped row, audit logging a sensitive command, and cloud-auth degraded mode are
each their own situation. This path covers **choosing the tier and making the
choice enforce**.

## Trigger

- "Add a command for X" / "expose this from Rust to the frontend"
- "Should this be privileged?" / "what auth tier does this need?"
- "This command fails with *IPC authentication required for this operation*"
- "This command fails with *IPC authentication failed: invalid session token*"
- "Add it to the privileged list" / "why is there a `PRIVILEGED_COMMANDS` list *and* a macro?"
- "Expose this capability over HTTP / MCP / the webhook receiver too"

If you are about to type `#[tauri::command]`, `#[requires(`, a new line inside
`PRIVILEGED_COMMANDS` or `CLOUD_COMMANDS`, `require_privileged`,
`require_privileged_sync`, `require_cloud_auth`, or a new entry in
`generate_handler![]` — you are in this situation.

## The one way

Classify every new command before you write its body, and record the
classification in **both** places in the same commit, because neither one alone
enforces anything for every command shape. Default to **Privileged** for
anything that writes, deletes, spawns a process, touches a caller-supplied
filesystem path, decrypts or spends a credential, or mutates host-level config;
choose **Public** only for a read that the app must be able to perform at cold
start before the session token exists; choose **Cloud** only when the operation
needs a live Google access token. Then: put `#[requires(privileged)]` (or
`#[requires(cloud)]`) directly under `#[tauri::command]`, add the exact function
name to `PRIVILEGED_COMMANDS` (or `CLOUD_COMMANDS`) in
`src-tauri/src/ipc_auth.rs`, and register the function in `generate_handler![]`
at `src-tauri/src/lib.rs:1805`. **The list is what enforces; the annotation is
what documents and audits** — a *sync* privileged command with the annotation
but no list entry fails closed on every call, and an *async* privileged command
with the annotation but no list entry is silently **Public**, because the async
guard `require_privileged` (`ipc_auth.rs:489-504`) only checks that the token
system booted and then returns `Ok`. Prefer a **sync** command for privileged
work when the body allows it: sync gets real defense-in-depth from the
thread-local flag and, critically, is the only shape the existing drift-guard
test can see. Do not invent a fourth tier, do not hand-write
`require_privileged_sync(&state, "name")` in a body when the macro can derive
the name, and do not use the tier as a substitute for validating a path or an
id — that is a different leaf and `ipc_auth` does not do it.

## Mandated primitives

- **`src-tauri/macros/src/lib.rs:57` — `#[requires(level)]`.** The only correct
  way to get a guard into a command body. Derives the command-name literal from
  the `fn` ident (`:63-64`) so a rename can never desync the audit string.
  Levels: `auth` | `privileged` | `cloud`. `#[requires(cloud)]` on a sync `fn`
  is a compile error (`:83-90`); an unknown level is a compile error (`:91-101`).
  It requires a parameter literally named `state`.
- **`src-tauri/src/ipc_auth.rs:117` — `PRIVILEGED_COMMANDS: &[&str]`.** The set
  the invoke wrapper actually keys on. 153 active entries.
- **`.../ipc_auth.rs:705` — `CLOUD_COMMANDS: &[&str]`.** ~~45~~ **50** entries
  (5 were promoted during this campaign). Membership implies the IPC token
  check *as well as* OAuth (`is_privileged_command` at `:107` unions both sets).

  > **CORRECTED 2026-08-14 — the enforcement asymmetry runs the OTHER WAY for
  > cloud, and this document had it backwards.** For `privileged`, the LIST is
  > what enforces: an async command carrying `#[requires(privileged)]` but
  > absent from `PRIVILEGED_COMMANDS` gets no check at all, which is the finding
  > that justified promoting 28 commands. For `cloud`, the ANNOTATION is what
  > enforces — `macros/src/lib.rs:80-82` injects `require_cloud_auth(&state, …)`
  > as the first statement of the function body. So an annotated-but-unlisted
  > cloud command is **not** silently public, and the two tiers must not be
  > reasoned about as one mechanism.
  >
  > Related count discipline: `shared-facts.json`'s `requiresCloud: 56` is the
  > number of `#[requires(cloud)]` ANNOTATIONS, not the size of this list. I
  > conflated the two when briefing a later composer; they differ by design.
  >
  > **§9 items 1–2 of this document have since been BUILT** —
  > `every_requires_annotation_is_listed_or_baselined` (`ipc_auth.rs:1156`)
  > covers sync and async across both tiers, with an instrument assertion and a
  > typed shrink-only `DRIFT_BASELINE`. Gaps 1/3 and Deviations A/C here were
  > written before that landed and need re-deriving. See
  > [cloud-auth-degraded-mode](./cloud-auth-degraded-mode.md).
- **`.../ipc_auth.rs:559` — `wrap_invoke_handler`.** The primary gate. For any
  command in either set it validates `x-ipc-token` with `constant_time_eq`
  (`:610`), rejects with `{"error": "IPC authentication failed: invalid session
  token", "kind": "Forbidden"}` (`:591-594`), and sets the thread-local
  validated flag around dispatch (`:599-601`).
- **`.../ipc_auth.rs:389` — `require_privileged_sync`.** Real defense-in-depth:
  fails closed unless the wrapper set the thread-local flag. Rejects with
  `"IPC authentication required for this operation."`.
- **`.../ipc_auth.rs:489` — `require_privileged` (async).** Audit/logging only.
  **Read its body before relying on it**: after startup it can only return
  `Ok(())`. Treat it as a breadcrumb, never as a gate.
- **`.../ipc_auth.rs:508` — `require_cloud_auth`.** The one guard that enforces
  independently of the list: it reads `state.auth` and rejects when there is no
  access token, distinguishing offline-with-cached-profile from signed-out.
- **`src-tauri/src/lib.rs:1805` — `generate_handler![]`** wrapped in
  `ipc_auth::wrap_invoke_handler`. 1,585 registered entries. Registration is
  what makes a command reachable at all.
- **`.../ipc_auth.rs:965` — `all_sync_requires_privileged_commands_are_registered`.**
  The existing drift guard. Copy its `checked > 50` precondition assertion
  (`:971-976`) into any new gate you write — it is this repo's best example of a
  check that refuses to pass vacuously.
- **`src/lib/tauriInvoke.ts:305` — `invokeWithTimeout`.** The only frontend
  caller. Injects `x-ipc-token` from `window.__IPC_TOKEN` on **every** call
  (`:452,:465`), waits up to 2s for the token to exist (`:90-113`), and retries
  once on an auth failure (`:524-533`). Enforced by `no-restricted-imports`
  (`eslint.config.js:73-81`).
- **`scripts/check-command-contract.mjs`** (`npm run check:contracts`, inside
  `npm run check`) — the live gate that keeps `commandNames.generated.ts` equal
  to `generate_handler![]`. The natural host for a tier check.

## Steps

1. **Classify before you write the body.** Ask, in order: does it write, delete,
   spawn, take a caller-supplied path, read/decrypt/spend a credential, or touch
   host config outside the app's data dir? → **Privileged**. Does it need a live
   Google access token? → **Cloud**. Is it a read the app must complete during
   cold start, before the token exists? → **Public**, and say so in a comment.
   Anything else → **Privileged**. Public is not a default; it is a decision.
2. **Prefer `pub fn` over `pub async fn` for privileged work.** Sync is the only
   shape where the guard actually enforces in-body and the only shape the drift
   test covers. If the body genuinely needs `.await`, accept that the list entry
   is the *sole* enforcement and treat step 4 as mandatory rather than tidy.
3. **Write `#[requires(privileged)]` (or `cloud`) on the line directly under
   `#[tauri::command]`.** Not before it, not with another attribute in between —
   all 237 existing annotations are directly adjacent, and the drift guard reads
   `lines[i + 1]` (`ipc_auth.rs:934`), so breaking adjacency silently disables
   the check for your command.
4. **Add the exact function name to `PRIVILEGED_COMMANDS` / `CLOUD_COMMANDS`**,
   under the section comment for its domain, in the same commit. If you are
   deliberately *omitting* it (only legitimate reason today: the WebView2 header
   race on a command that opens a native dialog), add it as a commented-out
   entry with a written rationale next to the other eight — an undocumented
   omission is indistinguishable from a mistake.
5. **Register it in `generate_handler![]`** at `lib.rs:1805`, then run
   `node scripts/generate-command-names.mjs` (or any `npm run dev`/`build`) to
   refresh `src/lib/commandNames.generated.ts`.
6. **Call it from the frontend only through `invokeWithTimeout`.** You do not
   attach the token, choose headers, or branch on the tier — the wrapper does
   all three. There is no frontend-side tier concept and there should not be.
7. **Run `cargo test --manifest-path src-tauri/Cargo.toml --features desktop`.**
   `--features desktop` is not optional (ci.yml:252-258 explains why); without
   it the build script aborts before any test compiles.
8. **Stop.** No per-command header handling, no manual `require_*` call in the
   body, no frontend allowlist, no second guard inside a helper the command
   calls.

## Anti-patterns

- **Assuming `#[requires(privileged)]` protects an `async` command.**
  `require_privileged` returns `Ok(())` in every post-startup case. 84 of the
  162 privileged annotations are on `async fn`; **40 of those are absent from
  `PRIVILEGED_COMMANDS` and therefore have no enforcement at all.** The
  annotation at the call site reads exactly like the sync one that does work.
  This is the single largest defect class in this situation.
- **Adding the annotation to a *sync* command and forgetting the list.** The
  opposite failure, and it is loud rather than silent: the command fails closed
  on **every** call with "IPC authentication required for this operation." This
  has shipped live at least twice — `get_provider_usage_stats` /
  `get_health_bundle` on 2026-07-14 (78 rejected calls, surfaced to the user as
  an "Incomplete health data" banner), and the whole persona-bundle
  export/import/clipboard/share-link/enclave family (`ipc_auth.rs:353-359`).
- **Adding the list entry and skipping the annotation.** 24 commands do this.
  The wrapper gates them correctly, so nothing breaks — but the call site shows
  no evidence it is privileged, no audit trace is emitted, and the next person
  reading `sign_document` (`signing/mod.rs:38`) has no local signal at all.
- **Renaming a command without touching the list.** Nothing checks that a listed
  name still exists or is still registered; three entries
  (`openapi_parse_from_content`, `openapi_generate_connector`,
  `create_execution`) currently name commands that are not in
  `generate_handler![]`. A rename un-gates the command silently.
- **Reaching for `#[requires(auth)]`.** `require_auth` / `require_auth_sync` are
  documented no-ops (`ipc_auth.rs:419-421`, `:479-481`). All 19 uses are in one
  file (`commands/core/personas.rs`). It communicates a protection that does not
  exist. Use `privileged`, or nothing plus a comment.
- **Hand-writing `require_privileged_sync(&state, "literal")` in a body.** Four
  sites still do. The literal desyncs on rename — which is exactly the class of
  bug `scripts/check-literal-parity.mjs` was written to audit, and that script is
  wired to nothing.
- **Using the tier as path or id validation.** `ipc_auth.rs:325-345` says the
  quiet part out loud — `artist_*` and composition commands are listed "to catch
  renderer-context exploits steering the `file_path` arg at sensitive files" and
  because "without gating any IPC caller could overwrite an arbitrary file."
  `artist_save_composition` (`artist/persistence.rs:77`) still writes to whatever
  absolute path it is handed. Privilege gates *who calls*; it never constrains
  *what the argument points at*.
- **Re-exposing a command-layer function on a second transport without
  re-deciding the tier.** None of the 11 alternate transports consults
  `ipc_auth` — verified: `command_tier` and `is_privileged_command` have **zero**
  callers outside `ipc_auth.rs` and its own tests.
- **Justifying a second transport by pointing at the IPC tier.**
  `dev_tools_http.rs:6-8` reasons "the underlying scan command is already
  unauthenticated on the IPC surface … so this exposes nothing." True, and still
  wrong: it inherits a Public classification that was never actually made.
- **Treating "Privileged" as user consent.** With `withGlobalTauri: true`
  (`tauri.conf.json:16`) and the token in `window.__IPC_TOKEN`, any code running
  in the webview holds full privilege. The tier defends against callers *outside*
  the webview. CSP (`tauri.conf.json:44`, no `unsafe-eval`/`unsafe-inline` in
  `script-src`) is the control that makes that boundary real.
- **Branching on the tier in the frontend.** There is no frontend tier concept
  and adding one would be a third source of truth. Frontend code calls
  `invokeWithTimeout` and handles the rejection.

## Evidence

**Adoption:** 1,673 `#[tauri::command]` definitions across 236 files, 1,585 of
them registered. 237 `#[requires(...)]` annotations (162 privileged — 78 sync,
84 async — / 56 cloud / 19 auth) concentrated in just **43 of the 236 files**.
198 list entries (153 privileged + 45 cloud). 195 of the 1,585 registered
commands are token-gated (**12.3%**). All 237 annotations sit directly under
`#[tauri::command]` — a perfect syntactic signal, and the basis for the gate
below.

- **`commands/credentials/crud.rs:33-35` — `create_credential`. Copy this one.**
  Sync + `#[requires(privileged)]` directly under `#[tauri::command]` + listed at
  `ipc_auth.rs:119` + registered. Every layer agrees; the body gets real
  fail-closed enforcement from the thread-local flag.
- `commands/credentials/broker.rs:27-35` — `mint_credential_handle`. The minimal
  version of the same shape: four lines of body, full enforcement.
- `commands/execution/journal.rs:36-42` — `undo_execution`, with the list entry
  at `ipc_auth.rs:297-300` carrying a written reason ("undo mutates arbitrary
  allowlisted tables").
- `commands/infrastructure/cloud.rs:876-878` — `cloud_deploy_persona`, the
  canonical Cloud shape: `#[requires(cloud)]` + `CLOUD_COMMANDS` entry.
- `ipc_auth.rs:870-985` — the drift-guard test **and its comment block**. The
  comment is the clearest existing statement of the sync/async asymmetry; the
  `checked > 50` assertion at `:971-976` is the repo's best precedent for a gate
  that refuses to pass vacuously.
- `ipc_auth.rs:111-116` — the list's own header comment, stating the Public
  carve-out rule (cold-start reads) that step 1 encodes.
- `lib.rs:3796-3978` — the structural guard test on `generate_handler![]`
  (orphaned `#[cfg]` detection, network-command registration completeness). The
  model for extending machine checks over the registration list.
- `src/lib/tauriInvoke.ts:434-537` — the entire frontend half in one function.
- `engine/management_api.rs:7-10,:136` and `commands/fleet/companion_api.rs:15,:221-234`
  — the two alternate transports that *did* build their own gate
  (`require_api_key` bearer middleware; LAN-peer + bearer + constant-time device
  match). If you must add a transport, these are the two to copy.

## Deviations found

**78 individually-addressable authorization deviations** (categories A–D), plus
five systemic findings (E–I) and 4 unauthenticated transports. All of them ship
green under `npm run check` **and** under `cargo test --features desktop`.

### A. Annotated `privileged`, absent from `PRIVILEGED_COMMANDS` — zero enforcement (40; 32 undocumented)

All 40 are `async`, which is why the drift guard cannot see any of them. Eight
are deliberate, documented omissions (commented-out at `ipc_auth.rs:217-219`,
`:235`, `:372-375`) whose stated compensation — "`require_privileged` inside
their function bodies as defense-in-depth" — is factually a no-op. The other
**32 are silent drift**:

| Path | What's wrong |
|---|---|
| `commands/execution/executions.rs:144-146` | **`execute_persona`** — annotated privileged, unlisted, and `ipc_auth.rs:790` **asserts it is Public in a unit test**. The test codifies the drift. Highest priority: either gate it or delete the annotation and the assertion's ambiguity. |
| `commands/core/data_portability.rs:2193` | `import_portability_bundle_from_path` — imports a bundle from an arbitrary path. Its four siblings are documented omissions; this one is not mentioned anywhere. |
| `commands/credentials/openapi_autopilot.rs:642,:793` | `openapi_parse_from_url` (also **unregistered**), `openapi_playground_test` — outbound HTTP to a caller-supplied URL (scheme is validated at `:650-660`; the host is not). |
| `commands/credentials/mcp_gateways.rs:20,:56,:66,:75` | The whole gateway-membership CRUD — 4 commands mutating which MCP servers a credential fronts. |
| `commands/credentials/mcp_tools.rs:34` | `probe_mcp_server` — **the clearest illustration of the defect.** Its body is a benign localhost health GET, but line `:36` reads `let _ = state; // auth gate only; no state needed for the probe`. The author took an unused `State` parameter *solely* to satisfy the macro, believing the annotation gated the command. It does not. |
| `commands/credentials/rotation.rs:157` | `refresh_credential_cli_now` — every sibling in `rotation.rs` is listed (`ipc_auth.rs:170-181`); this one was missed. |
| `commands/credentials/cli_capture.rs:1016` | `cli_capture_save` — persists a captured CLI credential. |
| `commands/tools/github_platform.rs:12,:23,:37` | `github_list_repos`, `github_check_permissions`, `github_create_patch_release` (unregistered) — spend the user's GitHub token. |
| `commands/tools/n8n_platform.rs:12,:23,:35,:47,:59` | Five n8n commands including `n8n_create_workflow` and `n8n_trigger_webhook`. |
| `commands/tools/tools.rs:162` | `invoke_tool_direct` — direct tool invocation. |
| `commands/tools/triggers.rs:1358` | `dry_run_trigger`. |
| `commands/tools/deploy_automation.rs:12` | `deploy_automation`. |
| `commands/core/use_cases.rs:279,:327,:385,:428,:504,:604` | Six use-case commands including `rename_event_listeners` and `simulate_use_case`. |
| `commands/infrastructure/cloud_sync.rs:16,:26` | `cloud_sync_set_enabled`, `cloud_sync_status`. |
| `cloud/remote_commands.rs:191` | `remote_command_list_pending` — lists pending remote approvals. |
| `commands/design/build_simulate.rs:520` | `get_simulation_artefacts`. |

The eight documented omissions, for the record, include **`export_credentials`
(`data_portability.rs:9556`)**, which calls `cred_repo::get_decrypted_fields`
over every credential in the vault. It is passphrase-protected and audit-logged,
so this is not an open door — but its authorization tier is nominal, not real,
and the code comment says otherwise.

### B. Listed in `PRIVILEGED_COMMANDS`, no guard in the body (24 — 7 sync, 17 async)

The wrapper gates these correctly; the defect is that the call site carries no
evidence and emits no audit trace. Fix by adding the annotation.

`commands/credentials/desktop.rs:14,:27,:35,:43,:54,:68,:99,:109,:123` (9 —
the entire desktop-discovery surface, including `approve_desktop_capabilities`
and `revoke_desktop_approvals`) · `commands/credentials/desktop_bridges.rs:23,:112,:126,:134`
(4, incl. `execute_desktop_bridge`) · `commands/credentials/credential_recipes.rs:11,:20,:29,:63`
(4) · `commands/artist/persistence.rs:77,:107,:152` (3) ·
`commands/signing/mod.rs:38,:138` (`sign_document`, `verify_document`) ·
`commands/credentials/db_schema.rs:165` (`classify_db_query`) ·
`commands/credentials/auto_cred_browser.rs:1607` (`cancel_auto_cred_browser`).

### C. Annotated `cloud`, absent from `CLOUD_COMMANDS` (11)

OAuth is still enforced in-body by `require_cloud_auth`, so these are not open —
but they skip the IPC-token check their 45 listed siblings get, and
`command_tier()` reports them **Public**.

`cloud/remote_commands.rs:229,:311` (`remote_command_approve`,
`remote_command_reject` — these approve and reject *remote execution requests*) ·
`commands/infrastructure/cloud.rs:284,:301,:554,:967,:1090` ·
`commands/infrastructure/cloud_sync.rs:37` ·
`commands/infrastructure/gitlab.rs:157,:446,:1223`.

(`cloud_get_config` and `gitlab_get_config` are deliberately Public per
`ipc_auth.rs:703-704` and `:752` — but they carry `#[requires(cloud)]`, so the
comment and the code disagree.)

### D. List entries naming unregistered commands (3)

`openapi_parse_from_content`, `openapi_generate_connector`, `create_execution` —
all three carry an in-list comment acknowledging they are not wired into
`generate_handler![]`. Harmless today; the defect is that **nothing checks**, so
a future rename of a *live* command produces the same state with no signal.

### E. Public by omission — the base rate (1,390 of 1,585 registered)

87.7% of the reachable IPC surface is Public because no one classified it. A
floor-count of what that includes, derived by parsing command signatures and
bodies (undercounts — only direct bodies were scanned):

- **23 Public commands take a caller-supplied path parameter**, incl.
  `write_sidecar_file` / `read_sidecar_file` (`commands/signing/mod.rs:295,:308`),
  `kb_ingest_directory` (`credentials/vector_kb.rs:597`),
  `obsidian_brain_read_vault_note` (`obsidian_brain/mod.rs:1562`),
  `fleet_write_dispatch_brief` (`fleet/external.rs:78`),
  `ocr_with_gemini` / `ocr_with_claude` (`ocr/mod.rs:145,:421`).
- **13 Public commands spawn a subprocess**, incl. the entire dev-tools git
  surface — `dev_tools_apply_diff` (`dev_tools/git_ops.rs:50`),
  `dev_tools_commit_changes` (`:287`), `dev_tools_run_tests` (`:97`),
  `dev_tools_create_branch` (`:15`) — plus
  `dev_tools_start_slot_server` (`competitions.rs:1041`),
  `dev_tools_run_static_scan` (`static_scan.rs:88`),
  `drive_reveal_in_os` (`drive.rs:1403`).
- **8 Public commands touch decrypt/`session_key`**, incl. `lab_activate_version`
  (`execution/lab.rs:1054`) and `genome_adopt_offspring` (`execution/genome.rs:568`).
- **53 Public commands have destructive names** (`delete_*` / `purge_*` / `clear_*`).

This is not a list of 1,390 bugs — most are genuinely fine. It is the measure of
how little of the surface has ever been through step 1.

### F. Alternate transports that bypass `ipc_auth` entirely (11 routers; 4 with no auth)

Re-exposing command-layer capability is its own leaf, but the authorization
half belongs here: **not one of the 11 consults `command_tier`.** Four have no
authentication of any kind:

| Path | Routes | What's wrong |
|---|---|---|
| `commands/infrastructure/dev_tools_http.rs` | 31 | **Mounted unconditionally in release** (`lib.rs:969-972`) on `127.0.0.1:17400+`. Registers projects, retires contexts, writes KPI decisions, rewrites `context-map.json` + `CLAUDE.md` on disk. Its header (`:6-8`) justifies zero auth by citing the Public IPC tier of the underlying commands — inheriting a classification nobody made. |
| `test_automation.rs` | 46 | `POST /eval` runs arbitrary JS in the webview (`:324-343`), which can read `window.__IPC_TOKEN` — a **complete** bypass of every tier. Correctly disabled in release (`lib.rs:1543-1564`, ship-loop audit 2026-07-02) and dev-only. Listed because it is the reason "Privileged" cannot mean "user-approved". |
| `commands/fleet/hooks.rs` | 1 | Unauthenticated POST receiver mutating fleet session state; mounted in release. |
| `engine/project_tracking/push.rs` | 1 | Unauthenticated; the module comment (`:12`) says "a future hardening pass can layer per-app tokens on top". Mounted in release. |

The other seven each built a bespoke gate: `management_api.rs` (`require_api_key`
bearer, 29 routes), `companion_api.rs` (LAN + bearer + device match, 10),
`companion/orchestration/mcp/mod.rs` (`X-Athena-Session`),
`browser_bridge/mod.rs` (pairing token + per-test session token),
`engine/share_link.rs` (short-lived URL token), `engine/webhook.rs` (per-trigger
URL secret), `mcp_server/` (stdio capability token). Seven independent auth
schemes, zero shared vocabulary with `ipc_auth`.

### G. The tier vocabulary has no production consumers

`AuthTier` (`ipc_auth.rs:761-769`) and `command_tier()` (`:771`) are referenced
**only** by `ipc_auth.rs`'s own tests. `is_privileged_command` (`:107`) has
exactly one caller, `wrap_invoke_handler`. Nothing in the app — not the 11
transports, not the audit log, not the UI — can ask what tier a command is. Two
`.rs` files mention `PRIVILEGED_COMMANDS` outside `ipc_auth.rs`
(`artist/transcribe.rs:136`, `infrastructure/cloud.rs:1382`) and both do so in a
doc comment, i.e. prose that cannot drift-check itself.

### H. Frontend-half defects

- **`src/lib/tauriInvoke.ts:544-554` — `isIpcAuthFailure` matches only one of the
  two backend rejection strings.** It probes for `"IPC authentication failed"`
  (the wrapper's string, `ipc_auth.rs:592`). The sync guard rejects with
  `"IPC authentication required for this operation."` (`:406`) — **not matched**,
  so the one-shot recovery retry at `:524-533` never fires for the exact failure
  mode that category-A/B drift produces. The half of the contract designed to
  paper over the race does not cover the drift.
- **Neither failure has an error-registry entry, and the fallback gives wrong
  advice.** `resolveError` (`errorRegistry.ts:637`) substring-matches a raw
  string. The sync guard's `AppError::Forbidden` renders as
  `"Forbidden: IPC authentication required for this operation."`
  (`src-tauri/core/src/error.rs:51`), which falls into the generic `'Forbidden'`
  rule at `errorRegistry.ts:134-141` → *"Access denied. … Check your credentials
  or contact an admin."* The user is told to check credentials that are fine; the
  actual cause is a missing line in `PRIVILEGED_COMMANDS`. The wrapper's string
  matches no rule at all and lands in `GENERIC_FALLBACK` with an `unclassified`
  breadcrumb (`:656`).
- **The wrapper rejects with a hand-built payload, not an `AppError`.**
  `ipc_auth.rs:591-594` emits `json!({"error": …, "kind": "Forbidden"})` —
  capitalised — while every real `AppError::Forbidden` serialises
  `kind: "forbidden"` (`error.rs:196`). Any frontend branching on `kind` sees a
  shape no other error in the app produces.
- **`tauriInvoke.ts:454-458` gates all 1,585 commands on a token 195 need.** Every
  invoke, including cold-start Public reads, waits on `waitForIpcToken()` (up to
  2s, `:103-111`) before dispatch.
- **40 test files hand-set `globalThis.__IPC_TOKEN = 'test-token'`** because
  `src/test/setup.ts` does not. Pure boilerplate; one line in the shared setup
  deletes 40 copies.

### I. Dead and decorative machinery

- `scripts/check-literal-parity.mjs` — a complete, working audit of exactly the
  rename-desync failure mode in category D, referenced by nothing in
  `package.json` and by no workflow. It is a gate that was written and never
  installed.
- `#[requires(auth)]` — 19 uses, all in `commands/core/personas.rs`, expanding to
  a documented no-op.

## Gaps in the primitive

1. **The macro cannot register the command; the list cannot audit it.** This is
   the headline gap and the root cause of **all 78** deviations in categories A,
   B, C and D. A proc-macro attribute sees one function and
   cannot append to a `const` in another crate; a `const` array cannot know which
   functions carry an attribute. So the repo maintains two sets by hand and the
   coupling direction *inverts* between sync (annotation without list = hard
   fail) and async (annotation without list = silent open). Nothing at either
   call site reveals which regime applies.
2. **`require_privileged` (async) cannot enforce.** Tokio task migration makes
   the thread-local unreliable, so the async guard was reduced to a
   liveness check. This is a genuine runtime limitation, not laziness — but the
   consequence, that 84 annotations are decorative, is nowhere near the call
   sites that carry them. A task-local (`tokio::task_local!`) set by the wrapper
   and read by the async guard would close it; the wrapper already brackets
   dispatch (`:599-601`), so the shape is there.
3. **The drift guard is structurally blind to `async`.** `sync_fn_name`
   (`ipc_auth.rs:895-904`) returns `None` for `pub async fn` **by design**,
   documented at `:888-891` as an intentional exemption. It checks 78 sync
   annotations + 4 direct calls and reports green while 40 async commands drift.
   The exemption was correct when written (the async guard tolerates absence);
   it is wrong now that absence means *no enforcement at all*.
4. **No mechanism to justify an omission.** The eight WebView2-race carve-outs
   are commented-out list entries. There is no typed exemption with a reason
   field, so an omission and an oversight are byte-identical to any checker.
5. **No cross-check between the lists and `generate_handler![]`.** Category D
   exists purely because of this. `lib.rs:3796` already proves the parse is easy.
6. **No tier concept a second transport could reuse.** `command_tier()` is not
   wired to anything, so a new axum router has nothing to call. Seven bespoke
   auth schemes is the predictable result.
7. **The token is a process-lifetime secret in a JS global.** `withGlobalTauri:
   true` + `window.__IPC_TOKEN` means the tier system's threat model is
   "callers outside our webview", full stop. There is no per-command consent, no
   re-auth for destructive operations, no rate limiting (`require_privileged_sync`
   keeps `state` "for future use, e.g. per-command rate limiting", `:413-414`).
   This is a defensible design for a local-first app — it is just not what
   "Privileged" sounds like, and nothing writes it down where a developer
   choosing a tier would read it.
8. **Tauri 2's own ACL is unused for commands.** `capabilities/default.json` lists
   only plugin permissions; the app's 1,585 commands are outside it. Not
   necessarily wrong (the ACL is coarse) — but it means `ipc_auth` is the only
   layer, undocumented as such.
9. **Zero ESLint or script coverage on the frontend half.** 21 custom rules
   exist; none touches IPC auth. `check-command-contract.mjs` already parses both
   `generate_handler![]` and the frontend — it is one function away from also
   checking the tier lists, and is already inside `npm run check`.

## The missing gate

Every deviation above ships green under `npm run check` **and** under
`cargo test --features desktop` (ci.yml:258) — the drift guard runs, passes, and
covers 82 of 237 annotations. The gate is not missing; it is scoped to the half
of the problem that fails loudly, while the half that fails silently is
explicitly exempted.

**Signal.** `#[requires(<level>)]` on the line immediately following
`#[tauri::command]`. Verified: **237 of 237** annotations are exactly adjacent —
a perfect syntactic signal, better than the `role="columnheader"` precedent.
Second signal: membership in the `generate_handler![]` block, already parsed by
three existing checkers (`lib.rs:3889`, `check-command-contract.mjs:38`,
`generate-command-names.mjs:21`).

**Mechanism — three parts, cheapest first.**

1. **Extend the existing Rust drift guard to `async` (~25 lines, in
   `ipc_auth.rs`).** Change `sync_fn_name` to return `(name, is_async)` instead
   of `None` for async, and assert closure in **both** directions:
   - every annotated privileged command (sync *or* async) is in
     `PRIVILEGED_COMMANDS`, unless it is in the exemption table below;
   - every annotated cloud command is in `CLOUD_COMMANDS`;
   - every listed name is either annotated or in the list-only table;
   - every listed name appears in `generate_handler![]`.
   This is the whole of categories A, B, C and D, caught at `cargo test` time.
2. **Replace commented-out omissions with a typed exemption table** in
   `ipc_auth.rs`:
   `const WRAPPER_EXEMPT: &[(&str, &str)] = &[("execute_api_request", "WebView2 header race: renderer batches privileged invokes during Project Overview init"), …];`
   The guard reads it; review sees a required written reason; `git blame` shows
   who took the exemption. Seed it with the 8 documented omissions, then work the
   32 undocumented ones in category A down to zero.
3. **Add a transport-classification test** in `local_http`. Signal:
   `local_http::register_router(` call sites — exactly 5, all in `lib.rs:945-972`.
   Assert the registered prefix set equals a hand-maintained
   `&[(&str, TransportAuth)]` table where `TransportAuth` is
   `BearerToken | SessionToken | PairingToken | UrlSecret | None(&'static str reason)`.
   Adding a router without classifying it fails the build; choosing `None`
   requires typing a reason.

Then, on the frontend half: a Vitest case that reads the two rejection literals
out of `src-tauri/src/ipc_auth.rs` at test time and asserts `isIpcAuthFailure`
returns `true` for both. That makes the cross-language contract machine-checked
in the direction it currently breaks, and it fails if the backend message ever
changes. In the same change, add a dedicated `'IPC authentication'` rule to
`errorRegistry.ts` **above** the generic `'Forbidden'` rule (ordering is
load-bearing — `resolveError` returns the first match) so the drift failure stops
telling users to check credentials that are fine, and make the wrapper reject
with a real `AppError::Forbidden` instead of a hand-built `json!` so its `kind`
matches the rest of the app.

**Allowlist.** The `WRAPPER_EXEMPT` table above (8 entries today, each with a
prose reason). Plus a `LIST_ONLY` table for names that are legitimately in
`PRIVILEGED_COMMANDS` without an annotation — which should be *empty* once
category B is fixed, and the guard should say so. Plus the two deliberate
Public-with-`#[requires(cloud)]` config reads (`cloud_get_config`,
`gitlab_get_config`), which should move to a `PUBLIC_BY_DESIGN` table rather
than living in a comment.

**How it fails loudly if its own precondition is absent.** The existing guard
already models this at `ipc_auth.rs:971-976` (`checked > 50`, with an error
message that tells you the source walk broke rather than that the app shrank).
Extend it, do not weaken it:

- `assert!(sync_checked >= 70, ...)` **and** `assert!(async_checked >= 80, ...)`
  — separate counters. A single combined counter would let the async walk break
  silently while the sync count carried the assertion, which is precisely how the
  current blind spot survived.
- `assert!(!PRIVILEGED_COMMANDS.is_empty() && !CLOUD_COMMANDS.is_empty())` — a
  parse failure that yields empty sets must not read as "no drift".
- `assert!(registered.len() > 1_400, ...)` on the `generate_handler![]` parse.
  Every existing parser of that block uses a slightly different regex, and
  `generate-command-names.mjs:21` currently matches only because
  `"wrap_invoke_handler("` happens to end in `"invoke_handler("` — an accident,
  one refactor away from a checker that silently sees zero commands.
- `assert!(WRAPPER_EXEMPT.iter().all(|(n, _)| commands.contains(n)))` — an
  exemption for a command that no longer exists is a stale exemption, and stale
  exemptions are how allowlists rot into blanket passes.
- Run it where `cargo test --features desktop` already runs (ci.yml:252-258),
  which is a job whose own comment records that it once "never actually run a
  test" for want of that flag. That history is the reason the counter assertions
  are not optional.

**What no gate can do.** Nothing machine-checkable decides whether a *new*
command should be Public, Privileged, or Cloud — that is the judgement in step 1
and it stays human. A checker can only guarantee that whatever you decided is
recorded consistently in all three places, that an exception is written down, and
that the 87.7% Public base rate is the result of decisions rather than of
silence. The strongest available proxy for the judgement itself is a **warn-only
advisory**: flag any newly-added `#[tauri::command]` whose signature contains a
path-typed parameter or whose body contains `Command::new` / `decrypt` /
`fs::write` and which is not gated — the same three signals that produced the
23/13/8 counts in category E. That is a nudge at review time, not a gate, and it
should be labelled as such.
