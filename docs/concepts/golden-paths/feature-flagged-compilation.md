# Golden path — Feature-flagged compilation

> Situation node: `platform-delivery/build-profiles/feature-flagged-compilation` · [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: true` · recurrence **670** · risk **medium**.
> Dimensions: **function · performance · cost · resilience**.
> Composed 2026-08-14 against `master` @ `2a874e692` from a ground-truth sweep of all
> **963** `.rs` files under `src-tauri/` (**525,405** LOC), the `generate_handler![]`
> registration list, all **7** GitHub workflows plus `.gitlab-ci.yml`, `lefthook.yml`,
> every `package.json` script, the three `tauri.*.conf.json` files, and the frontend
> tier layer. Every number was produced by parsing the real source; where two
> implementations disagreed the disagreement is reported (§7 A1 is a live bug found
> exactly that way). **No cargo command was run** — the PreToolUse guard blocks
> concurrent cargo, and claims that would need a compile are marked unverified.
> `src-tauri/target/**` and `.claude/worktrees/**` excluded from all counts.
> The **Deviations** section is a fix backlog.

> ### ⚠ Two corrections to the brief that commissioned this path
>
> 1. **"`cargo clippy` in CI lacked `--features desktop`, fixed this wave" — verified fixed
>    in `ci.yml`, but the fix did not travel.** `ci.yml:275` and `:283` now carry
>    `--workspace --features desktop`, and `:387` too. **`.gitlab-ci.yml:76` and `:96`
>    still carry neither**, and `:165` still wraps the binding regen in
>    `2>/dev/null || true` — the exact swallow `ci.yml:371-373` says it removed. That
>    file is dormant (the only git remote is GitHub), but it is a complete,
>    authoritative-looking second CI definition whose `summary` job at `:183-190`
>    prints `Rust lint (clippy) ✓` unconditionally. See §7 B.
> 2. **"`#[allow(dead_code)]` interacts with feature gating" — mostly FALSE here.**
>    210 `#[allow/expect(dead_code)]` sites exist across 103 files; **8 (3.8%)** sit
>    within three lines of any `cfg(`. Dead-code silencing in this repo is
>    overwhelmingly *not* a feature-gating artefact. The `ProcessContext` class of
>    defect is real (§7 E) but it is a different disease and should not be filed here.

## 1. Trigger

- "Why does this compile for me and not in CI?" / "works in `tauri:dev` but not `tauri:dev:lite`"
- "`Command "get_local_identity" not found`" — but the command is right there in `lib.rs`
- "Should this be behind a cargo feature, or just always compiled?"
- "Do I need `--features desktop` for that?" / "why did `cargo test` exit before running anything?"
- "Does the starter build actually not contain the team code?"
- "This module only exists in `desktop-full` — how do callers find out?"

If you are about to type `#[cfg(feature = "…")]`, a new line in
`src-tauri/Cargo.toml`'s `[features]`, a `#[cfg]` inside `tauri::generate_handler![]`,
`import.meta.env.VITE_APP_TIER`, `tier.isVisible(`, a `build.features` entry in a
`tauri.*.conf.json`, or any `cargo`/`tauri` invocation in a workflow or npm script —
you are in this situation.

### Scope — the four axes, and which one owns which decision

| Axis | Selector | Owned here |
|---|---|---|
| Cargo features | `desktop` · `ml` · `p2p` · `scraper` · `ollama` · `test-automation` · `daemon` · `mobile` | **yes** |
| Frontend tier | `VITE_APP_TIER` → `starter`/`team`/`builder` | **yes** |
| Build invocation | what `--features` / `--workspace` each cargo call carries | **yes** — an invocation that compiles a smaller tree than it claims is this leaf's core defect |
| Dev-vs-release | `cfg!(debug_assertions)` · `import.meta.env.DEV` | only where it decides an entry point's *existence* (3 commands, §7 A2) |

Adjacent and deliberately not covered: **`tauri-config-variants`** (recurrence 4) owns
the three `tauri.*.conf.json` overlays as documents;
**`environment-variable-configuration`** (40) owns runtime env reading;
**`compile-time-env-embedding`** (9) owns `import.meta.env` *value* inlining.
[`new-ipc-command.md`](./new-ipc-command.md) owns adding a command; this path owns
what happens when that command only exists in some builds.

## 2. The one way

**Never let a build switch decide whether an entry point *exists*. Let it decide only
what the entry point *does*.** Compile the `#[tauri::command]` function and its
`generate_handler![]` registration unconditionally; put the `#[cfg(feature = "x")]`
*inside the function body* (or define the whole function twice, once per cfg state —
`src/commands/obsidian_brain/graph.rs:704-841`), and give the
`#[cfg(not(feature = "x"))]` branch a typed capability error rather than a missing
symbol — the shape at `src/commands/infrastructure/scraper.rs:17-40`, whose own header
states the rule:
*"All commands are always compiled; when the `scraper` cargo feature is off they
return a friendly 'not enabled' error instead of touching the (absent) engine
module."* Gate the heavy **implementation** module (`engine/src/p2p/`,
`src/engine/kb_ingest.rs`) all you like — that is what the feature is for, and it is
what buys the compile time — but keep the *surface* constant, because the surface is
what the frontend's generated `CommandName` type promises and what
`scripts/generate-command-names.mjs` will emit whether you gated it or not. Declare a
new feature only when it removes a **dependency** from the graph (`ml` removes
ort/fastembed; `p2p` removes quinn/mdns-sd); a feature that only hides your own code
buys nothing and costs a build variant nobody compiles. Then make the variant
*compilable*: every cargo invocation you add — workflow step, npm script, error-hint
string, guard advice — carries `--workspace --features desktop` at minimum, because
`capabilities/default.json:19` names `updater:default` and `tauri-plugin-updater` is
optional under `desktop`, so **any** cargo command without it aborts in the tauri
build script before compiling a line (`ci.yml:262-267`). On the frontend, a tier is a
**visibility** decision and nothing else: say so, and do not claim tree-shaking you
have not implemented — `sectionRouter.tsx:59-70` mounts all ten lazy section
primaries unconditionally, so every tier bundle contains every section today.

## 3. Mandated primitives

**Backend**

- **`src/commands/infrastructure/scraper.rs:17-40` — the capability-stub shape.**
  `const NOT_ENABLED` + `fn not_enabled() -> AppError` under `#[cfg(not(feature))]`,
  then per command a `#[cfg(feature)] { … }` / `#[cfg(not(feature))] { let _ = state;
  Err(not_enabled()) }` pair. **9 commands.** This is the one to copy.
- **`src/commands/companion/consolidate.rs:194-209`** — the same shape where the
  off-branch is a *degraded implementation* rather than an error (the non-`ml` branch
  at `:205-208` still applies the item, just without embeddings). Prefer this over the
  error branch whenever a correct-but-simpler answer exists.
- **`src/commands/obsidian_brain/graph.rs:704-841` — the paired-definition shape.** The
  same `#[tauri::command] pub fn` name is defined twice: the real implementation under
  `#[cfg(feature = "desktop")]` (`:704`, `:814`) and a stub under
  `#[cfg(not(feature = "desktop"))]` (`:826`, `:837`) — one returning
  `AppError::Validation("File watcher requires the desktop feature build")`, the other
  returning `Ok(())` because stopping a watcher that cannot exist is a no-op. **The
  registration at `lib.rs:2840-2841` is ungated**, which is the whole point. Use this
  instead of body-gating when the two implementations share no code. Only 3 commands
  in the repo do this.
- **`src-tauri/Cargo.toml:34-91` — the `[features]` table.** 8 declared. `desktop`
  (`:39-55`) forwards `personas-core/desktop`, `personas-db/desktop`,
  `personas-engine/desktop` — **that forwarding is the whole reason a bare
  `cargo test -p personas-db` gives you the mobile keychain stub** (`Cargo.toml:40-42`,
  `run-rust-tests.mjs:172-178`).
- **`src-tauri/capabilities/default.json:19`** — `updater:default`. The single line that
  makes `--features desktop` mandatory for every cargo command in this package.
- **`src-tauri/src/lib.rs:3916` — `generate_handler_has_no_orphaned_cfg_attributes`.**
  The existing structural guard, and the right model: it *parses the source text*, with
  the doc comment (`:3796-3816`) explaining why — *"not the macro expansion, which is
  feature-gated and therefore can't be reflected on in a lite build."* Its blind spot
  is §7 A1.
- **`scripts/check-tauri-configs.mjs:90-101`** — asserts every `build.features` entry in
  the three configs exists in `Cargo.toml [features]`. Wired into `npm run check` and
  CI. The only feature gate in the repo that actually runs on every change.
- **`scripts/build/run-rust-tests.mjs:179-185`** — the local test lanes, and the only
  place that spells the package-qualified form
  `personas-core/desktop,personas-db/desktop,personas-engine/desktop`.

**Frontend**

- **`src/lib/constants/uiModes.ts:40-41` — `BUILD_MAX_TIER`.** `import.meta.env.VITE_APP_TIER ?? TIERS.BUILDER`. Vite substitutes the literal at build time; everything downstream of it is a runtime function call.
- **`src/lib/navigation/registry.ts:154-158` — `passesGates(gates, ctx)`.** The ONE place tier + dev gating is decided. Sidebar, content router, command palette and footer nav all route through it.
- **`src/features/personas/sectionRouter.tsx:110-112` — `isSectionGated`.** The content router's fail-to-Home branch, so a gated section never briefly mounts.
- **`src/test/automation/bridge.ts:318-320`** — the test harness refuses a `navigate` to a section above `BUILD_MAX_TIER` and says so. The only place the tier gate produces an explanation instead of an absence.

**Nothing else is a primitive.** There is no capability-probe command, no
`AppError::FeatureUnavailable`, no `cfg!(feature = …)` runtime check anywhere in
963 files (49 `cfg!()` uses exist; **zero** test a feature), and no build-variant
awareness on the frontend at all.

## 4. Steps

1. **Ask whether you need a feature.** The only justification is *dependency removal*.
   `ml` removes ort + fastembed + sqlite-vec + pdf-extract; `p2p` removes quinn +
   mdns-sd + rcgen + ed25519-dalek. That is worth a variant. Gating your own code
   without dropping a dependency buys nothing and adds a build nobody compiles —
   `scraper` (34 cfg sites) and `ollama` (1) are enabled by **zero invocation anywhere
   in this repo**, CI included.
2. **Gate the implementation module, at its `mod` declaration.** 55 module
   declarations already do this (`engine/src/lib.rs:95,111,118,122,142`;
   `src/commands/mod.rs:18,21`). This is the cheap, honest half — one attribute, whole
   file out of the graph.
3. **Do NOT gate the registration.** Register the command unconditionally, then choose
   one of two shapes for the body. If the two implementations share code, body-gate
   (below). If they share none, define the `#[tauri::command] pub fn` **twice** — once
   under `#[cfg(feature = "x")]`, once under `#[cfg(not(feature = "x"))]` — the shape at
   `src/commands/obsidian_brain/graph.rs:704-841`. Either way the registration line
   stays bare. Body-gating:
   ```rust
   #[cfg(not(feature = "p2p"))]
   const NOT_ENABLED: &str = "Peer-to-peer is not enabled in this build.";
   #[cfg(not(feature = "p2p"))]
   fn not_enabled() -> AppError { AppError::Internal(NOT_ENABLED.to_string()) }

   #[tauri::command]
   pub fn get_local_identity(state: State<'_, Arc<AppState>>) -> Result<Identity, AppError> {
       #[cfg(feature = "p2p")]
       { crate::engine::identity::local(&state.db) }
       #[cfg(not(feature = "p2p"))]
       { let _ = state; Err(not_enabled()) }
   }
   ```
   The return type must be identical in both branches, which is the point: the ts-rs
   binding, the `CommandName` member and the frontend wrapper stay true in every build.
4. **If you gate the registration anyway, you owe three things**, and this is the step
   everyone skips: (a) a `safeInvoke` fallback at *every* frontend call site — there
   are currently **97 unguarded ones and 0 guarded**; (b) a way for the UI to know the
   capability is absent *before* it renders a control for it — there is no such
   mechanism today; (c) a note in the registration comment naming the feature, because
   `generate_handler_has_no_orphaned_cfg_attributes` cannot tell a deliberate gate from
   an orphaned one.
5. **Wire the variant into something that compiles it.** A feature nothing builds is
   not a feature, it is a syntax-checked comment. Today `ml` and `p2p` compile only in
   `release.yml` (workflow_dispatch / PR-closed) and `installer-test.yml` (manual) —
   **never in `ci.yml`**. Before you add a feature, name the invocation that will build
   it on every change, or accept that it rots.
6. **Every cargo invocation you write carries `--workspace --features desktop`.**
   Workflow steps, npm scripts, `console.error` hints, guard messages, docs. Without
   `--features desktop` the build script aborts on `updater:default`; without
   `--workspace` you select only `personas-desktop` and skip ~770 `personas-db` tests.
   `ci.yml:262-274` documents both; four other invocations in the repo do not comply
   (§7 B).
7. **Frontend tier: gate visibility, and say only that.** Add `gates: { minTier }` to
   the `NAV_SECTIONS` entry (`registry.ts:74-95`) or `minTier` to the `sidebarData`
   item; every surface derives from `passesGates`. Do **not** write that this
   tree-shakes — it does not, because `SECTION_ROUTES` (`sectionRouter.tsx:59-70`)
   holds all ten lazy imports in one unconditional object literal.
8. **Stop.** No `cfg!(feature = …)` (zero exist; the pattern documented at
   `engine/src/prompt/README.md:45` is not in the code). No new `#[cfg]` inside
   `generate_handler![]`. No tier→cargo-feature coupling (there is none, by design —
   see §7 C1). No new `[features]` entry without step 5's answer.

### Can the primitive make the wrong call impossible? — answered

The contract asks this before §9. Three answers, and **convergence settles the first
one** (§Convergence): both sibling repos independently reinvented "the callee always
exists; absence is a typed refusal", and in both the *type* is what forces it.

- **The command surface should be a type, not a list. YES — and this is the big one.**
  `personas-cloud` gets it from `KafkaClient` (`kafka.ts:310-325`: `createNoopKafkaClient`
  must implement every method, so a no-Kafka build cannot be missing one).
  `personas-web` gets it from `export const supabaseApi: ApiClient`
  (`supabaseApi.ts:313`), where `readOnly(): never` (`:51-53`) throws
  `ApiError(501, "Cloud-sync mode is read-only")` for the 8 methods that exist-but-refuse
  — **TypeScript forces every variant to implement the full surface.** Personas has no
  such type: `generate_handler![]` is a bare list, so a `#[cfg]`-shaped hole in it is
  legal Rust. A generated trait (one method per command, implemented once per variant)
  or a `#[personas::command]` macro that self-registers into a `distributed_slice`
  would make all 128 gated registrations unrepresentable.
- **`invokeWithTimeout` should not accept a build-conditional command name. YES, cheap.**
  Split the codegen output: `CommandName` for the 1,457 unconditional commands,
  `ConditionalCommandName` for the 128 gated ones, and make `invokeWithTimeout` reject
  the latter — force those through a new `invokeOptional<T>(cmd, args, fallback)`.
  Every one of §7 A3's 97 sites becomes a **compile error** instead of a runtime
  `Command "x" not found`. `scripts/generate-command-names.mjs` already parses the
  attribute line it currently discards (`:33`), so the data is in hand.
- **`AppError` needs a `FeatureUnavailable { feature, capability }` variant. YES.**
  Today the off-branch returns `AppError::Internal` with a hand-written English string
  (`scraper.rs:18,:24`), so the frontend cannot distinguish "this build lacks it" from a
  crash, and there is no `error_registry` key and no translation. A typed variant with a
  ts-rs binding gives the UI something to render and gives step 4(b) its mechanism.

## 5. Anti-patterns

- **Putting `#[cfg]` on the `generate_handler![]` line.** 128 sites. It removes the
  command from the IPC surface without removing it from anything the frontend can see:
  the `CommandName` union still lists all 128 (`generate-command-names.mjs:33` skips
  the attribute line and keeps the entry), `tsc` is happy, `check-command-contract.mjs`
  is happy, CI Job C is happy, and the call rejects at runtime.
- **Believing an orphaned `#[cfg]` will be caught.** `generate_handler_has_no_orphaned_cfg_attributes`
  only fires when the next non-comment line is *another* `#[cfg(`. A `#[cfg]` followed
  by a comment and then an unrelated command is invisible to it — and there is one in
  the tree right now (§7 A1).
- **`cargo <anything> --manifest-path src-tauri/Cargo.toml` without `--features desktop`.**
  It does not compile a smaller tree; it compiles **nothing** and exits before the first
  crate. A step that "passed in 4 seconds" checked zero lines.
- **`cargo test -p personas-db` (or any bare `-p` run).** The `desktop` feature is
  forwarded from the root package, so a bare `-p` run compiles `personas-core`'s mobile
  keychain stub and ten crypto tests fail with "Keychain not available on this
  platform" — a configuration artefact read as a defect.
  `scripts/build/guard-concurrent-cargo.mjs:123` recommends exactly this command.
- **Declaring a feature and never building it.** `scraper` and `ollama` are compiled by
  no invocation in the repo. Their `Cargo.toml` comments say "build with
  `cargo build --features scraper`" — which, without `--features desktop`, aborts.
- **`2>/dev/null || true` on a codegen step whose output a later step diffs.**
  `.gitlab-ci.yml:165-173`: the regen is silenced and allowed to fail, then
  `git diff --quiet src/lib/bindings/` reports clean *because nothing regenerated*. The
  gate is green precisely when the compiler is broken.
- **Writing "tree-shake" in a comment about a runtime gate.** Three places claim tier
  builds tree-shake (`uiModes.ts:22`, `ci.yml:148-149`, `build.md:28`) and none of them
  do. `useTier()` returns an object of closures; `SECTION_ROUTES` is keyed dynamically.
  Rollup cannot drop any of it.
- **Assuming a tier bundle is a security boundary.** The Rust backend is byte-identical
  across tiers — `build:starter/team/builder` set only `VITE_APP_TIER` and touch no
  tauri config and no cargo feature — and `tauri.conf.json` sets `withGlobalTauri: true`,
  so all 1,585 commands are reachable from any tier's bundle.
- **`#[allow(dead_code)]` on something whose only caller is behind a feature.** It
  converts "this is unreachable in the default build" into silence. Only 8 of 210 sites
  do this — but one of them is a path-traversal allowlist (§7 D1).

## 6. Evidence

**Adoption is better than the deviation list suggests, and the good half is worth
naming.** The `#[cfg(not(feature = …))]` fallback discipline is genuinely widespread:
**88 single-feature negated gates across 43 `.rs` files** (105 negated feature-cfgs in
all forms) — `commands/infrastructure/scraper.rs` (11), `commands/infrastructure/auth.rs`
(7), `companion/prompt.rs` (5), `gitlab/config.rs` (5), `companion/brain/embeddings.rs`
(4), `commands/companion/mod.rs` (4), `cloud/config.rs` (3),
`engine/http_engine/secrets.rs` (3), `companion/session.rs` (3). Non-`ml` builds of the
companion brain degrade rather than break. **The hole is exactly one layer wide: the
IPC registration list.**

- **`src/commands/infrastructure/scraper.rs:1-40` — copy this file.** Its module header
  states the doctrine in one sentence, it defines `NOT_ENABLED` + `not_enabled()` once
  under `#[cfg(not(feature))]`, and each of its 9 commands has both branches returning
  the same type. It is the only file in the repo that gets this completely right, and
  **none of its commands appear in the 128 gated registrations** — which is the proof
  the pattern works.
- **`src/commands/companion/consolidate.rs:194-209`** — the degraded-implementation
  variant. The `#[cfg(not(feature = "ml"))]` branch at `:205` still applies the edit; it
  just skips the embedding. Prefer this to an error whenever it is possible.
- **`src/commands/obsidian_brain/graph.rs:826-841` + `src/lib.rs:2840-2841`** — the
  paired-definition shape with an ungated registration, and the closest thing in this
  repo to `personas-cloud`'s `createNoopKafkaClient`: `obsidian_graph_stop_watcher`'s
  off-branch returns `Ok(())` rather than an error, because in a build with no watcher
  "stopped" is already true. Three commands do this; it should be dozens.
- **`src-tauri/src/lib.rs:3796-3816`** — the clearest statement in the repo of why this
  leaf is dangerous: a stacked `#[cfg]` *"removed 15 `commands::network::*` commands
  from `generate_handler!` and shipped — nothing in the compiler, clippy, or the test
  suite noticed, because the missing entry is a deletion, not an error."*
- **`.github/workflows/ci.yml:262-274`** — the model for documenting a build
  invocation's preconditions: two paragraphs, each naming the flag, the failure it
  prevents, and the measured consequence ("~770 tests in personas-db alone"). Every
  cargo invocation in this repo should carry a comment of this quality; four do not.
- **`.github/workflows/ci.yml:194-203`** — the same discipline for a *transitive*
  consequence of a feature: `--features desktop` pulls xcap → pipewire → libspa, which
  does not build on ubuntu-22.04, so the runner is pinned to 24.04 with the compiler
  error quoted inline.
- **`scripts/check-tauri-configs.mjs:90-101`** — the one feature check that runs on
  every change. It parses `[features]` out of `Cargo.toml` by hand and fails if a
  config names a feature that does not exist.
- **`scripts/build/run-rust-tests.mjs:172-178`** — the comment that explains why a bare
  `-p` run lies to you, and the package-qualified feature string that fixes it.
- **`src/lib/navigation/registry.ts:1-33` + `:154-158`** — the tier layer's own best
  work: four catalogs that had drifted apart were collapsed into one registry with a
  compile-time exhaustiveness assertion (`:105-108`) and a single `passesGates`. The
  tier *gate* is well built; only the claim about what it does to the bundle is false.

## 7. Deviations found

**Five categories, 25 individually-addressable items.** All ship green under
`npm run check`, `npm run check:contracts`, `npm run check:tauri-configs`, and all
three Rust CI jobs.

### A. The IPC surface is build-conditional and nothing downstream knows — 5

**A1 — a live orphaned `#[cfg]` is silently deleting a command from four build
configurations.** `src-tauri/src/lib.rs:2394-2397`:

```rust
// Clipboard Intelligence -- error detection + KB search
#[cfg(all(feature = "desktop", feature = "ml"))]
// Credential Recipes -- shared discovery cache
commands::credentials::credential_recipes::get_credential_recipe,
```

The commands that attribute was written for are gone — no `clipboard_intel` /
`clipboard_error` entry exists anywhere in `lib.rs`. The gate now lands on
`get_credential_recipe`, whose module (`commands/credentials/mod.rs:9`) and file
(`credential_recipes.rs` — **zero** `cfg(` attributes) are entirely unconditional, and
whose three siblings on the next three lines are ungated. Net: in every build that is
not `desktop` **and** `ml` — `tauri:dev:lite`, `tauri:build:lite`, `tauri:dev:test`, and
CI's own `--features desktop` — `get_credential_recipe` is unregistered while
`list_`/`upsert_`/`use_credential_recipe` work, and
`src/api/vault/credentialRecipes.ts:8` calls it unconditionally.
`generate_handler_has_no_orphaned_cfg_attributes` does not fire: the next non-comment
line is a path, not another `#[cfg(`. **Found by the §9 rule's own validation
disagreeing with a hand parser by exactly one match.**

**A2 — 128 registrations are build-conditional.** `p2p` 64 · `desktop` 40 · `ml` 18 ·
`cfg(debug_assertions)` 3 · `test-automation` 2 · `all(desktop, ml)` 1. The three
`debug_assertions` ones — `export_selective_to_path`,
`import_portability_bundle_from_path`, `companion_export_conversation_log` — are absent
from **every release installer**, which is a different and less obvious variant axis
than the features.

**A3 — all 128 are in `CommandName`, and 97 are invoked with no guard.**
`scripts/generate-command-names.mjs:33` (`if (trimmed.startsWith("#[")) continue;`)
drops the attribute line and keeps the entry, so the generated union (1,585 members)
claims every gated command always exists. **97 of the 128 distinct commands are invoked
from non-test `src/`, across 15 files (100 file×command pairs); 0 of them go through
`safeInvoke`.** Whole surfaces are affected, and they are affected *completely*:

| File | Gated commands invoked |
|---|---|
| `src/api/vault/database/vectorKb.ts` | **18** — every `ml` command in the build |
| `src/api/system/ambientContext.ts` | 12 |
| `src/api/network/bundle.ts` | 9 |
| `src/api/network/devices.ts` · `.../discovery.ts` · `.../identity.ts` · `src/api/signing/index.ts` | 8 each |
| `src/api/agents/personaIcons.ts` | 6 |
| `src/api/companion.ts` · `src/api/system/desktop.ts` | 5 each |
| `src/api/network/exposure.ts` 4 · `.../remoteJobs.ts` 3 · `.../enclave.ts` 2 | 9 |
| `src/features/plugins/twin/sub_brain/useBrainConnection.ts` | 3 — and it is a **component-layer** file, not an `api/` wrapper |
| `src/api/vault/credentialRecipes.ts` | 1 — this is A1 |

**A4 — the gate lives in three independent places that must agree by hand**, and only
one of the three is checked by anything. A command can be gated at its `mod`
declaration (55 sites), at the `#[tauri::command]` itself (8 sites), or at the
`generate_handler![]` line (128). Gating the module without the registration is a loud
compile error; **gating the registration without the module is silent** — that is
exactly A1, and it is the direction nothing checks. Of the 8 definition-level sites,
**6 are the correct paired-definition shape** (`obsidian_graph_start_watcher` /
`_stop_watcher` / `twin_ingest_doctrine_docs`, each defined twice — once under
`#[cfg(feature)]`, once under `#[cfg(not(feature))]` — with an **ungated** registration);
the remaining 2 are one-sided.

**A5 — the surface-preserving patterns exist and cover 15 of 1,658 commands (0.9%).**
Twelve body-gated (9 in `scraper.rs`, 2 in `commands/companion/mod.rs`, 1 in
`consolidate.rs`) plus the three paired definitions above. A further **14** commands
have a `#[cfg(feature)]` block in the body with **no `not()` branch** — which compiles
only because that feature happens to be on in every build that reaches them, i.e. they
are one `Cargo.toml` edit away from a type error.

### B. Invocations that compile a smaller tree than they claim — 9

| Path | Defect |
|---|---|
| `.gitlab-ci.yml:76` | `cargo clippy --manifest-path $CARGO_MANIFEST -- -D warnings` — no `--features desktop` (aborts on `updater:default` before linting), no `--workspace` (root package only). |
| `.gitlab-ci.yml:96` | `cargo test --manifest-path $CARGO_MANIFEST` — same two omissions. |
| `.gitlab-ci.yml:165` | `cargo test … export_bindings 2>/dev/null \|\| true`, then `git diff --quiet src/lib/bindings/`. The regen is silenced *and* allowed to fail, so the diff is clean because nothing ran — the exact swallow `ci.yml:371-373` says it removed. Also blind to untracked files — the hole `ci.yml:396-401` fixed with `git ls-files --others`. |
| `.gitlab-ci.yml:183-190` | The `summary` job hard-codes `Rust lint (clippy) ✓ … Binding drift check ✓` as `echo` lines. A manufactured-confidence machine. *(The whole file is dormant — the only remote is GitHub — but it is the copy anyone mirroring this repo would inherit.)* |
| `.github/workflows/e2e-smoke.yml:60` | `cargo build --features test-automation --manifest-path src-tauri/Cargo.toml` — `test-automation` is declared standalone (`Cargo.toml:64-69`) and does **not** imply `desktop`, so this aborts on `updater:default`. The step has no `continue-on-error`. The workflow triggers on `pull_request` only, in a repo whose `ci.yml:4-7` states *"development lands directly on master (no PRs)"* — ~~so it has almost certainly never run~~. **CORRECTED 2026-08-14 from the CI API: it has run 38 times — 34 `failure`, 4 `cancelled`, ZERO `success`** (run `29532610138` dies at `Permission updater:default not found`, exit 101). Both premises here were true — PR-only trigger *and* a master-first repo — and the inference from them was still wrong: this repo does open PRs occasionally (13 total, 3 after the workflow landed). The diagnosis was exactly right; only the history claim was invented. And the truth is worse than the guess: not an alarm that never rang, but one **ringing for three months that everyone learned to walk past.** Fixed in the same commit — `--features desktop,test-automation`. |
| `scripts/build/guard-concurrent-cargo.mjs:123` | Recommends `cargo test -p <crate> <filter>` — a bare `-p` run, which compiles `personas-core`'s mobile keychain stub. `run-rust-tests.mjs:172-178` documents that this produces ten spurious crypto failures. |

Plus two narrower ones: **`scripts/test/athena-model-bench.mjs:121`** prints a
recovery hint without `--features desktop` while the real spawn at `:130` has it; and
**`npm run test:rust`** (`run-rust-tests.mjs:185`) is
`cargo test --manifest-path … --features desktop --lib` — **no `--workspace`**, so the
command `.claude/CLAUDE.md` documents as "the Rust unit tests" runs only `app_lib`'s
lib tests. The `--crates` lane adds the other three packages but keeps `--lib`, so
`src-tauri/tests/render_plan_proptest.rs` runs in **neither** local lane.

**And one omission in the fixed file itself:** `ci.yml:283`'s clippy has
`--workspace --features desktop` but **no `--all-targets`**, so the **504 `#[cfg(test)]`
modules across 443 files** are compiled by `cargo test` and linted by nothing.
`../brainiac`'s CI carries `--all-targets` (§Convergence).

### C. Variants nothing compiles — 5

| Feature | cfg sites / gated module LOC | Compiled by |
|---|---|---|
| `ml` | 270 sites / 48 files · 7 modules, **4,187 LOC** | `release.yml` (dispatch/PR-closed) + `installer-test.yml` (manual) only |
| `p2p` | 104 / 13 · 21 modules, **11,889 LOC** (incl. `engine/src/p2p/` at 6,118) | same |
| `scraper` | 34 / 7 · 1 module, **930 LOC** + `commands/infrastructure/scraper.rs` (20 cfg sites) | **nothing** |
| `ollama` | 1 / 1 · 1 module, **389 LOC** | **nothing** |
| `test-automation` | 14 / 7 · 1 module, **218 LOC**, 2 commands | `tauri:dev:test`, `tauri:dev:test:full`, `launch-isolated.mjs`; `e2e-smoke.yml` is broken (§7 B) |

**C1 — no CI job compiles `ml` or `p2p`.** `ci.yml`'s three Rust invocations
(`:275`, `:283`, `:387`) all use `--features desktop`. Combined with `.claude/CLAUDE.md`'s
explicit instruction to *"Default to `tauri:dev:lite` for daily work"*, **374 cfg sites
and 16,076 LOC of feature-gated modules are neither built nor linted on any change** —
they are first compiled at release. `mobile` is declared (`Cargo.toml:63`) with **zero**
`cfg` references anywhere. `daemon` gates a bin via `required-features` and is built only
by `scripts/install-daemon-task.ps1:48`.

**C2 — `Cargo.toml:80-90` records the coupling that keeps `daemon` expensive:**
`daemon = ["desktop-full"]` because four modules have unresolved
`#[cfg(feature = "desktop")]` gaps (`engine/enclave.rs`, `engine/healthcheck.rs`,
`commands/ocr/mod.rs`, `commands/credentials/auth_detect.rs`). The headless daemon
therefore drags in ONNX Runtime and QUIC.

### D. Frontend tier — the gate is real, the claims about it are not — 4

| Path | Defect |
|---|---|
| `src/lib/constants/uiModes.ts:22` | *"Compile-time: set APP_TIER env var to tree-shake higher-tier code entirely."* No tier bundle tree-shakes any section: `sectionRouter.tsx:63-73` lists all ten `lazyRetry(() => import(…))` primaries in one unconditional `SECTION_ROUTES` object, read by dynamic key at `:92`. Also names the wrong variable — it is `VITE_APP_TIER`, not `APP_TIER`. |
| `.github/workflows/ci.yml:148-149` + `docs/development/build.md:28` | Repeat the tree-shaking claim. `npm run check:tiers starter team` therefore builds two bundles that differ only in which sections render. |
| `registry.ts` + `useTier.ts` | **`TIERS.BUILDER` is never used as a `minTier` anywhere in `src/`.** Only 3 of 11 nav sections are gated (`teams`, `events`, `plugins` at `minTier: TEAM`) plus `studio` (`devOnly`). `team` and `builder` differ at exactly **2** call sites (`isBuilder` in `NavigationGrid.tsx:90`, `DesktopFooter.tsx:291`), so one third of `check:tiers` validates a near-identical bundle. |
| `package.json:79-81` + `tauri.conf.json:11` | `build:starter/team/builder` set only `VITE_APP_TIER`; no tier maps to a cargo feature or a tauri config. A starter installer ships the full `desktop-full` backend and all 1,585 commands, with `withGlobalTauri: true`. `docs/concepts/capability-audit.md:102-115` reached the same conclusion in an earlier pass (*"Tier is security through obscurity at the binary level"*) and it has not moved. |

### E. Dead code — 2 (and the brief's hypothesis largely cleared)

**210** `#[allow/expect(dead_code)]` sites in 103 files (fn 104, struct 31, const 19,
impl 16, enum 8, trait 6, mod 4, unresolved 22). **8 (3.8%)** are within three lines of
a `cfg(` — so this is *not* mainly a feature-gating phenomenon, and the brief's
hypothesis does not hold here.

What *is* real is the tested-but-uncalled class. **11 items** have no reference outside
their own declaration except inside `#[cfg(test)]` modules (a lower bound — the
heuristic counts doc-comment mentions as production references, which is how it missed
`ProcessContext`, `src/engine/process_session.rs:163-164`, `#[allow(dead_code)]` on both
the struct and its `impl`, exercised by 4 tests at `:624-666` and called from no
production site).

- **`engine/src/path_safety.rs:135-136` — `validate_file_watcher_paths`. Security-relevant.**
  It is the only caller of `validate_watch_path` (`:82`), which blocks `..` traversal
  and system directories and enforces "under your home directory" for file-watcher
  trigger paths. `validate_file_watcher_paths` has **no production caller**, and
  `engine/src/file_watcher.rs` (the `desktop`-gated 710-LOC consumer) never references
  `path_safety`. `validate_watch_path` appears 17 times in its own file: one definition,
  one call (from the dead wrapper), and **15 assertions in its own test module**
  (`:579-602`). The allowlist is thoroughly tested and runs on nothing.
- `core/src/error.rs:10` — `#[allow(dead_code)]` on the whole `AppError` enum with the
  comment *"Variants used by Tauri commands in Phase 3"*. A blanket silencer on the
  repo's most-used error type, which is also why a missing `FeatureUnavailable` variant
  produces no signal.

## 8. Gaps in the primitive

1. **`generate_handler![]` is a list, not a type.** Nothing in Rust can require that
   every build variant register the same set of names. §4's generated-trait or
   self-registering-macro answer closes it; the sibling repos both get the property from
   an interface (§Convergence), which is evidence it is obtainable, not a wish.
2. **`scripts/generate-command-names.mjs` cannot express conditionality.** Its output is
   one flat union. It already *sees* the `#[cfg]` line and deliberately discards it
   (`:33`), so a two-union emit is a five-line change — but `CommandName` is consumed by
   `invokeWithTimeout`'s signature, so the split is only useful together with the
   `invokeOptional` change.
3. **There is no capability probe.** No command reports the compiled feature set, so the
   frontend cannot ask "is p2p in this build?" and cannot render a coherent empty state
   for the 97 sites. Every other variant axis in the fleet has one (`kafkaEnabled`,
   `IS_SUPABASE`); this one has none.
4. **`AppError` has no `FeatureUnavailable`.** The off-branch's only options are
   `Internal` (indistinguishable from a crash) or `Validation` (a lie —
   `scraper.rs:20-22` says so in a comment and picks `Internal`). No `error_registry`
   key, no i18n, so the one correct pattern still surfaces untranslated English.
5. **Cargo cannot assert "these features must be enabled together with this
   invocation".** `capabilities/default.json` is resolved by `tauri-build` at build-script
   time and its failure mode is an abort, not a diagnostic naming the missing feature.
   Nothing can make `--features desktop` the default for `cargo test` short of
   `default = ["desktop"]`, which would defeat the lite lane.
6. **Vite's `import.meta.env` substitution cannot reach a value behind a function
   boundary.** `BUILD_MAX_TIER` folds to a literal; `useTier().isVisible(minTier)` does
   not, and `SECTION_ROUTES[section]` is a dynamic key. Real tier tree-shaking requires
   the *lazy import itself* to sit behind a statically-foldable condition, which means
   `SECTION_ROUTES` becomes partial and the router grows a "not in this build" branch —
   i.e. the same shape as the backend fix.
7. **The census runner is a line-oriented text matcher, and a build invocation is not
   text.** It cannot separate a `run:` step from a comment about one (its filter at
   `scripts/census/lib/engine.mjs:82-85` recognises `//`, `*`, `/*` — not `#`), cannot
   expand `$CARGO_MANIFEST`, and cannot see an argv array. That is why the most valuable
   gate for this leaf cannot be a census rule (§9 item 2 measures all four reasons).
8. **~~`npm run census:check` is wired into nothing.~~ CLOSED 2026-08-14, in the same commit that published this path.** It is now part of `npm run check` (alongside `check:corpus` and `check:doc-map`), which `ci.yml:111` already runs. The finding was true when measured and false within the hour — a later composer flagged it as wrong, which is correct *now* and would have been wrong then. Left visible rather than deleted because it is the sharpest thing this wave found: the corpus spent seven batches prescribing gates while its own 27 rules were a report nobody ran. Original text follows. — Not `npm run check`
   (`package.json:51`), not `lefthook.yml`, not any workflow — `census` appears **zero**
   times under `.github/`. Every census rule in the corpus, including the one below, is
   currently a report nobody runs.

## 9. The missing gate

Four items, cheapest first: one census rule, one purpose-built script (replacing a
**refused** census rule), a ~10-line extension of an existing test, and one further
refusal. The first refusal is the important part: **the highest-value gate for this leaf
is not a source-pattern rule at all**, and the census runner provably cannot host it.

### 1. Census rule — `build-gated-ipc-entrypoint`

**The condition (stack-free):** *an entry point's EXISTENCE is decided by a build
switch, while every caller-side artefact still claims it always exists.*

**The proxy in this repo:** a `#[cfg(...)]` attribute governing a single entry in
`tauri::generate_handler![]`. **PRECONDITION, and an adopting repo must re-derive its
own:** this works because Personas expresses variance as Cargo `#[cfg]` and registers
one path per line. A repo whose variance is a bundler `define`, an optional import, a
DI binding, or a router mounted behind an `if` scores **zero** here while the condition
is present at full scale — `personas-web`'s six unguarded Supabase-plane callers and
`personas-cloud`'s unconditionally-mounted `shared_events` router are exactly that
condition wearing different markup.

```json
{
  "rules": [
    {
      "id": "build-gated-ipc-entrypoint",
      "goldenPath": "docs/concepts/golden-paths/feature-flagged-compilation.md",
      "title": "An IPC entry point whose REGISTRATION is build-conditional, so the command exists in some builds and not others while the frontend's type says it always exists",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "#\\[cfg\\([^\\]]*\\][^\\S\\r\\n]*\\r?\\n(?:[^\\S\\r\\n]*//[^\\r\\n]*\\r?\\n)*[^\\S\\r\\n]*commands::[\\w:]+[^\\S\\r\\n]*,",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a #[cfg(...)] attribute governing a single entry in tauri::generate_handler![] (the attribute line, then optional comment lines, then one commands::path, line). PROXY FOR the stack-free condition: an entry point's EXISTENCE is decided by a build switch, while every caller-side artefact still claims it always exists. In this repo the generated CommandName union (src/lib/commandNames.generated.ts) contains all 128 of these because scripts/generate-command-names.mjs:33 skips the #[cfg] line and keeps the entry, so 97 of them are invoked unconditionally from src/api/** with zero safeInvoke guards and reject with Command \"x\" not found under --features desktop. The comment-tolerant span is load-bearing: lib.rs:2395 is an ORPHANED gate (a #[cfg(all(desktop, ml))] separated from its intended command by a comment, now silently unregistering get_credential_recipe), and the existing generate_handler_has_no_orphaned_cfg_attributes test cannot see it. The legal destination is the pattern at src/commands/infrastructure/scraper.rs:17-40 — register unconditionally, gate the BODY, and return a typed capability error in the #[cfg(not(feature))] branch. PRECONDITION: this proxy keys on Cargo's #[cfg] attribute plus this repo's one-path-per-line registration list. A repo whose variance is a bundler define, an optional import, a DI container binding, or a router mount behind an if scores zero here while the same condition is present at full scale — re-derive the proxy against the local registration mechanism."
      },
      "baseline": { "files": 1, "matches": 128 },
      "floor": 500
    }
  ]
}
```

**Counts verified through two independent implementations before baselining.** A hand
parser (walk the handler block, track a pending attribute, resolve the following path)
and the census regex both return **128** — but only after the regex was widened to
tolerate an intervening comment line. **The first version returned 127, and the missing
one is §7 A1, a real bug.** That disagreement is the whole value of the double
implementation; the contract's instruction earned its keep here.

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check --rules <file>`),
from a scratchpad file named `census-featgate-9c41ba.json` unique to this composition:

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK build-gated-ipc-entrypoint 1 1 128 128 564 500` — surviving counts printed |
| matcher matches nothing (`NoSuchGateXYZ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped` |
| floor above walk (`floor: 5000`) | **1** | `[structural] walked 564 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src-tauri/src/commands`) | **1** | `[structural] walked 299 … floor is 500` + `zero matches` + `files 1→0`, `matches 128→0` |
| count rises (baseline lowered to 120) | **1** | `[drift] matches rose 120 → 128 (+8)` |
| renamed root (`src-tauri/srcc`) | **1** | `walked 0 files but floor is 500` + `matched zero files anywhere` + both drops |
| stale `exclude` | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |

All seven behave as the contract requires. No `exclude` entries: there is no file that
must legitimately contain this shape — `scraper.rs` proves the alternative exists — and
an exclude added for symmetry is a stale exemption waiting to happen.

**But this rule is currently a report, not a gate** (Gap 8): `npm run census:check`
appears in `package.json:49` and in **no** workflow, hook, or composite script.
Publishing the rule and wiring the runner are two separate acts, and only the second one
enforces anything.

### 2. REFUSED as a census rule — the build-invocation check. Here is the check that works.

**This is the gate this leaf most needs, and the census runner provably cannot host
it.** The signal would be "a cargo compile invocation that does not carry
`--features desktop`". I built the candidate matcher (`\bcargo\s+(test|clippy|build|check|run|bench)\b`)
and ran it over `.github/**`, `scripts/**`, `.gitlab-ci.yml`, `package.json` and
`lefthook.yml`. Four measured reasons it fails, in ascending order of fatality:

1. **52% of the matches are prose.** 31 lines match; **16 are comments** *about* cargo
   (`run-rust-tests.mjs:14,177,205`, `guard-concurrent-cargo.mjs:2,4`,
   `sample-build-memory.ps1:1,9,14`, `census/run-census.mjs:21`, …). The engine's
   comment filter (`scripts/census/lib/engine.mjs:82-85`) recognises `//`, `*`, `/*` —
   **not `#`** — so every YAML and PowerShell comment counts as code.
2. **Advice strings are indistinguishable from invocations, and precision collapses to
   26%.** Of the 15 non-comment matches, **7 are `console.error` / `echo` strings that
   quote a command** (`ci.yml:403`, `guard-concurrent-cargo.mjs:96,117,123`,
   `athena-model-bench.mjs:121`, `run-connector-baseline.mjs:42`, `.gitlab-ci.yml:169`).
   **Only 8 are real invocations.** And this is not a nuisance category — the repo's
   *wrong* commands live almost entirely in advice strings (§7 B), so a rule that skips
   strings misses the defects while a rule that keeps them flags `ci.yml:403`, which is
   correct. The distinction is semantic, not textual. My own classifier misfiled 7 of 15.
3. **The manifest is often not textually present.** `.gitlab-ci.yml` addresses it as
   `--manifest-path $CARGO_MANIFEST` (defined at `:16`). A rule keyed on
   `src-tauri/Cargo.toml` scores **zero on the one file that contains every violation** —
   the portability failure §9 exists to prevent, committed inside a single repo.
4. **The most important invocation is not a string at all.**
   `scripts/build/run-rust-tests.mjs:179-185` builds its argv as a **JavaScript array**
   (`['test', '--manifest-path', CARGO_TOML, '--features', 'desktop', '--lib']`). The
   substring `cargo test` never appears. `npm run test:rust` — the command
   `.claude/CLAUDE.md` documents as the Rust suite, and the one missing `--workspace` —
   is invisible to every text signal by construction.

**Specify instead `scripts/check-cargo-invocations.mjs` (~50 lines), wired into
`npm run check:contracts`** so it runs in `frontend-checks` with no cargo build:

- **Signal.** Not a regex over lines. Load each source as **structured data** and read
  the invocation position: YAML `steps[].run` / job `script[]` entries for the
  workflows and `.gitlab-ci.yml` (expanding `variables:` first, which is what makes
  `$CARGO_MANIFEST` resolvable); `scripts` values in `package.json`; and, for
  `scripts/**/*.mjs`, the **argv arrays passed to `spawn`/`spawnSync`/`execFileSync`
  whose command is `cargo`** — which is the only way `run-rust-tests.mjs` is visible at
  all. Then tokenise and keep the invocations whose subcommand is in the compile set
  (`build`, `test`, `check`, `clippy`, `run`, `bench`) and whose manifest resolves to
  `src-tauri/Cargo.toml` (via `--manifest-path`, a `cd src-tauri`, or an expanded
  variable). Everything in a comment or a quoted message is out of scope **by
  position**, not by pattern.
- **Assertions.** Each such invocation must carry `--features` naming a set that
  includes `desktop` (directly or via `desktop-full`/`daemon`), **and** `--workspace`
  unless it carries an explicit `-p`. Clippy invocations must additionally carry
  `--all-targets`. Report the file, the line, and the missing flag.
- **Allowlist** in the same file, each entry requiring a `reason`: the `--crates` lane
  in `run-rust-tests.mjs:180-184` (package-qualified features, deliberate);
  `install-daemon-task.ps1:48` (`daemon` implies `desktop-full`). `e2e-smoke.yml:60` is
  **not** an exception — it is a violation until `desktop` is added.
- **Fail-loud preconditions**, which are the point: assert the walk found **≥ 8 cargo
  compile invocations across ≥ 4 files** before asserting anything about them (measured
  today: exactly **8 across 4** — `ci.yml` ×3, `e2e-smoke.yml` ×1,
  `install-daemon-task.ps1` ×1, `.gitlab-ci.yml` ×3 — plus the two argv-array ones in
  `run-rust-tests.mjs` that only the structured reader can see). A parser that silently
  stops finding cargo commands would otherwise report a perfect score. Assert
  `capabilities/default.json` still contains `updater:default`: if that line is ever
  removed, the whole `--features desktop` requirement changes and the checker must be
  re-derived rather than keep enforcing a stale rule. Print the audited totals on
  success — `cargo invocations OK (10 checked, 5 files, 2 allowlisted)` — so a green log
  distinguishes a clean run from an empty one.

Cheapest first win, independent of the script: **add `--all-targets` to `ci.yml:283`**.
One word, and it puts 504 `#[cfg(test)]` modules under clippy for the first time.

