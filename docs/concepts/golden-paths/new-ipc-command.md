# Golden path — New IPC command

> Situation node: `backend-runtime/command-definition/new-ipc-command` · [situation spine](../situation-spine.md)
> Two-sided (`sides: both`, `fusedAcrossSides: true`) · recurrence **1,790** · risk **high**.
> Dimensions: **function · code-quality · security · resilience**.
> Composed 2026-08-14 against `master` @ `c97500c2d` from a ground-truth sweep of all
> **963** `.rs` files under `src-tauri/` (564 of them under `src-tauri/src/`), the
> **4,829** `.ts`/`.tsx` files under `src/`, the **1,032** generated binding files,
> `ci.yml`, and the four checkers that guard this surface. Every number below was
> produced by parsing the real source with two independent implementations that
> agreed; none is estimated. `src-tauri/target/**` and `.claude/worktrees/**` excluded.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

> ### ⚠ Correction to `shared-facts.json` — the command count is wrong there too
>
> `shared-facts.json` reports `rust.tauriCommands: 1666`. The wave-1 corrections pass
> reports **1,673** as "the authoritative figure". **Both are wrong**, and they are wrong
> in the same way for different amounts. `grep -o '#\[tauri::command'` returns 1,673
> occurrences; **12** of those are prose or string literals, not attributes:
> 7 on comment-only lines (`macros/src/lib.rs` doc examples, `commands/testing/mod.rs:8`)
> and **5 inside string literals in this repo's own checkers** —
> `core/src/context_fingerprint.rs:184,:614`, `lib.rs:3858,:3874,:3957`.
> `shared-facts.json` filtered the 7 comment lines and kept the 5 string literals.
>
> **The real count is 1,661 attribute sites → 1,658 unique command functions**
> (3 names appear twice, each a `#[cfg]`-gated pair inside one file:
> `twin_ingest_doctrine_docs`, `obsidian_graph_start_watcher`, `obsidian_graph_stop_watcher`).
> Reproduce: count lines whose *trimmed* text begins with `#[tauri::command`, then
> resolve each to the following `fn` name. Any floor assertion seeded from 1,666 or
> 1,673 is over by 5 or 12 — small, but this is the third consecutive wave to publish
> a wrong number for the single most-cited fact in the corpus.

## 1. Trigger

- "Add a command for X" / "expose this from Rust to the frontend"
- "The frontend needs this data — wire it up"
- "`Command "foo" not found`" / "my new command isn't showing up in `CommandName`"
- "Why is `commandNames.generated.ts` dirty in my diff?"
- "TypeScript can't find `@/lib/bindings/MyNewType`"
- "This IPC call hangs / times out after 90 seconds"

If you are about to type `#[tauri::command]`, a new line inside `tauri::generate_handler![]`,
`#[derive(TS)]`, `#[ts(export)]`, `invokeWithTimeout(` / `invoke(` with a new string
literal, a new entry in `commandNames.overrides.ts`, or `-> Result<serde_json::Value, AppError>`
— you are in this situation.

### Scope — what this path owns, and the two leaves next to it

**`command-naming-placement` (recurrence 1,650) is NOT absorbed. Boundary drawn here.**
The two leaves genuinely separate, and the seam is *whether the decision has a wire
consequence*:

- **This path owns the name as a wire key.** The Rust `fn` ident *is* the IPC name
  (`macros/src/lib.rs:63-64` derives the audit literal from it; `generate_handler!`
  registers by it; `commandNames.generated.ts` emits it; `PRIVILEGED_COMMANDS` keys on
  it; the frontend string literal must equal it). It lives in **one flat global
  namespace of 1,585 entries with 187 distinct first tokens**, of which **707 (44.6%)
  begin with a bare verb** (`get_`, `list_`, `create_`) carrying no domain prefix. So
  "pick a name that cannot collide, and then spell it identically in five places" is
  step 1 of *this* procedure and cannot be deferred.
- **`command-naming-placement` owns everything downstream of that:** which
  `commands/<domain>/<file>.rs` the fn lives in, when a module has grown enough to
  split, re-export conventions, and the `commands::` path taxonomy. Tauri does **not**
  namespace by module — `commands::a::foo` and `commands::b::foo` are the same wire
  name — so module placement is a code-organisation decision with *no* wire effect.
  That is a clean, non-overlapping split, and it is why the two leaves have different
  dimension sets (`security · resilience` here; `code-quality · function` there).

**`ipc-command-authorization` (`docs/concepts/golden-paths/ipc-command-authorization.md`)
owns the tier decision.** That path answers *"Public, Privileged, or Cloud, and how do
I make the choice enforce?"* This path answers *"what are all the steps, and which one
will I forget?"* — and therefore states only that classifying is a mandatory,
non-skippable step (§4 step 2), names the two artefacts it writes, and delegates the
judgement. Do not re-derive tier reasoning here.

Also adjacent and deliberately not covered: `typed-error-contract.md` (the `AppError`
half of the return type), `row-to-struct-mapping.md` (how the repo layer builds the
struct this command returns), and `backend-to-frontend-events.md` (if the answer is a
stream rather than a return value).

## 2. The one way

