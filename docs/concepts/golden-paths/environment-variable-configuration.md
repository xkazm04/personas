# Golden path — Environment-variable configuration

> Situation node: `platform-delivery/build-profiles/environment-variable-configuration` · [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: false` · recurrence **40** · risk **high**.
> Dimensions: **function · security · code-quality**.
> Spine's own framing: *"Adding a runtime env escape hatch that is documented, typed and not a backdoor."*
>
> Composed 2026-08-15 against `master` @ `02fe37134`. Sweep: all **963** `.rs` files under
> `src-tauri/` (exactly `rust.files` in [`shared-facts.json`](../shared-facts.json)) · all **4,829**
> `.ts`/`.tsx` under `src/` (`frontend.tsFiles`) · `vite.config.ts` · every file under `scripts/`
> (**4,982** files walked for the JS lane) · all **7** GitHub workflows plus `.gitlab-ci.yml` and
> `lefthook.yml` (**12** CI files) · every `package.json` script · `src-tauri/build.rs` ·
> `.env` and `.env.example` (names only — **no value was read into this document, printed, or logged**).
>
> **Every count came from a parser, not a grep.** Two independent implementations measured the Rust
> runtime-read surface: one walking forward from the `env::var` token with a bounded tail, one walking
> *backward* to the statement start and then forward through balanced parens/braces to the consequent.
> They agree on **127 statements** and on the exact `file:line` set (0 in A-not-B, 0 in B-not-A); they
> disagreed only on *shape classification*, and the backward implementation is the one reported,
> because the forward one filed 62 statements as "other" that are `if let Ok(v) = …` guards.
> **The unit throughout is the statement WITH its consequent**, never the line.
>
> **Executed, not reasoned.** The headline was produced by running the real Vite 8 pipeline six times
> over a fixture that transcribes `src/lib/constants/uiModes.ts:24-46` verbatim, and reading the
> emitted bundle. §7 A2 is a result no amount of source-reading would have produced. **No `cargo`
> command was run**; two claims that would need a compile are marked as such.
>
> The **Deviations** section is a fix backlog.

---

> ### ⚠ The brief that commissioned this path is confirmed, and then corrected on the fix
>
> **CONFIRMED, and the pipeline is simpler than it looks — I got this wrong on the first pass and
> the correction sharpens it.** `.github/workflows/release.yml` builds the frontend **exactly once**,
> at `:193-198` (`npm run build`, `env:` = `SENTRY_DSN`, `VITE_SENTRY_DSN`); the result is uploaded
> at `:200-205`, downloaded into `dist/` at `:288-293`, and consumed as-is — because
> `tauri-action`'s `with:` block sets **`beforeBuildCommand: ""`** at `:320`, overriding
> `tauri.conf.json`'s `"npm run build"`. So there is one frontend build and one place a frontend
> variable could be set. **`VITE_APP_TIER` appears nowhere under `.github/` except inside a comment
> at `ci.yml:148`.** Its only writers in the repo are `package.json:79-81`
> (`build:starter`/`team`/`builder`, via `cross-env`), `scripts/check-tiers.mjs:39`, and
> `README.md:317-318` — a **manual** recipe. Every published installer is the builder bundle.
> `ci.yml:146-156` compiles the starter and team bundles on every change and ships neither.
>
> *(The correction also relocates a smaller defect: `VITE_SENTRY_DSN` at `:305` is on the
> `tauri-action` step, where no frontend build runs, so it is **dead** — see §7 B3. Only `:196`
> reaches the bundle. `GCP_CLIENT_ID`/`GCP_CLIENT_SECRET` at `:306-307` are correctly placed, because
> the **cargo** build does run there.)*
>
> **Framed honestly:** `README.md:322` states the current behaviour accurately — *"When
> `VITE_APP_TIER` is not set, the build includes all tiers and users can switch freely at runtime"* —
> so this is less "a variable someone forgot" than **a tiered-installer product that was documented
> as a manual operation and never automated**, while `uiModes.ts:22` and `.env.example:39-44` describe
> it as a shipping capability. One sentence in the README is the only place in the repo that tells
> the truth about what installers exist.
>
> **CORRECTED — and this is the finding the brief could not have had.** The obvious fix is
> `VITE_APP_TIER: ${{ vars.APP_TIER }}` in `release.yml`'s two `env:` blocks. **That fix is worse
> than the bug it repairs.** `uiModes.ts:41` defaults with `??`, which fires on `undefined` and not
> on `""`; a GitHub Actions `env:` entry whose expression is blank renders as a variable that is
> **set and empty**. Executed against the real pipeline (§7 A2): unset → the literal `TIERS.BUILDER`
> is inlined and everything is visible; `""` → the literal `""` is inlined, `TIER_RANK[""]` is
> `undefined`, and **`isTierAvailable` returns `false` for starter, team *and* builder** — a bundle
> in which no tier is available at all. The one-line fix converts "every installer is the builder
> bundle" into "one mistyped repository variable ships an app with no navigation", and no gate
> anywhere would notice either state. **Fix the operator before you add the writer.**
>
> **And the class is larger than the brief supposed.** `VITE_APP_TIER` is not the only read with no
> writer on the shipping path — it is the *best-provisioned* one. Of **4** `VITE_*` names read in
> `src/`, only `VITE_SENTRY_DSN` is set anywhere in CI. And `build.rs:32-42` forwards **nine** names
> to `rustc` for `option_env!`; `release.yml` supplies **three**. The other six live only in the
> operator's gitignored `.env` (§7 B1).

## Scope — and the boundary with three neighbours, settled in prose

| Concern | Owner |
|---|---|
| Whether a **symbol exists** in this build (`#[cfg(feature)]`, `generate_handler!`, tier *visibility*) | [**feature-flagged-compilation**](./feature-flagged-compilation.md) (rec. 670) |
| **How** a value is frozen into an artifact (the `option_env!` / `define` / inlining machinery) | **compile-time-env-embedding** (rec. 9, unwritten) |
| The three `tauri.*.conf.json` overlays as documents | **tauri-config-variants** (rec. 4, unwritten) |
| **Which values must exist, who guarantees they do, what happens when one is missing or empty, and whether a value may be a secret** | **this path** |

The short version: that path owns *does the code exist*, this one owns *does the value*. Where they
touch — `VITE_APP_TIER` — feature-flagged-compilation owns `passesGates` and the tier *mechanism*
(see also [tier-and-capability-gating](./tier-and-capability-gating.md), which established that the
backend has no tier concept at all); this path owns the fact that **nothing supplies the variable**
and that **the read cannot tell "absent" from "empty"**.

## 1 Trigger

- "Make this configurable" / "add an env var for it" / "put it in `.env`"
- "It works on my machine but not in the installer" (or the reverse)
- "Where does the app get the Supabase URL / the OAuth client secret / the Sentry DSN from?"
- "Why is the released app on the builder tier?" / "why is my feature flag not doing anything?"
- "Should this be `option_env!` or `std::env::var`?" / "build-time or runtime?"
- "Can I just read `process.env.X` here?" / "does the user have any way to set this?"

If you are about to type `import.meta.env.VITE_…`, `std::env::var("…")`, `option_env!("…")`,
`env!("…")`, `std::env::set_var`, a new line in `.env` / `.env.example`, a new key in `build.rs`'s
forwarding list, or an `env:` block in a workflow — you are in this situation.

## 2 The one way

**Decide first whether the value is a build-time constant or a runtime input, because that decision
is irreversible after the artifact leaves the machine — then never let a read site invent the value
it did not receive.** A build-time value is frozen: Vite inlines `import.meta.env.VITE_X` as a
literal and `option_env!("X")` bakes a `&'static str` into the binary, so an installer whose build
omitted the value ships a *silently different product*, not a misconfigured one — which is exactly
what happened to `VITE_APP_TIER`. Prefer runtime wherever the user could plausibly need to change it,
and where you must freeze, **layer the frozen value UNDER the runtime one and filter the empty string
out at every layer**: `engine/src/google_oauth.rs:57-64`'s `resolve_env_value(compile_time,
runtime_keys)` is the shape — `option_env!` first, then `env::var` over an alias list, then a `.env`
file, with `.filter(|v| !v.is_empty())` and `!trimmed.is_empty()` on every branch, so a build that
omitted the value still resolves and a value set-but-empty never wins. **`??` is the wrong operator
for an environment read, always** (`||`, or an explicit `.trim() === ''` test): every delivery
mechanism this repo uses — a blank GitHub Actions expression, a bare `NAME=` line in `.env`, an
`export NAME=` in a shell — produces set-and-empty, and `??` treats that as a deliberate choice.
Then **validate the value against its own domain at the boundary and refuse loudly if it fails**,
because a config value that is neither absent nor legal is the one state nothing in this repo handles
today: `VITE_APP_TIER="pro"` compiles, ships, and hides every section. **Never supply a silent
literal default for a value whose absence means the feature is broken** — `unwrap_or_else(|_|
"http://localhost:11434")` turns a missing base URL into a connection-refused mystery; return a typed
error naming the variable, the way `mcp_server/tools.rs:47` does. **A credential is not
configuration.** The environment is a legitimate *inbound* path for a secret — read it once, mask it,
and import it into the Vault (`commands/credentials/foraging.rs`, 53 declared patterns, the raw value
dropped at the end of the scope) — but it is never the store: `.env` is unencrypted, unaudited,
world-readable to every child process, and a secret frozen by `option_env!` is a plaintext string
literal in a shipped executable that `strings` will print. And **never let an environment variable
decide a security posture** without treating it as an authenticated switch: `core/src/crypto.rs`
gets this right three times (fail-closed, one parse site, the reason written down) and it is the
single most dangerous shape in this leaf, because the process environment of a desktop app is
attacker-adjacent in a way a CI environment is not.

## 3 Mandated primitives

**Exist today — use them.**

- **`src-tauri/engine/src/google_oauth.rs:57-64` — `resolve_env_value(compile_time, runtime_keys)`.**
  ***This is the one to copy.*** The complete precedence chain in eight lines: `option_env!` value →
  `env_var_first_nonempty(keys)` (`:5-15`) → `dotenv_var_first_nonempty(keys)` (`:20-54`), with an
  emptiness filter at **every** layer and an alias list per value (`GCP_CLIENT_ID` ·
  `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_CLIENT_ID`). 6 of the repo's 11 `option_env!` reads go through
  it. Nothing else in the tree resolves a config value correctly.
- **`src-tauri/build.rs:30-57` — the compile-time forwarding list.** Nine names, each with
  `cargo:rerun-if-env-changed={key}` **and** `if !val.trim().is_empty()` before the
  `cargo:rustc-env=` emit. The empty guard at `:53` is the correct operator, and the 25-line comment
  at `:43-50` explains the second-order hazard it is defending (a cached build-script output shipping
  a rotated secret's previous value under `swatinem/rust-cache`). **This file is the only declaration
  of what a build needs that exists anywhere in the repo** — treat it as the contract even though
  nothing enforces it.
- **`src/lib/sentry.ts:175-181`** — the frontend's correct read: gate on `import.meta.env.PROD` first
  so a locally-leaked `.env` value can never ship, then `dsn || undefined` so an empty string is
  absence. Two guards, both right, in six lines.
- **`src/lib/utils/platform/platform.ts:11-13` + `vite.config.ts:222-224`** — **the shape that makes
  absence unrepresentable.** `VITE_PLATFORM` is never an environment *read*: `vite.config.ts`
  computes it from `TAURI_ANDROID`/`TAURI_IOS` (which Tauri's own CLI sets) and injects it through
  `define`, so `import.meta.env.VITE_PLATFORM` is always a literal, defaulting to `"desktop"`.
  Verified by execution (§7 C1): with the `define` present, a `.env` saying `VITE_PLATFORM=android`
  is **overridden** and the bundle emits `"desktop"`. Copy this whenever the value is derivable.
- **`src-tauri/core/src/crypto.rs:463-469` — `fallback_policy()`, and `:477-481`
  `legacy_key_migration_allowed()`.** The security-switch shape: one function, one parse site, an
  explicit two-variant enum (`Deny` / `Allow`) rather than a bare bool, fail-closed by default, and a
  doc comment recording the incident that produced it — *"The previous code documented an
  opt-in/fail-closed policy but implemented the opposite … and never read the `ALLOW` var the error
  names"*. `unwrap_or_default() == "1"` is **correct here**: an unreadable variable yields `""`,
  which is not `"1"`, which is `Deny`.
- **`src-tauri/src/commands/credentials/foraging.rs:78` `ENV_PATTERNS` (53 entries) + `:180-217`
  `scan_env_vars()`.** The env→Vault import path, and the doctrine implemented: the raw value is
  masked on the line after it is read, the plaintext `String` is dropped at the end of the scope
  (`:203`, with the comment saying so), and the foraged id encodes **exactly which variable won**
  (`:196-215`) so import cannot silently re-resolve to a different one.
- **`src-tauri/src/engine/http_engine/secrets.rs:50-77`** — the credential resolution order, written
  down and obeyed: profile override → OS keyring → env, with `qwen_key_configured()` returning a
  bare `bool` and the module header stating *"The Qwen key is never returned to callers"*. The
  environment is the **last** resort here, not the store.
- **`src/lib/utils/platform/triggerConstants.ts:210-212`** — the correct frontend default operator
  (`||`) on the sibling variable of the one that gets it wrong, in the same repo, at the same layer.

**Do not exist here — but two of the three are proven in a sibling, so this path routes rather than
invents. §4 says which to build first.**

- **A declaration of the environment contract.** There is no module, schema, struct or manifest in
  this repo listing what the app consumes; `build.rs`'s nine names are the closest thing and cover
  only the compile-time Rust half. **Do not design one from scratch — `../personas-cloud` already
  has it**: `packages/orchestrator/src/config.ts:3-35` is a 21-field typed interface loaded by a
  single `loadConfig()`, with `validateConfig()` at `:85-221` throwing a numbered aggregate of every
  violation at boot and enforcing four *cross-field* rules. Copy that shape. Nothing here relates a
  read to a writer; §9's refusal explains why a census rule cannot supply this and names the checker
  that can.
- **A validating accessor.** `import.meta.env.VITE_APP_TIER as Tier` is an unchecked cast; there is
  no `readTier()` that rejects a value outside `TIERS`. Same on the Rust side: no `env_bool`,
  `env_u32`, `env_url` — 127 read sites re-derive the decode.
- **A capability/diagnostics surface.** No command reports which configuration values this build
  resolved, so neither the user nor a support session can tell a build that shipped without
  `SUPABASE_URL` from one that shipped with it.

## 4 Steps

1. **Answer "build-time or runtime?" out loud, and write the answer in the declaration.** Build-time
   is correct only when the value is a property *of the artifact* (which tier this bundle is, which
   Sentry project this release reports to). Everything else — anything the installing user, the
   machine, or an operator might need to change — is runtime. A value that is frozen and unset is
   invisible; a value that is read at runtime and unset can at least say so.
2. **If it is build-time, add it to `build.rs:32-42` (Rust) *and* to the `env:` block of the workflow
   step that builds the artifact it belongs to — in the same change, and to the right one.** There
   are two, and they are not interchangeable: a **frontend** (`VITE_*`) variable belongs on
   `release.yml:193-198` and **only** there, because `beforeBuildCommand: ""` at `:320` means the
   `tauri-action` step compiles no TypeScript; a **native** (`option_env!`) variable belongs on
   `:298-307`, where cargo runs. Putting a frontend variable on the native step produces a green
   pipeline that silently ignores it — B3 is that mistake already in the tree. **If you cannot name
   the workflow line that will set it, it is not a build-time value** — it is a value that will be
   absent in production forever.
3. **If it is runtime, resolve it through the `resolve_env_value` shape**, not a bare `env::var`.
   Compile-time under runtime under `.env`, emptiness-filtered at every layer, with the alias list in
   one array.
4. **Write the default as a named constant next to the declaration, or refuse.** If the feature
   cannot work without the value, do not invent one — return a typed error naming the variable, the
   way `mcp_server/tools.rs:47` does (*"PERSONAS_DRIVE_ROOT is not set — this MCP server was …"*).
   A silent literal at the read site is the defect this leaf is about.
5. **Use `||`, never `??`, and validate the domain.** For an enumerated value
   (`starter|team|builder`) the check is one `includes()`; for a URL, `new URL()`; for a port, a
   range. Absence and illegality are different failures and both must be visible.
6. **If the value is a credential, stop and re-read [app-settings-store §4 step 1](./app-settings-store.md).**
   The environment may be where the secret *arrives* — that is what `foraging.rs` is for — but the
   Vault or the OS keyring is where it lives. Never `option_env!` a secret: it becomes a plaintext
   literal in the shipped binary. Never `set_var` a secret: every child process inherits it.
7. **If the value decides a security posture, make it fail-closed and name the incident.** Copy
   `crypto.rs:463-469` exactly: an enum, one parse site, `Deny` as the `_` arm, a doc comment.
8. **Document it in `.env.example` in the same commit, and say which half it belongs to** —
   development-only, CI-only, or shipped. The file already does this well for four values and is
   wrong about a fifth (§7 C1).
9. **Then stop.** No second resolver for a value that already has one (there are three for
   `SUPABASE_URL`). No `set_var` after the runtime has started (§7 D1). No `env!("CARGO_MANIFEST_DIR")`
   in a code path that runs on an installed machine.

### Can the primitive's signature make the wrong call impossible? — answered, and the answer is yes twice

The [contract](../golden-path-contract.md) requires this before §9. **For this leaf there are two
type-level fixes, and one of them is already in the repo working correctly on a different variable —
which is the strongest possible evidence it is obtainable rather than a wish.**

- **A build-time value should be a `define`, not an env read. YES — and `VITE_PLATFORM` proves it.**
  `vite.config.ts:222-224` computes the value in the config and injects it, so `import.meta.env.VITE_PLATFORM`
  cannot be absent, cannot be empty, and cannot be typo'd — there is no environment lookup left to
  fail. `VITE_APP_TIER` is the same *kind* of value and does not do this. Moving it to a `define`
  that reads `process.env.VITE_APP_TIER`, **validates it against `TIERS`, throws at config time if it
  is set-and-illegal, and defaults to `builder` otherwise**, converts every failure mode in §7 A into
  a build that either produces the right bundle or does not produce one. The `??`-vs-`||` question
  disappears because the config, not the call site, decides. Cost: ~8 lines in `vite.config.ts`
  and deleting one line from `uiModes.ts`. **This is the fix; the census rule below is the ratchet
  that holds the line until it lands.**
- **`BUILD_MAX_TIER` should not be typed by a cast. YES, and it is nearly free.** `uiModes.ts:41`
  says `import.meta.env.VITE_APP_TIER as Tier | undefined` — an assertion, so `"pro"` and `""`
  type-check. Replace it with a parse: `const t = import.meta.env.VITE_APP_TIER; export const
  BUILD_MAX_TIER: Tier = isTier(t) ? t : TIERS.BUILDER;` with `isTier` a one-line predicate over
  `Object.values(TIERS)`. That alone removes the all-hidden bundle, at every value, forever — and
  unlike the `define` it needs no build-tooling change.
- **A Rust config read should not return `Result<String, VarError>`.** The 127 read sites each
  re-derive presence, emptiness, parsing and the default because `env::var` hands back the least
  informative type available. A `Setting`-shaped descriptor — the same answer
  [app-settings-store](./app-settings-store.md) reached for its own registry — with
  `env_or(&DESCRIPTOR)` returning `T` would collapse them, and the descriptor list *is* the
  declaration §3 says does not exist. **This is real work and should follow the two cheap fixes, not
  block them.**

## 5 Anti-patterns

- **Defaulting an environment read with `??`.** It distinguishes unset from empty when the platform
  does not. **1 site in `src/`, and it is `VITE_APP_TIER`** — the variable that decides the whole
  entitlement story. 3 more in `scripts/`. The repo holds the correct operator 51 times across 29
  files (§9's positive control), including on the sibling variable in the sibling file.
- **Adding an `env:` entry whose expression may be blank, to satisfy a missing-writer bug.** A
  GitHub Actions `env: X: ${{ vars.Y }}` with `Y` unset sets `X` to the empty string. Combined with
  the previous anti-pattern that is strictly worse than not setting it at all.
- **`option_env!` on a value no workflow sets.** Six of `build.rs`'s nine forwarded names are
  supplied only by the operator's gitignored `.env`, so the capability exists on the developer's
  machine and in no installer — and, worse, the *developer's* build has the real credentials baked
  in as plaintext literals while the shipped one has none (§7 B1). The direction of that asymmetry
  is exactly backwards from what anyone intends.
- **Two resolvers for one value, one of which is a comment claiming to mirror the other.**
  `cloud/sync/client.rs:17-19` says *"Mirrors the resolution in `commands/infrastructure/auth.rs`"*
  and then guards `!url.is_empty()` where `auth.rs:157` does not — **and `auth.rs` caches the result
  in a `OnceLock`**, so an empty compile-time value is cached for the life of the process (§7 B2).
- **A silent literal default on a URL, a key, or a path.** `unwrap_or_else(|_|
  "http://localhost:11434")` for `PERSONAS_DELEGATE_BASE_URL` (`mcp_server/tools.rs:156`) turns "you
  set the model but not the endpoint" into a connection-refused with no diagnostic — and the
  availability gate 900 lines away (`:1054-1055`) admits the tool when **either** variable is
  present, so that combination is reachable by design.
- **Casting an env value to a union type.** `as Tier` makes the compiler agree that `""` is a tier.
  Every unchecked cast on a config value is a validation you decided not to write.
- **`std::env::set_var` after the async runtime is up.** `lib.rs:1726-1727` runs inside
  `tauri::async_runtime::spawn_blocking`, with at least five other tasks already spawned
  (`:1474`, `:1495`, `:1516`, `:1612`), and its comment reads *"Set once at startup; edition 2021 →
  set_var is safe."* Edition 2021 makes the call **syntactically** safe; it does not make it sound.
  Concurrent `setenv`/`getenv` is a data race in glibc and musl — which is precisely why Rust 2024
  marked it `unsafe` — and this tree calls `env::var` from 127 places.
- **Putting a credential in the process environment.** `lib.rs:1726` `set_var("PERSONAS_API_KEY",
  &key)` publishes a live key to **every child process the engine will ever spawn**, not just the
  intended sidecar. The repo's own `foraging.rs` scans process environments looking for exactly this
  shape.
- **`env!("CARGO_MANIFEST_DIR")` in production code.** It freezes the *build machine's* absolute
  path into the binary. Two of the eleven sites are outside `#[cfg(test)]`; both are honest about it
  (§6), but the string is in every shipped executable regardless.