### 3. Extend the existing Rust guard to catch A1 (≈10 lines)

`generate_handler_has_no_orphaned_cfg_attributes` (`lib.rs:3916`) already walks the
handler body line by line. Add a second assertion in the same loop: when a `#[cfg(` line
is separated from its path by one or more comment lines, **fail**, because that is
indistinguishable from an orphan and §7 A1 proves it hides one. Two lines of the
existing `while` loop already skip comments — the fix is to record that it skipped and
assert it did not. Keep the existing `declared.len() > 20` style precondition assertion.

### 4. REFUSED — a census rule on `#[allow(dead_code)]`

The condition is real (210 sites, 11+ tested-but-uncalled items) but it belongs to a
different leaf: only 8 sites (3.8%) touch feature gating, so a rule filed here would be
96% off-topic, and the honest count-based version would be an unratcheted 210 with no
prescription attached. `path_safety.rs:135` is worth fixing on its own merits (§7 E);
that is a ticket, not a gate.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. Not because warnings drown in a large baseline — the baseline is
**1,135**. The count-independent argument is the only one that holds: `npm run check`
runs `eslint src/` with **no `--max-warnings`** (`package.json:51`), and the pre-commit
hook runs `--quiet --max-warnings 99999` (`lefthook.yml:20`), where `--quiet` discards
warnings before they can be counted. **A warn-level rule enforces nothing at either
gate, at any count.**