Add a command in **one commit that touches six files**, and treat the type as the
contract rather than the string. Write `#[tauri::command]` on a `pub fn` in the
`commands/<domain>/` module that owns the capability; give it a name that is unique
across all 1,585 existing commands and reads `<domain>_<verb>_<noun>` when the domain
is not already implied by the verb; return `Result<T, AppError>` where **`T` is a named
struct or enum carrying `#[derive(TS)] #[ts(export)]`** — never `serde_json::Value`,
because a `Value` return is the one shape ts-rs cannot describe and it forces the
frontend to hand-write the contract instead. Classify its tier
([`ipc-command-authorization.md`](./ipc-command-authorization.md)) and record that
classification in both places that path names. Register the fn in
`tauri::generate_handler![]` at `src-tauri/src/lib.rs:1805` — this is the step the
framework will not do for you and the step every other artefact silently depends on.
Then run `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings`
(all three flags are load-bearing; the repo's own instruction omits two of them — see
§7 D1) and `node scripts/generate-command-names.mjs`, and **commit
`src/lib/bindings/*.ts` and `src/lib/commandNames.generated.ts` in the same commit** —
a new binding file is *untracked*, and `git diff --quiet src/lib/bindings/` cannot see
an untracked file, so CI will not catch it for you. On the frontend, add exactly one
thin wrapper to `src/api/<domain>/<file>.ts` that calls `invokeWithTimeout` and types
its result by **importing the generated binding** — never by declaring a local
`interface`. Take the 90s default timeout unless you can state, in a comment, why this
call is different. Then stop: no manual header handling, no second wrapper, no
`commandNames.overrides.ts` entry, no local mirror of the response type.

## 3. Mandated primitives

**Backend**

- **`#[tauri::command]`** — Tauri's attribute. 1,661 sites. It makes a function
  *invocable*; it does **not** make it *reachable*.
- **`src-tauri/src/lib.rs:1805` — `tauri::generate_handler![]`**, wrapped in
  `ipc_auth::wrap_invoke_handler`. **1,585 entries** (128 of them under a `#[cfg]`).
  This is what makes a command reachable. There is no auto-registration.
- **`ts_rs::TS` — `#[derive(TS)] #[ts(export)]`.** 990 derives / 996 `#[ts(export)]`
  attributes. Writes TypeScript into `src/lib/bindings/` via `TS_RS_EXPORT_DIR`,
  emitted by **each crate's own `build.rs`** (`src-tauri/build.rs:20`,
  `core/build.rs:20`, `db/build.rs:12`, `engine/build.rs:6`) — not by
  `.cargo/config.toml:14`, which is a backstop only.
- **`src-tauri/macros/src/lib.rs:57` — `#[requires(level)]`.** Derives the command-name
  literal from the `fn` ident (`:63-64`), so the audit string can never desync from a
  rename. Requires a parameter literally named `state` (`:53-56`).
  `#[requires(cloud)]` on a sync fn is a compile error (`:83-90`).

**Codegen and checkers**

- **`scripts/generate-command-names.mjs`** — parses `generate_handler![]`, writes the
  `CommandName` union to `src/lib/commandNames.generated.ts`, and auto-prunes
  `commandNames.overrides.ts`. Runs inside `scripts/run-codegen.mjs` on `predev` /
  `prebuild` (`package.json:23,:30,:33`).
- **`scripts/check-command-contract.mjs`** (`npm run check:contracts`, inside
  `npm run check`) — three assertions: generated ≡ `generate_handler![]`; every frontend
  command literal is registered or listed as an override; an override that names an
  *implemented* Rust command fails.
- **`.github/workflows/ci.yml:297` — Job C `command-name-drift`** — regenerates and
  `git diff --quiet`s both command-name files.
- **`.github/workflows/ci.yml:319` — Job D `binding-drift`** — runs
  `cargo test --workspace ... --features desktop export_bindings` then
  `git diff --quiet src/lib/bindings/`. Its own comment block (`:369-386`) is the best
  documentation in the repo of *why* each flag is required.
- **`src-tauri/src/lib.rs:3952` — `every_network_command_is_registered_in_generate_handler`** —
  the only test that checks a command is registered. It covers `src/commands/network/`
  and nothing else. Copy its `declared.len() > 20` precondition assertion (`:3955-3961`).
- **`src-tauri/src/lib.rs:3916` — `generate_handler_has_no_orphaned_cfg_attributes`** —
  catches the stacked-`#[cfg]` shape that once silently deleted 15 commands.

**Frontend**

- **`src/lib/tauriInvoke.ts:305` — `invokeWithTimeout<T>(cmd, args?, opts?, timeoutMs?)`.**
  The only sanctioned caller. `cmd` is typed `CommandName`, so a typo is a compile
  error. Default timeout `DEFAULT_TIMEOUT_MS = 90_000` (`:37`); per-command override
  table `BLOCKING_MUTATION_TIMEOUTS` (`:64-81`, **3 entries**); an explicit caller value
  always wins (`:333`). Also does `undefined`→`null` coercion for `Option<T>` params,
  auto-dedup of read-only commands, IPC metrics, and the `x-ipc-token` injection.
- **`eslint.config.js:73-81` — `no-restricted-imports`**, `"error"`, banning
  `invoke` from `@tauri-apps/api/core`. **Verified working: exactly one production call
  site of the raw API exists and it is inside `tauriInvoke.ts:474`, the wrapper itself.**
- **`src/lib/utils/tauri/safeInvoke.ts:61` — `safeInvoke<T>(fallback, ...args)`.** Use
  **only** when a command may legitimately not exist yet (a tier-gated or in-flight
  backend). It swallows Tauri's `Command "x" not found` and returns the fallback. 80
  production sites. Read its header before reaching for it — it is also how a dead
  command hides (§7 A2).
- **`src/api/<domain>/<file>.ts`** — the wrapper layer. 130 files, **1,438 typed invoke
  sites**. Convention is `import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke"`
  (123 files do this).

## 4. Steps

1. **Choose the wire name first.** It must be unique across all 1,585 registered
   commands — Tauri's namespace is flat and module paths do not disambiguate. Grep for
   it before you type it. If the verb alone (`get_status`, `list_items`) could plausibly
   belong to two features, prefix the domain (`kb_`, `dev_tools_`, `companion_`).
2. **Classify the tier before you write the body**, per
   [`ipc-command-authorization.md`](./ipc-command-authorization.md) §Steps 1-4. Public
   is a decision, not a default. This step produces at most two more lines
   (`#[requires(...)]` + a list entry) and cannot be retrofitted safely later.