- **A `.env` that the shipped app reads.** `lib.rs:553` calls `dotenvy::dotenv()` at startup, which
  searches upward **from the current working directory**. Whatever a `.env` next to the installed
  executable says becomes process configuration — including the three crypto switches (§7 D2).
- **Documenting an override that the build overrides.** `.env.example` tells you to set
  `VITE_PLATFORM` for mobile builds; `vite.config.ts:223`'s `define` wins and discards it. Proven by
  execution (§7 C1).

## 6 Evidence

**Adoption, measured.** 127 Rust runtime reads across 963 files (57 literal names + 6 distinct
dynamic expressions) · 11 `option_env!` compile-time reads across 4 files · 33 `env!` reads (22
`CARGO_PKG_VERSION`, 11 `CARGO_MANIFEST_DIR`) · 41 `set_var` sites of which **4 are production** · 7
`import.meta.env.VITE_*` reads across 4 files (+93 `DEV`/`PROD`/`MODE` builtins) · 9 names forwarded
by `build.rs` · 53 `ENV_PATTERNS` declared for the Vault import path · **32 names in the operator's
gitignored `.env`**, **4 in the committed `.env.example`**.

- **`src-tauri/engine/src/google_oauth.rs:5-64` — copy this file.** Three functions that between them
  answer every question this leaf asks: `env_var_first_nonempty` (aliases + emptiness),
  `dotenv_var_first_nonempty` (a hand-rolled `.env` reader that trims quotes and skips comments), and
  `resolve_env_value` layering compile-time under both. It is the only complete resolution chain in
  the repo and it is used for all six Google/Microsoft OAuth values.