## Convergence — what travels, and one result that inverts the brief

Checked against `../brainiac` (Rust workspace, 8 crates), `../personas-cloud`
(Node orchestrator + FastAPI facade), `../personas-web` (Next.js App Router).

**Physics — independently reinvented, so these clauses travel:**

- **"The callee always exists; absence is a typed refusal."** This is §2's whole
  prescription, and **both siblings invented it independently, in different languages,
  with the type doing the enforcing.** `personas-cloud/packages/orchestrator/src/kafka.ts:310-325`
  — `createNoopKafkaClient` returns a full `KafkaClient` whose methods log and return,
  selected at `index.ts:55-66`, so `Dispatcher` always holds a client.
  `personas-web/src/lib/supabaseApi.ts:51-53` — `function readOnly(): never { throw new
  ApiError(501, "Cloud-sync mode is read-only …") }`, wired into 8 methods, with
  `export const supabaseApi: ApiClient` (`:313`) forcing every variant to implement the
  full surface, and the header comment (`:9-12`) stating the doctrine outright: *"They
  throw a clear error rather than silently no-op."* Personas' `scraper.rs` is the same
  invention a third time. **Three independent rediscoveries is as strong as this oracle
  gets.**
- **"CI proves exactly one variant."** `personas-web`'s `ci.yml` has **zero `env:`
  blocks on any step**, so `npm run build` compiles the single default combination and
  the `NEXT_PUBLIC_DATA_SOURCE=supabase` variant is never built. `personas-cloud` has
  **no CI at all**. Personas builds `desktop` on every change and `desktop-full` only at
  release. Same failure, three repos.