3. **Declare `-> Result<T, AppError>` with a *named* `T`.** If the response has more
   than one field, that is a `#[derive(Debug, Serialize, Deserialize, TS)] #[ts(export)]`
   struct in the same module. **Do not return `serde_json::Value`.** 104 commands do,
   and §7 C shows exactly what that costs.
4. **Write the function** with `state: State<'_, Arc<AppState>>` named `state` (the
   macro requires that ident) and prefer `pub fn` over `pub async fn` for privileged
   work — sync is the only shape whose in-body guard actually enforces.
5. **Register it** in `generate_handler![]` at `lib.rs:1805`, in the block for its
   domain. If it is `#[cfg]`-gated, put the attribute on the line directly above and
   nothing else between.
6. **Regenerate, and read the output.**
   `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings`
   then `node scripts/generate-command-names.mjs` (or any `npm run dev`).
7. **`git status src/lib/bindings/` — do not skip this.** New binding files are
   **untracked**, and both the local `git diff --quiet` habit and CI Job D are blind to
   untracked files (verified: exit code 0 with a brand-new file present). `git add` each
   new binding. ~~and add its `export type { X } from "./X";` line to
   `src/lib/bindings/index.ts` — nothing regenerates that barrel and **86 of 1,032
   binding files are already missing from it**.~~ **Do NOT do this — corrected
   2026-08-14.** The barrel has **zero importers**: all 853 consumers import the
   direct path (`@/lib/bindings/Foo`), and `knip.json:18` excludes the directory
   from dead-code analysis, which is why it went unnoticed. Adding a line to it
   is work with no consumer. See §7.
8. **Add one wrapper** in `src/api/<domain>/<file>.ts`:
   `export const doThing = (id: string) => invoke<MyResult>("do_thing", { id });`
   with `import type { MyResult } from "@/lib/bindings/MyResult";`. One line, no
   try/catch, no error mapping (that is `typed-error-contract.md`), no local `interface`.
9. **Decide the timeout explicitly, then usually take the default.** 90s is right for
   nearly everything; **52 of 1,550 call sites (3.4%) override it**. If your command
   spawns a CLI, waits on a model, or drives a browser, pass
   `{ timeoutMs: … }` *and* consider adding the command to `BLOCKING_MUTATION_TIMEOUTS`
   so every future caller inherits it rather than each one re-deciding.
10. **Stop.** No `commandNames.overrides.ts` entry (that file is for commands that do
    not exist — adding to it declares your work unfinished). No second transport. No
    hand-written response type. No `safeInvoke` unless the command genuinely may be absent.

### Can the primitive make the wrong call impossible? — answered

The contract asks this before §9 is written. Three answers, in descending order of payoff:

- **Registration → `inventory`/`linkme` self-registration. YES, and this is the big one.**
  `generate_handler![]` exists only because Tauri's macro needs a compile-time list. A
  `#[personas::command]` wrapper macro that both applies `#[tauri::command]` *and*
  submits the handler into a `distributed_slice` would make "defined but unregistered"
  unrepresentable — deleting the entire 73-command deviation class permanently.
  **Convergence confirms this is the right shape, not a nicety:** `personas-web` gets
  the same property for free (a Next.js `route.ts` file *is* its route; there is no list
  to forget), and `personas-cloud`'s FastAPI facade gets it per-endpoint from decorators
  with only a 7-line manual router mount. The two-step is a **Tauri artefact, not
  physics** — so a checklist item is the wrong fix and a structural one is available.
- **`invokeWithTimeout`'s return type → a generated `CommandReturns` map. YES.**
  `cmd` is already typed `CommandName`; `T` is not tied to it at all, so
  `invoke<AnythingIWant>("do_thing")` compiles. Emitting
  `export interface CommandReturns { do_thing: MyResult; … }` from the same codegen that
  writes `CommandName`, and typing `invokeWithTimeout<K extends CommandName>(cmd: K): Promise<CommandReturns[K]>`,
  makes every one of §7 C's hand-written and fossilised response types a **compile
  error** instead of a lint. This subsumes the §9 census rule entirely and is the
  correct long-term fix; the rule is the ratchet until it lands.
- **Tier declaration → one struct instead of two arrays. YES, and a sibling already did it.**
  `personas-cloud`'s orchestrator stores `admin?: boolean` in the *same* `AuthRoute`
  struct literal as `path` and `handler` (`httpApi.ts:419-439`), so registration and
  privilege cannot drift apart. Personas keeps them in two independent lists and needs a
  test to reconcile them. Owned by `ipc-command-authorization.md`; recorded here because
  the convergence evidence for it surfaced in this sweep.

## 5. Anti-patterns

- **Returning `serde_json::Value`.** 104 commands. It is not a shortcut, it is a
  decision to make the wire contract un-generatable — and the cost lands on someone
  else, six months later, as a TypeScript type that the compiler believes and reality
  does not (§7 C). If the shape is genuinely dynamic, name the envelope and put the
  dynamic part in one field.
- **Adding a name to `commandNames.overrides.ts` to make `npm run check` pass.** That
  file's docstring calls its contents "planned commands or dead code". All **18**
  entries name commands that exist in **no** `.rs` file, and **8 of them are invoked
  from production code today** (§7 A2). The override list converts a hard compile error
  into a silent runtime failure and then certifies it green.
- **Writing the response type as a local `interface` in `src/api/**`.** 373
  `type`/`interface` declarations live in the wrapper layer; **187** are used directly
  as an IPC type argument, and **130 of them share a name with an existing generated
  binding file** — a hand-written duplicate of a type ts-rs is already maintaining.
- **Assuming `git diff --quiet src/lib/bindings/` protects you.** It does not see
  untracked files. Measured directly: create a new file there, `git diff --quiet` exits
  **0**. New types are exactly the case you are in when you add a command.