- **`src-tauri/build.rs:43-50`** — the best-reasoned comment about environment configuration in the
  repo, and it is about a second-order failure most people never reach: `cargo:rerun-if-env-changed`
  per key, because *"a cached build-script output silently ships the previous (or empty) value.
  swatinem/rust-cache restores `target/` across CI runs, making this a live release hazard rather
  than a theoretical one."* Every forwarded value should be declared with this much care.
- **`src-tauri/core/src/crypto.rs:130-137, 450-481` — the security-switch reference.** Three
  environment variables, each an explicit opt-in to a weaker path, each fail-closed, each with the
  bug-hunt incident number in the doc comment. `:131-134` states the threat model in four lines:
  *"The separator-less dispatch is attacker/frontend-controllable, so a downgraded or malicious
  renderer can force every credential write down this weaker, unauthenticated-transport RSA-only
  branch."* And the rejection path still increments a counter and warns, so the retirement plan has
  telemetry. This is the spine's "documented, typed and not a backdoor" done properly.
- **`src-tauri/src/commands/credentials/foraging.rs:180-217, 815-845`** — the env→Vault doctrine as
  code. `mask_value` on the line after the read; the plaintext dropped at scope end with the comment
  saying so; the winning variable name encoded into the foraged id so import re-reads *that* one,
  with a comment explaining the last-writer-wins bug that motivated it (`:820-826`). This is what
  "`.env` is runtime-only, the Vault is the source of truth" looks like when it is implemented rather
  than asserted.
- **`src-tauri/src/engine/http_engine/secrets.rs:50-77`** — resolution order for a credential
  (profile → keyring → env), the env branch guarded `!v.is_empty()`, and a presence-only public API.