- **"A caller references a symbol that only exists in one variant."** `personas-web`
  has **6** dashboard hooks importing Supabase-only exports directly and calling them in
  the non-Supabase build (`useTopPerformers.ts:7`, `useLeaderboardData.ts:7`,
  `useSlaData.ts:7`, `useMessagesData.ts:7`, `useKnowledgeData.ts:9-13`,
  `useUpcomingRoutines.ts:7`) — while `useSyncedRealtime.ts:27` *does* gate on
  `IS_SUPABASE`. 1 of 7 guarded, against Personas' 0 of 97. Identical shape, identical
  neglect.
- **Under-scoped check invocations recur everywhere.** `personas-web`'s
  `vitest.config.ts:32` includes only `src/**/*.test.ts` — `.tsx` is excluded; its
  `check:guide-content` script exists in `package.json:26` and is in no workflow while
  `guide/[category]/[topic]/page.tsx:54-56` claims *"The CI guard … asserts"* it.
  `personas-cloud` has an unrunnable `bus.test.ts` (243 lines, no runner) and no `lint`
  script at all. Personas' `.gitlab-ci.yml` and `e2e-smoke.yml` are the same species.

**This INVERTS part of the brief's framing:**

- **Cargo features are not physics — they are a Personas choice.** `../brainiac` is the
  control: a Rust workspace of **8 crates** with **zero `[features]` tables** and
  **zero `cfg(feature` occurrences** in any `.rs` file (only `#[cfg(test)]` and one
  `#[cfg(unix)]`/`#[cfg(not(unix))]` pair in `brainiac-server/src/main.rs:610,628`). Its
  variance is entirely runtime: docker-compose env files. Consequently its CI has
  nothing to forget — `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo test --workspace`, no flags, no variants (`.github/workflows/ci.yml:38,40`).
  **The brief treats "remember `--features desktop`" as the discipline to enforce
  harder; the honest conclusion is that the flag exists because of an optional-heavy
  dependency graph, and the sibling that avoided the graph avoided the entire defect
  class.** `--features desktop` is a ratchet on a self-inflicted axis, not a law.
- **`--all-targets` is the missing flag nobody in this repo has noticed.** brainiac
  carries it; every Personas clippy invocation omits it. That one came from the control
  repo, not from the subject.

**Local calibration — no trace anywhere else:**

- **The frontend tier axis.** `personas-web` has 18 build-time `NEXT_PUBLIC_*` flags but
  **zero** tier/plan/entitlement gating (0 matches for `FEATURE_`/`ENABLE_` prefixes;
  the 20 files mentioning `starter`/`pro`/`enterprise` are marketing copy).
  `personas-cloud` has 23 runtime env names and no tier concept. Personas' three-tier
  bundle is unique in the fleet — which, given §7 D's finding that it tree-shakes
  nothing and gates 3 of 11 sections, is worth reading as evidence the axis is not
  earning its `check:tiers` cost.
- **A dormant second CI definition** (`.gitlab-ci.yml`). No sibling has one. Nothing
  else in the fleet carries a complete, wrong, unexecuted copy of its own gates.