- **Running the repo's own documented regen command.**
  `.claude/CLAUDE.md:116` says `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`.
  Without `--workspace` that selects only `personas-desktop` and skips ~200 `#[ts(export)]`
  types in `personas-core`; without `--features desktop` the tauri build script aborts on
  a missing updater permission and **no binding is regenerated at all**. CI's own comment
  (`ci.yml:376-386`) documents both failures. Following the instruction produces a green
  local run that regenerated nothing.
- **Reaching for `safeInvoke` because the command "might not be ready".** It is for
  genuinely optional backends. Used to paper over an unregistered command it converts a
  loud `Command "x" not found` into an empty list, which reads as "no data" in the UI —
  the exact bug its own header documents at `safeInvoke.ts:21-35`.
- **Copying an existing `src/api` wrapper that already has the disease.** The 41 files
  with hand-declared response types are the most-copied files in the layer.
- **Calling `invokeWithTimeout` from a component.** The wrapper belongs in `src/api/`;
  components call the wrapper. Not enforced by anything, but it is what keeps the
  command-name literal in one place per command.
- **Deleting a Rust type without deleting its binding.** ts-rs writes files; it never
  removes them. **29 binding files name a type that appears nowhere in any `.rs` file,
  and 26 are still imported by application code.** Nothing catches this — see §7 C.
- **Passing an explicit timeout at one call site instead of registering it.** If a
  command needs 30 minutes it needs 30 minutes for *everyone*; that belongs in
  `BLOCKING_MUTATION_TIMEOUTS` (`tauriInvoke.ts:64`), which currently has 3 entries
  against 52 ad-hoc overrides.

## 6. Evidence

**Adoption is genuinely good and worth saying plainly.** 1,585 of 1,658 command
functions are registered; **0** registered names lack an implementation; **1,534
distinct commands are invoked from production frontend code**; **969 of 1,661 commands
(58.3%) already return a generated-binding type**; and the raw-`invoke` ban has
**exactly one** production violation, which is the wrapper itself. The `CommandName`
union means a mistyped command name is a compile error today. This is a well-built
surface with three specific holes.

- **`src-tauri/src/commands/credentials/crud.rs:33-44` + `src/api/vault/credentials.ts:1-24`
  — `create_credential`. Copy this pair.** Sync `pub fn`; `#[requires(privileged)]`
  directly under `#[tauri::command]`; `-> Result<PersonaCredential, AppError>` where both
  `PersonaCredential` and `CreateCredentialInput` are ts-rs-generated; listed in
  `PRIVILEGED_COMMANDS`; registered; and the frontend wrapper is one line that imports
  both bindings by path. Every layer agrees and nothing is hand-typed.
  *(Read the rest of that file with your eyes open: `:85,:89,:95` in the same wrapper
  type three `serde_json::Value` commands with three orphan bindings — the best file in
  the layer still carries four fossils.)*
- `src-tauri/src/lib.rs:3952-3978` — `every_network_command_is_registered_in_generate_handler`.
  The shape every registration gate should have: parse the source, assert the
  instrument (`declared.len() > 20`) *before* the result, and name the mechanism in the
  failure message. It is correct and it covers 1 of ~20 command directories.
- `src-tauri/src/lib.rs:3796-3816` — the `#[cfg]`-orphan guard's doc comment. The
  clearest statement in the repo of why registration is a real hazard: a stacked `#[cfg]`
  "removed 15 `commands::network::*` commands from `generate_handler!` and shipped —
  nothing in the compiler, clippy, or the test suite noticed, because the missing entry
  is a *deletion*, not an error."
- `.github/workflows/ci.yml:369-386` — the `binding-drift` step's comment. Two hard-won
  flags, each with the silent-no-op it prevents written down. This is the model for
  documenting a gate's preconditions.
- `src/lib/tauriInvoke.ts:305-333` — the timeout resolution ladder
  (`explicit ?? BLOCKING_MUTATION_TIMEOUTS[cmd] ?? DEFAULT_TIMEOUT_MS`). Three tiers,
  one line, and the per-command tier is the one to reach for.
- `src/lib/tauriInvoke.ts:129-132` — `InvokeTimeoutError`'s message, which tells the
  caller the backend was **not** cancelled and not to blindly retry a mutation. The one
  place in this surface where a failure mode is explained at the point of failure.
- `src-tauri/src/ipc_auth.rs:1155-1213` — `every_requires_annotation_is_listed_or_baselined`.
  **Verified passing today** by a faithful re-implementation run against the real tree:
  224 annotations found, 0 unlisted, 0 stale baseline entries; the sibling sync test
  checks 86 sites with 0 missing. Its `DRIFT_BASELINE` holds **23** entries, shrink-only
  in *both* directions (a resolved entry left behind also fails). Landed as
  `3a86b1501` "promote 28 annotated-but-unlisted commands to real enforcement" +
  `58d73f961`. This is the repo's best example of a baseline that cannot rot.
- `scripts/check-command-contract.mjs:140-142` — the `implementedButUnregisteredOverrides`
  assertion, which is the one direction of the override problem that *is* caught.

## 7. Deviations found

**Four categories, 236 individually-addressable items.** All ship green under
`npm run check`, `npm run check:contracts`, CI Job C, CI Job D, and
`scripts/check-unused-bindings.sh`.

### A. Registration — the surface has two holes, and both are certified green

**A1 — 73 commands are defined and never registered (4.4% of all commands).** They are
unreachable from any transport. By name prefix: **`dev_tools_*` 18**; other `dev_*` 4
(the whole of `commands/infrastructure/git_checkpoint.rs` — `dev_checkpoint_stage`,
`dev_fork_from_checkpoint`, `dev_list_run_checkpoints`, `dev_rollback_to_checkpoint`,
i.e. an entire feature); `companion_*` 6; `*composition_workflow*` 6 (a whole module,
allowlisted in `check-command-contract.mjs:116-125` as "dormant");
`commands/recipes/` 5; `commands/core/persona_jobs.rs` 4; `commands/ocr/mod.rs` 3;
`commands/credentials/openapi_autopilot.rs` 3.
**Not one of them is under `src/commands/network/`** — the only directory the existing
registration test covers. The gate covers exactly the region with zero defects.