- **`src/lib/sentry.ts:172-181`** + **`.env.example:26-34`** — the two halves of one decision, and
  they agree. The code refuses a DSN outside `PROD`; the example file explains *why you should not
  set it locally even so* (**"keeping the values out of `.env` avoids baking the DSN into
  locally-built binaries"**) — which is the one place in the repo that names the local-build
  embedding hazard §7 B1 is about.
- **`vite.config.ts:222-224` + `src/lib/utils/platform/platform.ts:11-13`** — a build-time value with
  no way to be absent. See §4.
- **`src-tauri/src/companion/dev_mode.rs:21-31`** — the honest `env!("CARGO_MANIFEST_DIR")`: a doc
  comment that says exactly what the value means (*"The repo root of the source checkout this binary
  was built from … correct exactly in the dev-build-from-checkout scenario dev mode is gated to"*)
  and a module that is debug-build-only. If you must freeze a build-machine path, freeze it like
  this.
- **`src-tauri/engine/src/team_preset_loader.rs:76-99`** — the defensive form: the frozen path is the
  *third* candidate, `.is_dir()`-checked, behind two relative ones, with a documented fallback that
  returns an empty result rather than panicking.

## Convergence — three siblings, and a controlled experiment the fleet ran without meaning to

Read-only sweep, 2026-08-15, of **`../personas-cloud`** (a deployed service — Node orchestrator +
FastAPI facade; env config is its native idiom, which is why the asymmetry below is the interesting
result), **`../brainiac`** (Rust workspace + Next.js console, docker-compose) and
**`../personas-web`** (Next.js App Router). No values read; names, shapes and counts only.

| | **personas** (this repo) | personas-cloud | brainiac | personas-web |
|---|---|---|---|---|
| Distinct env names read | **67** | 32 | **98** | 29 |
| **Central typed declaration** | **none** | **YES** — `orchestrator/src/config.ts:3-35` (21 fields), `worker/src/config.ts:4-12` (5), `facade/config.py:6-28` (6) | **none** | **none** (`src/lib/server/env.ts` names 2 of 29; `getRequiredEnv` has **0** callers) |
| **Fail-fast boot validation** | **none** | **YES** — `config.ts:85-221`, aggregate multi-error throw, 4 cross-field rules | partial — compose `${VAR:?}` ×9 | partial — 1 variable, and it **skips itself when absent** (`instrumentation.ts:19-20`) |
| **Unset ≠ empty: sites that distinguish** | **1** (`build.rs:53`) *+ 3 `\|\|`* | **1** — and it only changes a log line | **12** `.filter(!is_empty)` + 8 console, doctrine stated at `analytics.rs:117` | **1** |
| **A test asserting the rule** | none | none | **YES** — `analytics.rs:228-240` | none |
| **Machine gate on the contract** | **none** | **none** (no `.github/` at all) | **YES** — `deploy-test.yml:60-105` boots the whole stack from generated secrets | **none** |
| Secret baked into a shipped artifact | **yes** — 4 credential-shaped `option_env!` (§7 B1) | no (no bundler) | no — 4 `NEXT_PUBLIC_*`, all publishable IDs, from CI `vars.*` | **yes — `NEXT_PUBLIC_TEAM_API_KEY`** in the browser bundle |
| Env as inbound tier, second store for secrets | **YES** — Vault + keyring, `foraging.rs` is the handoff | **YES** — PBKDF2-600k → AES-256-GCM in SQLite; env holds only `MASTER_KEY` | **YES** — env is bootstrap, `api_tokens` table is steady state; `first-boot.sh` tells the operator to delete the env line | **no** — env is the only store |
| Read but never set anywhere | **44** (36 app-owned) | 8 | **53** | 7 |

**Physics — independently reinvented, so these clauses travel.**

- **"A variable is read and set nowhere" is not a Personas defect; it is what happens to every
  codebase that configures itself through an environment.** Four independent repos, four orphan
  populations. **And in three of the four the sharpest orphan is a build-time-inlined value that
  silently disables a capability** — `VITE_APP_TIER` here (every installer is the builder bundle);
  `NEXT_PUBLIC_FIREBASE_API_KEY`/`_AUTH_DOMAIN`/`_PROJECT_ID`/`_APP_ID` in brainiac (no
  `console/Dockerfile` `ARG`, no `release.yml` build-arg, so **Google sign-in cannot be enabled in
  any image that repo's own pipeline builds**); `NEXT_PUBLIC_DATA_SOURCE` in personas-web (two
  production branches on `=== "supabase"`, no writer, dead in every build). Same shape, three
  languages, three build systems, no shared document. **This is the strongest form the oracle can
  take and it confirms the brief's premise outright.**
- **"CI builds the artifact with its build-time variables absent."** `personas-web/.github/workflows/ci.yml`
  contains **no `env:` block at all** — `npm run build` at `:31` and Playwright at `:46` inline
  `undefined` for all **18** `NEXT_PUBLIC_*` names, so its whole e2e suite exercises a build that
  cannot match production. Personas' `release.yml` omits `VITE_APP_TIER` and six of nine
  `build.rs` names. Two repos, same hole. **brainiac is the only one that does it right** —
  `release.yml:56-59` passes four build-args with a fifteen-line comment explaining why — and even
  brainiac forgot four.
- **Unset vs empty is a real distinction that a codebase discovers on its own.** brainiac states it
  as doctrine (`crates/brainiac-server/src/analytics.rs:117`: *"Blank is treated as unset so a
  half-filled `.env` can never half-enable telemetry"*), implements it in a **shared helper** every
  provider credential flows through (`providers/mod.rs:59-61`), and **locks it with a unit test**
  (`analytics.rs:228-240`, asserting `"   "` ⇒ `None`). Nobody wrote that down for them. §2's
  "`??` is the wrong operator, always" and §9 rule 1's whole condition are therefore **physics, not
  house style** — and Personas has the correct form in exactly one place (`build.rs:53`) where
  brainiac has twenty.
- **"The environment is where a secret arrives, never where it lives."** **3 of 3 siblings**, plus
  this repo. cloud keeps one root `MASTER_KEY` in env and everything else PBKDF2-600k/AES-256-GCM in
  SQLite; brainiac treats `BRAINIAC_TOKENS` as an explicit *bootstrap tier* whose `first-boot.sh`
  mints a scoped DB key and instructs the operator to **delete the env line**; Personas has the Vault
  plus `foraging.rs`'s mask-and-import. **The operator's recorded doctrine is confirmed by the whole
  fleet.** The one sibling that does not have a second store (`personas-web`) is also the one that
  shipped a server bearer secret to every visitor's browser.

**A result that contradicts this document's own §3, and it is the most useful thing the sweep
produced.** §3 lists "a declaration of the environment contract" under *do not exist — this path
defines them*. **personas-cloud already has one**, and it is better than what §9 asks for: three
typed interfaces (21 + 5 + 6 fields) loaded by a single `loadConfig()`, and a real
`validateConfig()` at `config.ts:85-221` that accumulates errors and throws a numbered aggregate,
enforcing four *cross-field* rules a per-variable schema could not express. So the declaration is
obtainable, proven, and sitting one directory away.

**And yet — no repo in the fleet has both halves.** cloud has the only declaration and the only boot
validator, and **no CI whatsoever** to run either (no `.github/`, no test script; its deployed
`facade/` is not even tracked in git, and copying its own `.env.example` verbatim produces a config
that refuses to boot). brainiac has the only real machine gate and **no declaration at all** — 98
variables from 65+ scattered call sites. personas-web has neither. **That is a controlled experiment
the fleet ran by accident, and its result is the argument for §9's refusal**: the checker specified
there is not an invention, it is the *union of two siblings' proven halves* — cloud's typed
declaration plus brainiac's CI that refuses to proceed without it — and the reason to build it is
that four codebases have each built one half and none has built both. A declaration nothing runs
drifts; a gate with nothing to check checks the deploy only.

**Local calibration — the proxy, not the condition.** `option_env!`-into-a-Rust-binary is
Personas-specific: brainiac's Rust workspace has **zero** `option_env!` and its only `env!` uses are
`CARGO_*`; personas-cloud has no bundler at all. But the *condition* rule 2 gates — a config value
frozen when the artifact is built — is reinvented in two of three siblings as `NEXT_PUBLIC_*`
inlining and Docker `ARG`→`ENV`. **The condition is physics; the markup is local**, which is exactly
what that rule's `PRECONDITION` clause says and why the clause is there.

**One correction offered upstream to a sibling.** `personas-web/src/lib/api.ts:89-91` reads
`NEXT_PUBLIC_TEAM_API_KEY` and sends it as an `Authorization: Bearer` header from a module imported
by five client-side Zustand stores and hooks — so it is inlined into the browser bundle. In
`personas-cloud`'s own `.env.example` that same variable is the shared team secret
(`openssl rand -hex 24`), compared with `timingSafeEqual` at
`packages/orchestrator/src/auth.ts:104-113`. `personas-web/.env.example:3` states the rule — *"All
`NEXT_PUBLIC_*` vars are inlined into the client bundle at build time — never put secrets here"* —
and line 20, twelve lines below, declares it. **A prose warning in the same file as its own
violation is the failure mode this leaf's §9 exists to replace**, and it is also the precise reason
Personas' equivalent surface is clean: its four `VITE_*` names carry no secret, because its secrets
went to `option_env!` and the Vault instead. Personas is ahead of its sibling here — and behind
brainiac on every question about emptiness.

## 7 Deviations found

**Four categories, 14 individually-addressable items.** Every one of them ships green under
`npm run check`, `npm run check:tiers`, and all of CI.

### A. The tier value — a read with no writer, and an operator that makes the fix dangerous — 4

**A1 — `VITE_APP_TIER` is read once and written by nothing on the release path.**
`src/lib/constants/uiModes.ts:41` is the sole read. Writers, tree-wide: `package.json:79-81`
(`build:starter`/`build:team`/`build:builder`), `scripts/check-tiers.mjs:39`, and `README.md:317-318`
(a manual recipe). `release.yml` builds the frontend **once**, at `:193-198`, and does not set it —
and `beforeBuildCommand: ""` at `:320` means no second frontend build exists to set it in. **Every
published installer is the builder bundle.** `ci.yml:146-156` compiles the starter and team bundles
on every change and ships neither, by design (*"the builder tier is NOT built here — the canonical
`npm run build` step below produces it"*). Confirmed from
[tier-and-capability-gating §7 A1](./tier-and-capability-gating.md) and re-measured here by joining
all 67 read names against all writers.

*Ordering hazard in the same block, noted once:* `check:tiers` "writes to `dist/` as a side effect,
so it must run BEFORE the canonical build" (`ci.yml:153-155`), and both steps carry `if: always()`.
If `npm run build` ever fails while `check:tiers` succeeds, the bundle-budget and baseline steps
measure the **team** bundle and report a number for an artifact nobody ships.

**A2 — the read cannot tell "unset" from "empty", and the empty case is catastrophic. Executed.**
A fixture transcribing `uiModes.ts:24-46` verbatim, built six times through the real Vite 8 pipeline,
emitted bundle inspected:

| `VITE_APP_TIER` | inlined literal | `isTierAvailable('starter'/'team'/'builder')` |
|---|---|---|
| *unset* | `TIERS.BUILDER` | `true` / `true` / `true` ← **every shipped installer** |
| `"starter"` | `"starter"` | `true` / `false` / `false` |
| `"team"` | `"team"` | `true` / `true` / `false` |
| `"Starter"` | `"Starter"` | **`false` / `false` / `false`** |
| `"pro"` | `"pro"` | **`false` / `false` / `false`** |
| `""` | `""` | **`false` / `false` / `false`** |

`??` does not fire on `""`; `TIER_RANK[""]` is `undefined`; `n <= undefined` is `false` for every
`n`. A capitalisation slip, a stale value, or a blank Actions expression produces a bundle with no
navigable sections, and nothing — not `tsc`, not `check:tiers`, not any test — would report it.

**A3 — `npm run check:tiers` builds three bundles and asserts nothing about their contents.**
`scripts/check-tiers.mjs:35-44` spawns `vite build` per tier and checks only the **exit code**
(`:39`). It is a compile check wearing a behaviour check's name; per the model-effort guide's own
warning, *a gate that asserts data is not a gate on behavior*. It would pass on all six rows above,
including the three all-hidden ones.

**A4 — the type is asserted, not parsed.** `uiModes.ts:41` casts with `as Tier | undefined`, so the
compiler agrees `""` and `"pro"` are tiers. `TIER_RANK` is a `Record<Tier, number>` with three keys
and no index-miss handling. One predicate fixes the whole of A2 (§4).

### B. Compile-time values — a nine-name contract that CI satisfies three ninths of — 4

**B1 — six of `build.rs`'s nine forwarded names are supplied only by the developer's gitignored
`.env`.** The forwarding list (`build.rs:32-42`) is `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`GCP_CLIENT_ID`, `GCP_CLIENT_SECRET`, `GCP_DESKTOP_CLIENT_ID`, `GCP_DESKTOP_CLIENT_SECRET`,
`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `SENTRY_DSN`. `release.yml` sets **three**
(`SENTRY_DSN` `:195`/`:304`, `GCP_CLIENT_ID` `:306`, `GCP_CLIENT_SECRET` `:307`). The other six are
present in the operator's local `.env` and nowhere else in the repo. Consequences, both directions:

- **Shipped installers**: `option_env!("SUPABASE_ANON_KEY")` → `None` → `auth.rs:180` /
  `client.rs:38` fall to `std::env::var`, which on an end user's machine is also absent → the Supabase
  auth and cloud-sync features return `AppError::Auth("SUPABASE_ANON_KEY not configured…")`.
  Microsoft OAuth and the desktop GCP client have no runtime path at all beyond `.env`.
- **Locally-built installers**: `dotenvy::dotenv()` in `build.rs:26` loads the operator's `.env`, so
  a local `npm run tauri:build` **bakes four real credentials plus two client IDs into the binary as
  plaintext string literals**. `.env.example:26-34` warns about exactly this hazard — for
  `SENTRY_DSN` only.

*(The claim that `option_env!` observes an ambient empty string set in a CI job env — and therefore
that adding these six as `env:` entries has the same blank-expression hazard as A2 — follows from
cargo passing its environment through to `rustc`, and is **not verified by compiling: no cargo
command was run.**)*

**B2 — one value, three resolvers, and the two hand-rolled ones disagree about the empty string.**

| Resolver | `option_env!` empty-guarded? | Caches? |
|---|---|---|
| `engine/src/google_oauth.rs:57-64` (6 values) | **yes**, `.filter(\|v\| !v.is_empty())` | no |
| `src/cloud/sync/client.rs:21-40` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) | **yes**, `if !url.is_empty()` | no |
| `src/commands/infrastructure/auth.rs:154-186` (the same two) | **no** | **yes — `OnceLock`** |

`client.rs:17-19`'s doc comment says it *"Mirrors the resolution in
`commands/infrastructure/auth.rs`"*. It does not: it is strictly stricter. And the *less* strict one
is the one that memoises, so an empty value is cached for the process lifetime.

**B3 — `VITE_SENTRY_DSN` is set on a step where no frontend build runs.** `release.yml:196` is the
one that reaches the bundle. `:305` sets the same variable on the `tauri-action` step, whose `with:`
block carries **`beforeBuildCommand: ""`** (`:320`) — overriding `tauri.conf.json`'s `"npm run
build"` — so that step consumes the `dist/` downloaded at `:288-293` and compiles no TypeScript at
all. The entry is inert. It is harmless today and it is exactly the kind of line that gets *copied*:
the next person adding a frontend variable has a 50% chance of picking the dead block, and nothing
would tell them. **This is the second-order cost of having no declaration** — there is no artifact
that says which build consumes which variable, so the answer lives in one `with:` key three lines
below the `env:` block that contradicts it. *(Note the neighbours at `:306-307`,
`GCP_CLIENT_ID`/`GCP_CLIENT_SECRET`, are correctly placed on this step: the **cargo** build does run
here, and `option_env!` is what consumes them.)*

**B4 — `env!("CARGO_MANIFEST_DIR")` freezes the build machine's absolute path into every shipped
binary.** 11 sites; **2 outside `#[cfg(test)]`** (`engine/src/team_preset_loader.rs:89`,
`src/companion/dev_mode.rs:25`). Both are behaviourally safe — one is `.is_dir()`-guarded as a third
fallback, the other is debug-build-only and says so — but the literal (`C:\…\personas\src-tauri` on
this machine) is a string in the release executable and `strings` will print it. Low severity,
one-line fix (`option_env!` + a runtime fallback), listed because a build-machine path is exactly the
class of value this leaf exists to keep out of artifacts.

### C. Frontend runtime values with no supplier — 3

**C1 — `.env.example` documents a `VITE_PLATFORM` override that the build discards. Executed.** The
file says *"Mobile platform override — only set for Android / iOS builds."* Built through the real
pipeline with a `.env` containing `VITE_PLATFORM=android`: **with** the `define` from
`vite.config.ts:223` the bundle emits `PLATFORM = "desktop"`; **without** it, `"android"`. The
`define` wins. The real switch is `TAURI_ANDROID`/`TAURI_IOS` (`vite.config.ts:15-21`). *(The
mechanism is correct and is §3's model primitive; only the documentation is wrong.)*

**C2 — `VITE_WEBHOOK_BASE_URL` has no writer anywhere.** Read once
(`triggerConstants.ts:210-212`), documented as *"Override via `VITE_WEBHOOK_BASE_URL` env var for
production"*, commented-out in `.env.example`, absent from every workflow and npm script. Every build
resolves `http://localhost:9420`. The **default is defensible** for a local-first app whose webhook
listener binds locally (`engine/webhook.rs:46`, `PERSONAS_WEBHOOK_PORT` → `9420`), and the code even
exports `IS_WEBHOOK_LOCALHOST` to warn about it — so this is a **documentation defect, not a
behaviour one**: the comment promises a production override with no mechanism behind it. Fix the
comment or wire the variable; do not leave the promise.

**C3 — `VITE_DEVELOPMENT` is a frontend-namespaced variable read only by the Rust backend at
runtime.** `src/commands/execution/healing.rs:115` and `src/engine/mod.rs:2906`
(`cfg!(debug_assertions) || env::var("VITE_DEVELOPMENT").as_deref() == Ok("true")`). It is in the
operator's `.env`, in no workflow, and **no `import.meta.env.VITE_DEVELOPMENT` exists anywhere in
`src/`**. A `VITE_`-prefixed name means "inlined into the frontend bundle at build time" to every
reader of this codebase; this one is neither. Rename it `PERSONAS_DEV_MODE` or delete it — its only
effect today is to make `cfg!(debug_assertions)` overridable from the environment of a release build,
which is a capability nobody asked for.

### D. Runtime reads — 127 statements, and not one of them fails loudly — 3

Shape of every `env::var`/`var_os` statement, classified with its consequent (implementation B):

| Shape | Count | What happens when the variable is absent |
|---|---:|---|
| `if let Ok(v) = …` guard | 35 | a different path is taken, silently |
| `let Ok/Some(v) = … else` / destructure | 20 | " |
| `.ok()` → `Option` | 21 | " |
| `.is_ok()` / `.is_ok_and(…)` presence-only | 10 | " |
| `match` | 4 | " |
| **`.unwrap_or_else(\|_\| <literal>)`** | **7** | **a literal default is invented at the read site** |
| **`.unwrap_or(<literal>)`** | **5** | " |
| **`.unwrap_or_default()`** | **4** | " |
| `.expect(…)` — panics | 4 | **all four are inside `#[cfg(test)] #[ignore]` harnesses** |
| `.map_err(…)` → typed error naming the variable | 7 | **the only shape that reports a misconfiguration** |
| other (`?`, `.or_else`, comparison) | 10 | mixed |

**D1 — `set_var` on a live multithreaded runtime, carrying a credential.** `src/lib.rs:1726-1727`,
inside `tauri::async_runtime::spawn_blocking`, after five other tasks are spawned. The comment
asserts *"edition 2021 → set_var is safe"* — true of the *syntax*, not of the *semantics*; Rust 2024
made this `unsafe` precisely because concurrent `setenv`/`getenv` is a data race on glibc/musl, and
this tree reads the environment from 127 places. It also publishes a live `PERSONAS_API_KEY` to every
subsequently-spawned child process, not only the intended sidecar. The other 3 production `set_var`
sites (`lib.rs:547` `ORT_DYLIB_PATH`, `logging.rs:231` `RUST_BACKTRACE`) run before the builder
starts and are fine; the remaining 37 are in tests.

**D2 — the shipped app loads a `.env` from the current working directory, and three of the variables
it can set turn off crypto guards.** `src/lib.rs:553` `dotenvy::dotenv().ok()` searches upward from
the CWD at startup; `engine/src/google_oauth.rs:20-54` independently reads `.env`, `../.env`,
`../../.env` relative to the CWD when resolving OAuth **credentials**. A `.env` in that search path
can set `PERSONAS_ALLOW_LEGACY_IPC=1` (re-enables the unauthenticated RSA IPC branch
`crypto.rs:130-146` was written to reject), `PERSONAS_ALLOW_FALLBACK_KEY=1` (drops the fail-closed
OS-keychain requirement, `crypto.rs:463-469`), or `PERSONAS_MIGRATE_LEGACY_KEY=1` (accepts any
32-byte file as the master key — the exact bug-hunt 2026-06-07 #2 threat, *"an attacker who can write
the app-data dir plant a known key"*). **Scoped honestly:** this is not remote-exploitable, and the
NSIS installer's default per-user target (`%LOCALAPPDATA%\Programs`) is already user-writable, so an
attacker at that privilege level has better options. It is a defence-in-depth gap with a cheap fix —
**refuse to honour the three `PERSONAS_ALLOW_*`/`MIGRATE` switches in a release build**
(`#[cfg(debug_assertions)]`, or require a second signed marker), which costs nothing because their
only documented use is CI, headless and migration runs.

**D3 — 44 of the 67 read names have no writer anywhere in the repo.** Broken down, because the raw
number overstates it:

| Class | Count | Verdict |
|---|---:|---|
| OS-provided (`PATH`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `XDG_CONFIG_HOME`, `SYSTEMROOT`) | 7 | fine — the OS is the writer |
| test-harness-only (`PERSONAS_MAP_*` ×4, `PERSONAS_SCRIPTED_TOOL_TESTS`, `UPDATE_RENDER_PLAN_FIXTURES`, `UPSTASH_TEST_*` ×2) | 8 | fine — `#[cfg(test)] #[ignore]`, documented in the test's own doc comment |
| `VITE_*` | 2 | §7 C1, C2 |
| **app-owned runtime switches in shipped code** | **27** | **the finding** |

The 27 are escape hatches whose only definition anywhere is the read itself — `PERSONAS_ATHENA_MODEL`,
`PERSONAS_BUILD_ORCHESTRATION`, `PERSONAS_DELEGATE_{BASE_URL,MODEL,API_KEY,AUDIT}`, `PERSONAS_FOLLOWER`,
`PERSONAS_DATA_DIR`, `PERSONAS_RUN_BUDGET_ENFORCE`, `PERSONAS_SMEE_WEBHOOK_SECRET`, `PERSONAS_MCP_TOKEN`,
`DASHSCOPE_API_KEY`, the three `crypto.rs` switches (§7 D2), … Each is individually defensible;
collectively they are **27 undocumented switches on a shipped desktop application**, discoverable
only by reading Rust, of which at least 3 change a security posture, 4 change model selection or
spend, and 5 are credential- or token-shaped. **`.env.example` documents 4 names.** That gap —
27 vs 4 — is the leaf's structural finding, and it is what §9's refusal is about. *(Note this is a
floor: six read sites take a non-literal argument, one of them iterating `foraging.rs`'s 53-entry
table, so the true read surface is larger than 67 and no textual method can enumerate it.)*

## 8 Gaps in the primitive

1. **`std::env::var` returns the least useful type available.** `Result<String, VarError>` carries no
   default, no domain, no name for the error message, and no opinion about the empty string. Every
   one of the 127 read sites re-derives all four, which is why there are eleven distinct shapes in
   the D table.
2. **`option_env!` is unconditional and undiagnosable.** It resolves to `None` identically whether
   the value was never configured, was configured empty, or was dropped by `build.rs:53`'s emptiness
   guard. Nothing at compile time can say "this build is missing a value it was supposed to have",
   because nothing declares what it was supposed to have.
3. **Vite's `import.meta.env` is a string bag with no schema.** There is no `env.d.ts` declaring the
   `VITE_*` surface, so `import.meta.env.VITE_APP_TEIR` type-checks as `any` and inlines
   `undefined`. `define` is the only mechanism that can fail loudly, and it is used for one variable.
4. **There is no declaration of the contract, at either layer.** `build.rs`'s nine names cover the
   compile-time Rust half only. No file lists what the frontend build needs, what the running app
   reads, or which of those are required versus optional. This is upstream of gaps 1-3 and of every
   deviation in §7 A and B: you cannot check a contract that was never written.
5. **`.env.example` is documentation, not a manifest.** It names 4 values (plus 4 more in comments)
   against 67 read names, and nothing relates the two. Its four prose sections are genuinely
   good — they are the best writing about configuration in the repo — but a file nothing parses
   cannot fail.
6. **`dotenvy::dotenv()` has no root argument.** It resolves relative to the process CWD, which a
   desktop application does not control and which its launcher can set arbitrarily. There is no way
   to say "load the `.env` next to *my data directory*" without replacing the call.
7. **Cargo cannot require an environment variable.** A `build.rs` can `panic!` when one is missing,
   but that would break every developer build; there is no "required in release profile only"
   declaration, so the nine-name list can only ever be advisory.
8. **The census runner cannot join a reader to a writer.** It counts occurrences within one file. "A
   variable read but never set" — the shape of this entire leaf — is a relational property across
   `src/`, `src-tauri/`, `.github/`, `package.json` and `.env.example`. §9 refuses it explicitly and
   names the checker that can express it.

## 9 The missing gate

### The semantic conditions, stated first

Three, each stack-free:

> **(A)** A configuration read treats **unset** and **set-to-empty** as different states, when the
> mechanism delivering the value makes them the same.
> **(B)** A configuration value is resolved when the artifact is **built** rather than when it
> **runs**, so it cannot be changed by whoever installs it, and a build that omitted it produces a
> silently different product rather than a reported misconfiguration.
> **(C)** A variable is **read** in one place and **set** in none, so the contract between the code
> and the pipeline that feeds it exists only in a developer's memory.

What follows are **one repo's proxies** for (A) and (B), and an explicit **refusal** for (C). Per the
[portability test](../research/portability-test.md), a proxy does not travel: an adopting repo
inherits the three sentences and re-derives its own signals against its own configuration idiom. Each
rule states the precondition its proxy depends on.

### Mechanism — census rules, not scripts

Per the [contract](../golden-path-contract.md) §"Don't write a script", the ratcheting-baseline
mechanism lives once at [`scripts/census/`](../../../scripts/census/), and `npm run census:check` is
already inside `npm run check`, so this lane is live with no new wiring.

**Checked first that none of the 71 existing rules covers these conditions.** The three nearest were
opened and read: `build-gated-ipc-entrypoint` keys on `#[cfg]` in `generate_handler![]` (existence,
not values); `settings-key-holding-secret` keys on `pub const …_API_KEY: &str` inside
`src-tauri/db/src` (the settings registry, not the environment); `undeclared-tier-branch` keys on
destructuring `useTier()`'s booleans (where a tier is *consumed*, not where its value *comes from*).
No rule matches `import.meta.env`, `process.env`, `option_env!`, `env!` or `env::var` anywhere.

Published below as fenced JSON for the orchestrator to merge — **never edited into `rules.json`
here**, per the contract's concurrent-writer warning.

```json
{"rules":[
  {
    "id": "env-default-conflates-unset-with-empty",
    "goldenPath": "docs/concepts/golden-paths/environment-variable-configuration.md",
    "title": "An environment-derived value is defaulted with `??`, so a variable SET TO THE EMPTY STRING silently defeats the default",
    "roots": ["src", "scripts"],
    "extensions": [".ts", ".tsx", ".mjs", ".js"],
    "signal": {
      "pattern": "(?:import\\.meta\\.env\\.[A-Za-z_][A-Za-z0-9_]*|process\\.env(?:\\.[A-Za-z_][A-Za-z0-9_]*|\\[[^\\]\\n]{1,60}\\]))[^;\\n]{0,120}?\\?\\?",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a read of an environment-derived value whose fallback is supplied by the nullish-coalescing operator `??`. PROXY FOR the stack-free condition: \"a configuration read treats UNSET and SET-TO-EMPTY as different states, when the platform delivering the value makes them the same.\" `??` fires only on null/undefined, so an empty string flows through as if it were a deliberate choice. Both delivery mechanisms in this repo produce empty strings routinely: GitHub Actions renders an env: entry whose expression is blank (an unset secret or repository variable) as a SET, EMPTY variable, and a `.env` line `NAME=` does the same. MEASURED BY EXECUTION 2026-08-15 against the real Vite 8 pipeline on a fixture transcribing src/lib/constants/uiModes.ts:24-46 verbatim: with VITE_APP_TIER unset the build inlines `TIERS.BUILDER` (every section visible - this is what every published installer is); with VITE_APP_TIER=\"\" it inlines the literal \"\" and TIER_RANK[\"\"] is undefined, so isTierAvailable returns FALSE for starter, team AND builder - a bundle in which no tier is available at all. The obvious fix for the missing-writer bug (add `VITE_APP_TIER: ${{ vars.APP_TIER }}` to release.yml) therefore lands on the WORSE side of this operator if the variable is unset. The single match in src/ is that exact line, uiModes.ts:41. THE REPO ALREADY HOLDS THE CORRECT FORM THREE TIMES, which is why this is a defect and not a house style: src/lib/sentry.ts:180 `dsn: dsn || undefined`, src/lib/utils/platform/triggerConstants.ts:212 `(import.meta.env.VITE_WEBHOOK_BASE_URL as string|undefined) || 'http://localhost:9420'`, and src-tauri/build.rs:53 `if !val.trim().is_empty()` guarding the forward to rustc. LEGAL FIX: `||` (or an explicit `trim() === '' ? default : value` when a legitimate empty value exists), plus validation that the resulting value is a member of the allowed set - `??` alone would still admit VITE_APP_TIER=\"pro\", which the same executed fixture showed produces the identical all-hidden bundle. PRECONDITION (must be re-derived per repo): this repo delivers build-time frontend config through Vite's `import.meta.env` and build tooling through `process.env`, and writes its fallbacks inline at the read site. A repo that parses its environment once through a schema (zod, pydantic, serde/envy) has this condition in a form this pattern cannot see - and probably does not have it at all, because a schema decides unset-vs-empty once."
    },
    "exclude": [
      {
        "path": "scripts/.archived/**",
        "reason": "retired scripts kept for reference only — they are not run by any npm script, hook or workflow, so a defaulting bug in them cannot reach a build. Cost of the exemption: a genuine env-default bug introduced in an archived script would not be counted, which is acceptable because nothing executes them."
      }
    ],
    "baseline": { "files": 4, "matches": 4 },
    "floor": 4000
  },
  {
    "id": "config-value-frozen-at-compile-time",
    "goldenPath": "docs/concepts/golden-paths/environment-variable-configuration.md",
    "title": "A configuration value is baked into the binary by option_env!, so the shipped artifact cannot be reconfigured and a build that omitted the value is indistinguishable from one that had it",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "option_env!\\s*\\(\\s*\"[A-Z][A-Z0-9_]*\"\\s*\\)",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a compile-time environment read. PROXY FOR the stack-free condition: \"a configuration value is resolved when the artifact is BUILT rather than when it RUNS, so the value cannot be changed by whoever installs it, and a build that omitted the value produces a binary that is silently missing a capability rather than one that reports a misconfiguration.\" In this repo the values arrive through src-tauri/build.rs:32-57, which forwards NINE names from the process environment (and from a dotenvy-loaded .env) to rustc via `cargo:rustc-env`. MEASURED 2026-08-15 by joining every reader against every writer: of those nine, .github/workflows/release.yml sets exactly THREE in its env: blocks (SENTRY_DSN at :195/:304, GCP_CLIENT_ID at :306, GCP_CLIENT_SECRET at :307). The remaining six - SUPABASE_URL, SUPABASE_ANON_KEY, GCP_DESKTOP_CLIENT_ID, GCP_DESKTOP_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET - are written ONLY by the operator's gitignored .env, so they are present in every locally-built installer and absent from every CI-built one. That is the inverse of what you want: the artifact that ships has no credentials and the artifact built on a developer's machine has the real ones frozen into it as plaintext string literals. FOUR of the eleven live matches are credential-shaped by name (GCP_CLIENT_SECRET at engine/src/google_oauth.rs:81, GCP_DESKTOP_CLIENT_SECRET at :121, MICROSOFT_CLIENT_SECRET at :141, SUPABASE_ANON_KEY at src/cloud/sync/client.rs:34 and src/commands/infrastructure/auth.rs:177), which is why this rule is a RATCHET on a number that must never rise quietly: every increment is one more secret compiled into a shipped executable. The comment filter is load-bearing and demonstrably so - src-tauri/build.rs:24 contains the literal `option_env!(\"SUPABASE_URL\")` inside a doc comment explaining the mechanism, so without ignoreCommentLines the prose about the design would be counted as an instance of it. LEGAL DESTINATION, and it already exists: engine/src/google_oauth.rs:57-64 `resolve_env_value(compile_time, runtime_keys)` layers compile-time UNDER runtime env UNDER .env files and filters an empty string out at every layer, so a build that omitted the value still resolves at runtime and a value set-but-empty never wins. Six of the eleven matches already go through it. The other five hand-roll the chain twice more, and the two hand-rolls disagree: src/cloud/sync/client.rs:22,:34 guard `!url.is_empty()` while src/commands/infrastructure/auth.rs:157,:177 do not - and auth.rs caches the result in a OnceLock, so an empty compile-time value is cached for the life of the process. PRECONDITION (must be re-derived per repo): this repo freezes config with Rust's option_env! macro fed by a build script. A repo that freezes config with a bundler define, a Next.js NEXT_PUBLIC_ inline, a Docker build-arg, or a generated constants file has the identical condition wearing different markup and scores zero here."
    },
    "baseline": { "files": 4, "matches": 11 },
    "floor": 900
  },
  {
    "id": "env-default-truthy-positive-control",
    "goldenPath": "docs/concepts/golden-paths/environment-variable-configuration.md",
    "title": "POSITIVE CONTROL — not a rule; the SAME anchor pointed at the COMPLIANT operator, to prove rule 1 discriminates on the operator and not on the env read",
    "roots": ["src", "scripts"],
    "extensions": [".ts", ".tsx", ".mjs", ".js"],
    "signal": {
      "pattern": "(?:import\\.meta\\.env\\.[A-Za-z_][A-Za-z0-9_]*|process\\.env(?:\\.[A-Za-z_][A-Za-z0-9_]*|\\[[^\\]\\n]{1,60}\\]))[^;\\n]{0,120}?\\|\\|",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "POSITIVE CONTROL — the merger must SKIP this entry (no baseline, `positive-control` id suffix). It is `env-default-conflates-unset-with-empty` with `\\?\\?` replaced by `\\|\\|` and NOTHING else changed, so it matches the compliant sites the real rule must NOT match: src/lib/sentry.ts:180, src/lib/utils/platform/triggerConstants.ts:212, src/lib/utils/platform/platform.ts:12 and the import.meta.env.DEV disjunctions. Its purpose is to prove the discriminator is the OPERATOR rather than the presence of an environment read at all — a matcher that keyed on `import.meta.env` and drifted into matching every read would show up here as the two populations converging, and a matcher whose anchor rotted would show up here as zero matches over the same 4,982-file walk the real rule uses. It gates nothing about code quality and carries no baseline, because a ratchet is monotone-downward and adoption of the compliant form should be free to rise."
    },
    "floor": 4000
  }
]}
```

### Validation — standalone, then re-extracted from this document and re-run

Run with `node scripts/census/run-census.mjs --rules <scratch>/census-envconfig-4e17d2.json --check`,
from a scratchpad filename unique to this composition (per the shared-scratchpad collision incident):

```
  OK  env-default-conflates-unset-with-empty      4      4        4      4    4982   4000
  OK  config-value-frozen-at-compile-time         4      4       11     11     963    900
  OK  env-default-truthy-positive-control        29      —       51      —    4982   4000

  census OK — 3 rule(s), 10927 file-visits, 66 surviving violation(s) across 37 file(s).
```

`963 walked` is exactly `rust.files` in [`shared-facts.json`](../shared-facts.json) and `4,829` of
the 4,982 JS-lane files are `frontend.tsFiles` — independently derived counts agreeing, which is the
only reason to trust either. Exit 0, identical on repeat. **The two populations are disjoint and the
separation is large**: 4 matches of the violating operator against **51 of the compliant one**, over
the same walk, with the same anchor — that ratio is the control's whole purpose, and it is what
distinguishes "this rule discriminates on `??`" from "this rule found every environment read".

**Precision, checked by opening every match.** Rule 1: 4/4 are genuine `??`-defaulted environment
reads (`src/lib/constants/uiModes.ts:41`, `scripts/memory/reflect-eval.mjs:28`,
`scripts/test/browser-bridge-mock-extension.mjs:31`, `scripts/verify-resource-scoping.mjs:188`).
Rule 2: 11/11 are real `option_env!` calls; the 12th occurrence in the tree is the literal
`option_env!("SUPABASE_URL")` inside `build.rs:24`'s doc comment, and the runner reports it as
`1 match(es) ignored on comment-only lines` — **the comment filter is not decorative here, it is the
difference between counting the design and counting its instances.**

**Fault injection against the real tree** — a gate that cannot fail is not a gate. Each row is a
single-field mutation, run with `--check`:

| Induced fault | Exit | Reported as |
|---|---|---|
| unmutated baseline | **0** | surviving counts printed |
| rule 1 matcher matches nothing | **1** | `[structural] matched zero files anywhere` + `[drift] dropped` |
| rule 2 matcher matches nothing | **1** | same pair |
| floor above the walk (`floor: 9000`) | **1** | `[structural] walked 4982 … THE MATCHER IS BROKEN` |
| renamed roots (`srcx`/`scriptsx`) | **1** | `walked 0 files but floor is 4000` + zero-matches |
| renamed Rust root (`src-tauri-x`) | **1** | `walked 0 files but floor is 900` + zero-matches |
| count rises (rule 1 baseline claims 1) | **1** | `[drift] matches rose 1 -> 4 (+3)` |
| silent drop (rule 2 baseline claims 40) | **1** | `[drift] matches dropped 40 -> 11 (-29) without the baseline moving` |
| stale `exclude` (path matching no file) | **1** | `exclude "…" matched no file. The exemption is stale` |
| unexplained `exclude` (4-char reason) | **1** | shape validation |
| missing grounding (no `goldenPath`) | **1** | shape validation |
| invalid regex in `signal.pattern` | **1** | shape validation |
| **positive control** root renamed | **1** | `walked 0 … matched zero files anywhere` |
| **positive control** anchor rots to a dead token | **1** | `matched zero files anywhere` |
| **positive control** given a `baseline` | **1** | `a positive control must NOT carry a baseline` |

**Fifteen mutations, fourteen failures, one clean baseline.** No lookbehind anywhere; every
quantifier is forward-anchored and bounded (`{0,120}?`, `{1,60}`), so neither pattern can backtrack
across a file. Whole run: **~2 s**.

### REFUSED as a census rule — "a variable is read and set nowhere". Here is the checker that can express it.

**This is the highest-value gate for this leaf and the census provably cannot host it.** The
condition is *relational*: it joins a read in `src/` or `src-tauri/` against writers in
`.github/workflows/*.yml`, `package.json`'s `scripts`, `vite.config.ts`'s `define`, `.env.example`
and Rust `set_var`/`Command::env`. `scanRule` (`scripts/census/lib/engine.mjs:147-239`) matches one
regex against one file's content and accumulates a count; it has no cross-file state and no join.
Three further reasons it could not be forced into a proxy, each measured:

1. **The writer is often not a string.** `vite.config.ts:222-224` supplies `VITE_PLATFORM` through a
   `define` whose value comes from a ternary over `process.env.TAURI_ANDROID` — the name
   `VITE_PLATFORM` appears, but as a *define key*, and no regex can tell that from a read.
   `check-tiers.mjs:37-40` supplies `VITE_APP_TIER` as an object property in a `spawn` env bag.
2. **The reader is often not a literal.** 6 of the 63 distinct Rust argument expressions are
   variables (`env::var(key)` in `build.rs:52`, `google_oauth.rs:7`, `foraging.rs:197`,
   `run_budget.rs:54`, `stale.rs:114`, `secrets.rs:69`), and one of those six —
   `foraging.rs:197` — iterates a **53-entry table**. A textual rule sees one match and misses 53
   names.
3. **Absence is the signal, and a census rule pinned at 0 fails structurally by design** (the
   runner says so itself: *"a rule pinned at 0 is a gate that can never fail"*). "No variable may be
   read without a writer" is a must-be-zero assertion, which this mechanism cannot express in either
   direction.

**Specify instead `scripts/check-env-contract.mjs` (~120 lines), wired into `npm run check:contracts`**
so it runs in the `frontend-checks` job with no cargo build. **This is not an invention — it is the
union of two siblings' proven halves** (§Convergence): `personas-cloud`'s typed declaration +
aggregate boot validator, and `brainiac`'s CI that refuses to proceed when a declared value is
absent. Four codebases have each built one half; none has built both, and each is missing exactly
what the other has.

- **Declare the contract.** A new committed `env-contract.json` (or a typed block in
  `.env.example` that the script parses) listing every variable with `{ name, layer:
  "vite-build"|"rust-compile"|"rust-runtime"|"tooling", required: "release"|"dev"|"never",
  secret: boolean, domain?: string[] | "url" | "port" }`. **This artifact is the deliverable**;
  the script is only what makes it true. Seed it from the 67 names this path measured.
- **Read the readers as structure, not text.** `import.meta.env.<NAME>` and `process.env.<NAME>`
  from the TS/JS trees; `option_env!("<NAME>")`, `env!("<NAME>")` and `env::var("<NAME>")` from the
  Rust tree, **plus the literal tables** feeding the six dynamic call sites, which must be
  allow-listed by *file* with a `reason` so a new dynamic read is a failure rather than a blind spot.
- **Read the writers by position.** Workflow `jobs.*.steps[].env` and `jobs.*.env` maps;
  `package.json` `scripts` values tokenised for `NAME=`; `vite.config.ts`'s `define` keys;
  `build.rs`'s forwarding array; `.env.example` keys. Everything inside a comment or a quoted
  message is out of scope **by position**, which is exactly what the census cannot do (the same
  reason [feature-flagged-compilation §9.2](./feature-flagged-compilation.md) refused its
  build-invocation rule).
- **Assert four things.** (a) Every declared `required: "release"` name is set by a step in
  `release.yml` that builds the artifact its `layer` belongs to. (b) Every read name is declared.
  (c) Every declared name is read (a stale entry is as bad as a missing one). (d) No name with
  `secret: true` has `layer: "vite-build"` or `"rust-compile"` — a secret must not be freezable.
- **Fail loudly if its own precondition is absent**, which is the point: assert the walk found
  **≥ 60 read names across ≥ 40 files, ≥ 9 names in `build.rs`'s forwarding array, and ≥ 3 `env:`
  blocks under `.github/`** before asserting anything about them (measured today: 67 / 4,982+963
  files / 9 / 8 blocks). A parser that silently stopped finding reads would otherwise report a
  perfect contract. Print the audited totals on success — `env contract OK (67 names, 9 frozen, 3
  set by release.yml, 0 undeclared)` — so a green log distinguishes a clean run from an empty one.

**The first run of that script would fail on 36 names** (§7 D3), which is the correct outcome and the
reason to build it: the work is writing the declaration, not the checker.

### REFUSED — a census rule on `env::var(...).unwrap_or*` (the silent default)

The brief nominates this and the condition is real (16 sites), but a count-based rule would be wrong
here and it is worth saying why. Opening all 16: `webhook.rs:46` `unwrap_or(9420)`,
`leadership.rs:93` `unwrap_or(false)`, `run_budget.rs:54` and `stale.rs:114` (both generic
`env_num(var, default)` helpers) and the three `crypto.rs` `unwrap_or_default() == "1"` switches are
all **correct** — for a bool defaulting off, or a port, the literal default *is* the specification,
and `crypto.rs` is the exemplar in §6. The genuinely bad ones are those where absence means the
feature cannot work (`PERSONAS_DELEGATE_BASE_URL` → `localhost:11434`). **The distinction is
semantic, not textual**: it depends on whether the default is a valid answer, which no regex decides.
A rule here would baseline 16 with ~4 true positives and route 12 correct call sites to a "fix". Per
the contract's fifth failure mode, that is a gate pointing at a destination that is already right.
The four are a ticket, not a gate.

### On severity, if any of this ships as an ESLint rule

Nothing here is proposed as an ESLint rule, so the warn-vs-error question does not arise — and it
must not be argued from warning volume in either direction. The count-independent argument is the
only one that holds: `npm run check` runs `eslint src/` with **no `--max-warnings`**
(`package.json:51`) and the pre-commit hook runs `--quiet --max-warnings 99999` (`lefthook.yml:20`),
where `--quiet` discards warnings before they can be counted. **A warn-level rule enforces nothing at
either gate, at any count.** The census is a different mechanism: `census:check` exits 1 on drift and
is already inside `npm run check`.