**A2 — 8 command names are invoked from production frontend code and exist in no `.rs`
file at all.** Every one of them will reject with `Command "x" not found` the moment the
code path runs:

| Name | Frontend call site | Reachability |
|---|---|---|
| `gitlab_list_pipelines` | `src/api/system/gitlab.ts:94` | `GitLabPipelineViewer.tsx:43` on mount (and `:93` on refresh), via `useSystemStore.gitlabFetchPipelines`, rendered from `GitLabPanel.tsx:193` |
| `gitlab_get_pipeline` | `src/api/system/gitlab.ts:91` | same component, on select |
| `gitlab_trigger_pipeline` | `src/api/system/gitlab.ts:85` | same component, "Run pipeline" button |
| `gitlab_list_pipeline_jobs`, `gitlab_get_job_log` | `src/api/system/gitlab.ts` | same component |
| `zapier_list_zaps`, `zapier_create_zap`, `zapier_trigger_webhook` | `src/api/agents/automations.ts:80,…` | automations surface |

All 8 sit in `commandNames.overrides.ts`, whose 18 entries are **all** commands that
exist nowhere in Rust. `check-command-contract.mjs` is green because the override list
is exactly the escape hatch for this. The file's own docstring admits the state
("planned commands or dead code") and nothing ever forces a decision between the two.

**A3 — 62 registered commands are invoked from nowhere in `src/`; 54 never appear even
as a string literal.** Including `greet` (`lib.rs:504`) — the Tauri scaffold command
from project init, still registered — plus complete unused surfaces:
`bridge_manifest_*` (3), `connector_cli_probe_*` (2), `execute_desktop_bridge` /
`execute_desktop_plan` / `get_desktop_plan_result` / `get_desktop_runtime_status` /
`is_desktop_connector_approved` / `get_pending_desktop_capabilities` /
`revoke_desktop_approvals` / `discover_desktop_clis` (8 — the entire desktop-bridge
surface), `ocr_with_gemini` / `ocr_with_claude`, `get_exposure_manifest` /
`get_exposed_resource` / `update_exposed_resource` / `get_resource_provenance`.
This is dead IPC surface that still costs a `generate_handler!` line, a `CommandName`
member, and — for the privileged ones — an attack surface.

### B. Timeout discipline — one number governs 96.6% of the surface

- **1,550 production IPC call sites. 52 (3.4%) pass an explicit timeout.** The other
  1,498 take `DEFAULT_TIMEOUT_MS = 90_000`.
- **`BLOCKING_MUTATION_TIMEOUTS` has 3 entries** (`system_ops_run_now`,
  `remote_command_approve`, `project_tracking_run_now`) against 52 ad-hoc overrides —
  so the *reusable* mechanism is used 3 times and the *per-call-site* one 52 times,
  which is backwards. The 52 cluster in `src/api/devTools/kpis.ts` (8),
  `src/api/artist/index.ts` (7), `src/api/pipeline/teamDeliberations.ts` (5) — i.e. the
  long-running surfaces, discovered one call site at a time.
- **This is a deviation from the reusable mechanism, not from the default.** See §9 for
  why no gate is proposed on the 1,498: 90s is the correct answer for nearly all of them
  and a rule there would be ~97% false positives.

### C. The typed-contract hole — root cause, found on the second pass

This is upstream of most of §7 B and all of the frontend hand-typing. The chain is
mechanical and every link is measured:

1. **104 commands return `serde_json::Value`** (directly or wrapped in `Option`/`Vec`),
   across 40 files — `scraper_*` (8), `credential_design`/`negotiator`/`foraging`,
   `vault_status`, `migrate_plaintext_credentials`, `list_credential_fields`,
   `artist_export_composition`, `companion_wake_stats`, `dev_tools_*kpi*`.
2. ts-rs can generate nothing for a `Value`. So the frontend must supply the type.
3. **51 of the 55 production call sites that hit a `Value`-returning command give it a
   concrete TypeScript type anyway** — a claim about a payload no tool verifies.
4. **19 of those types are ORPHAN BINDINGS**: files in `src/lib/bindings/` whose type
   name appears in **no** `.rs` file anywhere. 29 such orphans exist; **26 are still
   imported by application code.**

| Command (returns `Value`) | Frontend types it as | Orphan binding at |
|---|---|---|
| `vault_status` (`credentials/crud.rs:427`) | `VaultStatus` | `src/lib/bindings/VaultStatus.ts` |
| `migrate_plaintext_credentials` (`crud.rs:447`) | `MigrationResult` | `.../MigrationResult.ts` |
| `list_credential_fields` (`crud.rs:460`) | `CredentialFieldMeta[]` | `.../CredentialFieldMeta.ts` |
| `start_credential_design` (`credential_design.rs:44`) | `DesignStartResult` | `.../DesignStartResult.ts` |
| `test_credential_design_healthcheck` (`:126`) | `CredentialDesignHealthcheckResult` | `.../CredentialDesignHealthcheckResult.ts` |
| `start_credential_negotiation` (`negotiator.rs:44`) | `NegotiationStartResult` | `.../NegotiationStartResult.ts` |
| `validate_db_schema`, `get_schema_proposal_snapshot` | `SchemaValidationResult`, `SchemaProposalSnapshot` | `.../*.ts` |
| `import_foraged_credential` (`foraging.rs:716`) | `ForageImportResult` | `.../ForageImportResult.ts` |
| `start_google_credential_oauth` | `GoogleCredentialOAuthStartResult` | `.../*.ts` |

**Why all three gates report green on this, each for a different reason:**

- **CI Job D (`git diff --quiet src/lib/bindings/`)** — ts-rs *writes* files and never
  *deletes* them. When the Rust struct was removed (or the return changed to `Value`),
  nothing rewrote the `.ts`, so there is no diff. Green.
- **`scripts/check-unused-bindings.sh`** (CI, `ci.yml:177`) — asks "is this binding
  referenced by app code?" These are all referenced. It runs in exactly the wrong
  direction: it protects against unused generated types, not against **used ungenerated
  ones**. Green, and it is the check most likely to be mistaken for covering this.
- **`tsc --noEmit`** — the `.ts` file is syntactically valid and the type is real. It
  has simply stopped describing anything the backend sends. Green forever.

**Downstream, the same hole shows as hand-written contracts:** 373 `type`/`interface`
declarations across the 130 `src/api/**` files; **187** used directly as an IPC type
argument; **130 share a name with a generated binding file** (e.g.
`src/api/devTools/crewFoundry.ts` re-declares `CrewFitnessReport` and
`CrewFitnessPersona`, both of which exist under `src/lib/bindings/`).

### D. Instructions and barrels that have quietly stopped working

| Path | What's wrong |
|---|---|
| `.claude/CLAUDE.md:116` (and `:67`) | Prescribes `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`. Missing `--workspace` (skips ~200 `personas-core` types) **and** `--features desktop` (build script aborts; **zero** bindings regenerate). CI documents both at `ci.yml:376-386`. The repo's own onboarding step is the broken command. |
| `src/lib/bindings/index.ts:2` | The regeneration instruction is a shell one-liner in a comment. Nothing runs it. **86 of 1,032 binding files are absent from the barrel**, so `import { X } from '@/lib/bindings'` fails for them with no explanation. **CORRECTED 2026-08-14: the barrel has ZERO importers.** All 853 consumers use direct paths (`@/lib/bindings/Foo`), verified by grep; `knip.json:18` excludes the directory from dead-code analysis, which is why nobody noticed. So the missing entries break nothing, and "regenerate the barrel" is backlog for a 950-line artefact no code reads. The fix is `git rm`, not a generator. Kept visible because two paths independently filed the same non-problem. |
| `scripts/generate-command-names.mjs:21` | Matches `/invoke_handler\(tauri::generate_handler!\[/` against a source line that reads `wrap_invoke_handler(tauri::generate_handler![`. **It matches by accident** — because `"wrap_invoke_handler("` happens to end in `"invoke_handler("`. Renaming the wrapper makes the codegen exit 1 loudly; inserting *any* other call between them makes it match a different block silently. `check-command-contract.mjs:41` matches the full, correct shape; the two parsers disagree. |
| `scripts/check-unused-bindings.sh` | Runs in CI with `if: always()`, walks 1,032 files with a `grep -r` per file. Measured ~2+ minutes locally. Correct, slow, and pointed the wrong way (see C). |
| `src/lib/bindings/SkillEntry.ts` | Uncommitted modification present in the working tree at the time of this sweep — i.e. a binding regenerated and not committed, which is the exact state Job D was built to catch and the one shape it can see. Left untouched: another session's in-flight work. |

## 8. Gaps in the primitive

1. **`#[tauri::command]` cannot register the command.** A proc-macro attribute sees one
   function and cannot append to a macro invocation in another module. This is the root
   cause of A1 and of the `#[cfg]`-orphan incident, and it is **not** a law of nature —
   §4's `inventory`/`linkme` note and the `personas-web` convergence result both show
   the property is obtainable. It is the single highest-leverage structural fix in this
   leaf.
2. **`git diff` cannot see an untracked file, so no diff-based gate can guard *new*
   artefacts.** Both CI Job C and Job D use `git diff --quiet`. Job C is safe by luck —
   the generated file it watches is always modified in place. Job D is not. The fix is
   one word: `git status --porcelain src/lib/bindings/` (or
   `git add -A --intent-to-add` before the diff).
3. **ts-rs has no reverse mapping and no delete.** Nothing knows which `.ts` files the
   last export run produced, so nothing can notice that a file stopped being produced.
   The primitive would need to emit a manifest; until it does, orphan detection has to
   be a separate walk (§9 mechanism 3).
4. **`invokeWithTimeout`'s `T` is unconstrained by `cmd`.** The command name is typed;
   the payload is not. Every deviation in §7 C exists in this gap. Closing it is
   codegen work in a script that already parses everything it needs.
5. **`commandNames.overrides.ts` has no expiry and no reason field.** An entry cannot
   distinguish "planned, ticket #123" from "dead since 2025". Both look identical to
   every checker, so the list can only grow.
6. **`safeInvoke` cannot tell "not implemented yet" from "not registered by mistake".**
   Both are `Command "x" not found`. Its strict regex correctly separates that from a
   domain 404 — but not from the failure this path is about.
7. **`BLOCKING_MUTATION_TIMEOUTS` is keyed by command name and lives on the frontend.**
   The backend knows which commands are long-running; the frontend guesses. A
   `#[long_running]` attribute feeding the codegen would put the number where the
   knowledge is.
8. **No command-level cancellation.** `InvokeTimeoutError`'s own message says the
   backend "was NOT cancelled and may still be running to completion". A timeout is a
   *caller-side abandonment*, not a cancel — which is why the correct default is
   generous rather than tight, and why per-command tuning matters more than it looks.

## 9. The missing gate

Registration, binding freshness, and command-name drift are all gated today, and each
gate has a precisely-bounded blind spot: registration is checked for **1 of ~20**
command directories; binding drift is checked for **modified** files only; the override
list converts a caught error into a certified one. Four mechanisms, cheapest first —
and then two refusals.

### 1. Generalise the registration test from `network/` to all of `src/commands/` (Rust, ~30 lines)

`lib.rs:3952` already does exactly this for one directory. Widen `declared_network_commands()`
to walk all of `src/commands/`, resolve each `#[tauri::command]` to its `fn` name, and
assert membership in `generate_handler_body()`. Seed a `NOT_REGISTERED_BASELINE:
&[(&str, &str)]` with today's **73**, each carrying a written reason, **shrink-only in
both directions** — copy `DRIFT_BASELINE`'s stale-entry check at `ipc_auth.rs:1196-1212`,
which is the part most baselines omit and the part that stops one from rotting into a
blanket pass. Fail-loud preconditions, all of which the existing test already models:
`assert!(declared.len() > 1_400)` (real: 1,658) and `assert!(registered.len() > 1_400)`
(real: 1,585) — **separate counters**, because a single combined one lets one walk break
while the other carries the assertion.

### 2. Make CI Job D see new files (one line, `ci.yml:389-395`)

Replace `git diff --quiet src/lib/bindings/` with a check that also fails on untracked
content — `git status --porcelain src/lib/bindings/` must be empty. Verified failure
today: with a new file present, `git diff --quiet` exits **0**. Add, in the same step,
`test "$(ls src/lib/bindings/*.ts | wc -l)" -gt 900` so a regeneration that produced
nothing (the `--features desktop` failure the comment at `:381-386` describes) cannot
read as "no drift".

### 3. Orphan- and barrel-check for `src/lib/bindings/` (node, ~40 lines, wired into `npm run check`)

Three assertions, one walk:
(a) every `src/lib/bindings/*.ts` name appears somewhere in `src-tauri/**/*.rs` — catches
the **29** orphans, **26** of which are actively imported;
(b) every binding file is exported from `index.ts` — catches the **86** missing from the
barrel;
(c) **self-check:** the walk must see > 900 binding files and > 900 `.rs` files, or exit
1 with "the walk broke, the tree did not shrink".
Fold `check-unused-bindings.sh` into it while you are there — same walk, opposite
direction, and one pass instead of 1,032 recursive greps.

### 4. Census rule — `untyped-command-payload`

**The condition (stack-free):** *an operation's success payload is declared as an
untyped document rather than a named type, so the type generator has nothing to
generate and the caller must author the contract by hand.*

**The proxy in this repo:** a `#[tauri::command]` whose return type is
`Result<serde_json::Value, …>`. **PRECONDITION, and an adopting repo must re-derive its
own:** this proxy works because Personas expresses the untyped case with one specific
Rust type spelled two ways (`serde_json::Value`, or bare `Value` under a `use`), and
because ts-rs keys on named types. A repo whose untyped escape hatch is
`Box<dyn erased_serde::Serialize>`, `any`, `Record<string, unknown>`, or an
un-schema'd JSON response scores **zero** here while the condition is present at full
scale — the exact failure the portability test measured for `tables.md`.

```json
{
  "rules": [
    {
      "id": "untyped-command-payload",
      "goldenPath": "docs/concepts/golden-paths/new-ipc-command.md",
      "title": "IPC command whose success payload is serde_json::Value, so ts-rs can generate no binding for it",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "#\\[tauri::command[^{]{0,900}?->\\s*Result<\\s*(?:Option<\\s*|Vec<\\s*)*(?:serde_json::)?Value\\b",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a #[tauri::command] whose success type is serde_json::Value, directly or wrapped in Option/Vec. PROXY FOR the stack-free condition \"an operation's success payload is an untyped document, so the type generator emits nothing and the caller hand-authors the contract\". The [^{]{0,900} span cannot cross a function body, so the attribute and the return arrow are guaranteed to belong to the same signature. Measured consequence in this repo: 104 such commands; 55 production call sites in src/api/** hit them; 51 of those declare a concrete TypeScript type anyway; and 19 of those types are ORPHAN bindings whose Rust source no longer exists (src/lib/bindings/VaultStatus.ts, MigrationResult.ts, DesignStartResult.ts, ...). CI's binding-drift job cannot see them (ts-rs never deletes a file, so there is no diff) and check-unused-bindings.sh cannot see them (it asks whether a binding is USED, not whether it is still GENERATED). PRECONDITION: this repo spells its untyped escape hatch serde_json::Value; a repo using Box<dyn Serialize>, an un-schema'd JSON response, or `any` has the same condition wearing different markup and must re-derive the proxy. Legal destination: a named struct or enum carrying #[derive(TS)] #[ts(export)], imported on the frontend from @/lib/bindings/<Name>."
      },
      "baseline": { "files": 40, "matches": 104 },
      "floor": 500
    }
  ]
}
```

**Counts verified through two independent implementations before baselining**, as the
contract requires: an AST-ish signature parser (walk each `#[tauri::command]`, resolve
the following `fn`, extract the return type between `->` and `{`) and the census regex
both return **104 matches across 40 files**, walking **564** files. The parser
additionally found 12 near-misses that the regex correctly excludes
(`get_value_rollup -> Result<ValueRollup, …>` is not a `Value`;
`Result<HashMap<String, Value>, …>` shapes are a different, weaker condition).
No `exclude` entries: there is no primitive file that must legitimately contain this
shape, and an exclude that exists only for symmetry is a stale exemption waiting to
happen.

**Fault injection against the real tree** (`npm run census -- --check --rules <file>`):

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK untyped-command-payload 40/40 104/104 walked 564 floor 500` — surviving counts printed, so a build log can tell a clean run from an empty one |
| matcher matches nothing (`Result<NoSuchTypeXYZ`) | **1** | `[structural] matched zero files anywhere…` **plus** two `[drift] dropped` problems |
| floor above walk (`floor: 5000`) | **1** | `[structural] walked 564 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` narrowed to one subdir) | **1** | `[structural] walked 69 … floor is 500` + `[drift] files dropped 40 → 16`, `matches dropped 104 → 46` |
| count rises (baseline lowered to 39/100) | **1** | `[drift] files rose 39 → 40 (+1)`, `matches rose 100 → 104 (+4)` |
| renamed root (`src-tauri/srcc`) | **1** | `walked 0 files but floor is 500` + `matched zero files anywhere` + both drops |
| stale `exclude` (path that matches nothing) | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |

All seven behave as the contract requires. The validation ran from a scratchpad file
named `census-new-ipc-7fa31c.json` — unique to this composition, because a previous
composer's validation silently ran a *different* agent's rule from a generically-named
file.

### What is deliberately left ungated, and why

- **Timeout discipline. Refused.** 1,498 of 1,550 call sites take the 90s default and
  **that is the correct answer for nearly all of them** — they are sub-second reads.
  A rule flagging "no explicit timeout" would be ~97% false positives; a rule flagging
  the 52 *overrides* would flag the code that got it right. The real defect is narrower
  and not countable by regex: a long-running command whose timeout is set at one call
  site instead of in `BLOCKING_MUTATION_TIMEOUTS` (52 vs 3). That is a code-review
  observation, and §4 step 9 is where it belongs.
- **Raw `invoke` usage. Refused — already at zero.** `no-restricted-imports` is
  `"error"`-level and works: one production site, inside the wrapper. A census rule
  pinned at 0 is a gate that can never fail, and the runner rejects it by design.
- **Hand-written response types in `src/api/**`. Refused as a census rule.** The
  condition is real (187 sites) but no single-file regex expresses it honestly. The
  natural signal — "a `type`/`interface` declared in `src/api/**`" — measures 373 with
  **50.1% precision** for the strict form; a back-reference variant
  (`(?:interface|type)\s+(\w+)[\s\S]{0,6000}?invoke\w*<\s*\1`) was built and run and
  captures only **72 of 187** because the lazy span consumes intervening declarations.
  A gate that can miss two-thirds of new violations is worse than none. The correct fix
  is the `CommandReturns` type in §4, which makes all 187 compile errors.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. Not because warnings drown in a large baseline — the baseline is
**1,135**, not the "~10,086" this repo cited for a year. The count-independent argument
is the only one that holds: `npm run check` runs `eslint src/` with **no
`--max-warnings`**, and the pre-commit hook runs `--quiet --max-warnings 99999`, where
`--quiet` discards warnings before they can be counted. **A warn-level rule enforces
nothing at either gate, at any count.** It changes authoring behaviour through editor
squiggles, which is worth something — but it is not a gate and must never be described
as one.

## Convergence — what travels, and one result that inverts the brief

Checked against `../brainiac` (Rust/Postgres, MCP tool surface + utoipa REST),
`../personas-cloud` (FastAPI facade over a Node orchestrator), `../personas-web`
(Next.js App Router). Reported honestly, including where it contradicts this document.

**Physics — independently reinvented, so these clauses travel:**

- **Registration-list drift.** `brainiac` reinvents it *four times over*: the same 18
  MCP tool names are hand-typed in `tool_definitions()` (`mcp.rs:456-700`), the
  `call_tool` dispatch match (`:725-744`), the `tool_scope()` auth match (`:232-250`),
  and a test assertion — with the file's own comment admitting they "MUST agree".
  `personas-cloud`'s orchestrator has the same single-array shape
  (`httpApi.ts:494`, 59 `handler:` entries; not in the array = unreachable).
- **Hand-typed wire names with no compile-time check.** 99 tool-name literals in
  `brainiac`'s tests; `personas-cloud` duplicates path strings across Python and
  TypeScript with no shared constant; `personas-web` has 4 raw `fetch("/api/…")`
  literals. Nobody derives the name. Personas' `CommandName` union is ahead of all three.
- **A caller-side timeout wrapper that exists but is not enforced.** The strongest
  signal, because the *same specific failure mode* recurs: `brainiac` has a real
  chokepoint (`console/src/lib/api.ts:83-133`, 15s default) **and a second, timeout-free
  client sitting beside it** (`governance-api.ts:10-39`); `personas-cloud`'s
  orchestrator has 3 outbound `fetch()` calls with no timeout at all;
  `personas-web` wraps 1 of 4. Every repo built the wrapper; none enforced it.

**Structurally avoided elsewhere — this INVERTS part of the brief's framing:**

- **`personas-web` cannot have an unregistered route.** The filesystem *is* the registry;
  a `route.ts` file is reachable the moment it exists. There is no analogue to
  Personas' 73 orphaned commands because there is no list to forget.
  `personas-cloud`'s FastAPI facade gets the same property per-endpoint from decorators,
  leaving only a 7-line "which routers are mounted" step.
  **So "remember to register it" is a Tauri artefact, not physics.** The brief framed
  registration as a step of the procedure to be remembered harder; the honest conclusion
  is that the step should be *deleted* by a self-registering macro (§4), and the §9
  registration test is the ratchet until it is — not the destination.
- **`personas-cloud` cannot drift its auth flag away from its route**, because
  `admin?: boolean` lives in the same struct literal as `path` and `handler`
  (`httpApi.ts:419-439`). Personas' two independent lists need a test to stay in sync.
- **`brainiac`'s MCP tool dispatch fails *closed*** — `_ => "admin"` (`mcp.rs:248`),
  with the comment "so a future tool cannot slip in ungated by accident". Personas'
  `PRIVILEGED_COMMANDS` fails *open*: absence means Public. Directly adoptable.

**Local calibration — no trace anywhere else, and Personas is ahead:**

- **ts-rs + a CI job that regenerates and diffs.** `brainiac` has the closest analogue
  (utoipa → `openapi-typescript` via `gen:api`) but **no CI drift step**, so a stale
  committed client passes. `personas-cloud` hand-mirrors Pydantic models from
  TypeScript and says so in a comment (`facade/models.py:1-4`) — and has **no CI at
  all**. `personas-web` has no schema layer whatsoever. Personas' CI-enforced generation
  gate is the most mature instance of this pattern in the fleet, which is precisely why
  the two blind spots in §7 C and §9 mechanism 2 matter: it is the gate everyone here
  trusts most.
- **A lint rule banning the raw primitive.** No sibling has one. Every other repo's
  wrapper convention has a visible, unenforced escape hatch. Keep it, and keep it at
  `"error"`.
