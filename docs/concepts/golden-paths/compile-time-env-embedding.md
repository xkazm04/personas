# Golden path — Compile-time env embedding

> Situation node: `platform-delivery/build-profiles/compile-time-env-embedding` · [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: false` · recurrence **9** · risk **high** · spine label `convergence: converged`.
> Dimensions: **security · function**.
> Spine's own framing: *"Baking a build-time constant in without shipping a secret."*
>
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **The sweep was mostly of ARTIFACTS, not source.** Read with a byte scanner: the real
> `src-tauri/target/release/personas-desktop.exe` (**137.6 MiB**), `target/debug/personas-desktop.exe`
> (110.7 MiB), `target/release/personas-mcp.exe` (7.1 MiB), and the real `dist/` frontend bundle
> (**1,399 `.js` chunks, 30.9 MiB**) — all already on disk. Source sweep: all **963** `.rs` files under
> `src-tauri/` (`rust.files` in [`shared-facts.json`](../shared-facts.json)), all `.ts`/`.tsx` under
> `src/`, `src-tauri/build.rs`, `vite.config.ts`, `scripts/run-codegen.mjs` and all **13** codegen
> tasks it drives, the **34** committed files carrying a generated header, every `package.json`
> script, the four `tauri.*.conf.json` files, and `ci.yml`. Convergence: five sibling repos.
>
> **NO `cargo` command and NO build of any kind was run** — the operator uses this app daily and a
> build costs 20 minutes. Every claim about a compiled binary was measured against the binary that
> was already there.
>
> **No secret value appears in this document, was printed, or was logged.** Shape, name, location and
> count only — including in the census-rule descriptions.
>
> The **Deviations** section is a fix backlog. Nothing in it was applied.

---

## Scope — what this leaf owns, against three crowded neighbours

Three adjacent paths already own most of the machinery. The boundary that keeps this leaf from being
a duplicate is one sentence:

| Question | Owner |
|---|---|
| Does the **code** exist in this build? (`#[cfg]`, `generate_handler!`, tier *visibility*) | [feature-flagged-compilation](./feature-flagged-compilation.md) (rec. 670) |
| Does the **value** exist, who supplies it, what happens when it is missing or empty? | [environment-variable-configuration](./environment-variable-configuration.md) (rec. 40) |
| How is a capability hidden, disabled or refused below a tier? | [tier-and-capability-gating](./tier-and-capability-gating.md) (rec. 154) |
| The three `tauri.*.conf.json` overlays as documents | tauri-config-variants (rec. 4, unwritten) |
| **Once the value is frozen: can the artifact, or anything running inside it, say what it was built with?** | **this path** |

Those three ask *what did the build decide*. This one asks *what does the build REMEMBER*. Every
deviation below is a place where a value was frozen correctly and the record of the freezing was
thrown away — which is why the fix is a type neither neighbour proposes.

---

> ### ⚠ §12 — Four corrections to the brief that commissioned this path
>
> **1. The `convergence: converged` label FAILS — and it fails in an unusually informative way.
> Nine CONVERGED labels had been tested and nine failed; this is the tenth, and it is the first one
> that is wrong because the fleet converged on the DISEASE.**
>
> Swept `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`. All five
> exist. **Not one of the five can report its own git commit, branch, CI run id, build timestamp, or
> build profile at runtime.** Zero, five times, across three languages and four build systems — and
> two of them are handed it free and do not take it (`ascent` deploys on Vercel where
> `VERCEL_GIT_COMMIT_SHA` is ambient and unused; `brainiac` builds in GitHub Actions where
> `github.sha` is ambient and never becomes a Docker `ARG`).
>
> That is a perfect six-for-six agreement, and it is **not** what a `converged` label means. The
> doctrine's test is *"a practice independently reinvented in a repo with different people and
> constraints is physics"*. What was independently reinvented here is the omission. Agreement on an
> absence is evidence the **situation** is universal; it is evidence *against* there being a
> converged answer to adopt. Marking this leaf `converged` would have sent a composer looking for the
> prescription in a sibling, and there is none to find.
>
> **The label does hold on exactly one clause, and it is worth naming**: *"never freeze a secret"*.
> `brainiac` freezes four `NEXT_PUBLIC_*` values through `console/Dockerfile:23-26,:38-41` and every
> one is a publishable id. `personas-web/.env.example:3` states the rule in prose — and declares a
> real shared secret twelve lines below it. So one repo practises it, one repo states it and breaks
> it, and Personas breaks it too (§7 D1, measured in the binary). **One clause of four; the correct
> spine label is `mixed`.**
>
> **2. "Ask what a timed-out codegen task leaves behind and whether the build notices" — the
> hypothesis is HALF WRONG, and the executed answer is sharper than the guess.**
>
> *Does the build notice?* **Yes, for `npm run build`.** `run-codegen.mjs:150` exits 1 on any failed
> task, `prebuild` fails, and npm refuses to run `build`. The brief implied the timeout was silent.
> It is not.
>
> *What does it leave behind?* My first experiment **refuted my own hypothesis** and I report it
> because the refutation is where the real finding was. Replicating `run-codegen.mjs:86-102`
> (`spawn` + `setTimeout` → `SIGKILL`) with a coarse delay sweep, every kill landed either before
> node started or after the write finished — 32 trials, zero partial files. The sweep was measuring
> **node's startup time**, not the write. Re-run with the child signalling readiness on stdout the
> instant before `fs.writeFileSync`, and killing at `READY + 0 ms`, the destination is left at
> **0 bytes**. `writeFileSync` opens with `'w'`, which **truncates the destination before a single
> byte is written**. So the answer is not "the previous good file survives" and not "a half-written
> file"; it is **an empty file where a committed generated artifact used to be**, and all 12 of the
> repo's generators write this way (§7 E1).
>
> *(One arithmetic error of mine, corrected in place: the 32 MiB row of that run first read
> `PARTIAL — 100.0%` because my expected-size constant was off by two bytes. It was COMPLETE. A
> verdict computed from an expected value I got wrong is exactly the "gate that asserts data is not a
> gate on behavior" failure, committed inside the instrument built to avoid it.)*
>
> **3. "Test whether a fifth belongs: across a build boundary" — YES, and the qualification is the
> whole value.** Full answer in [§ Does "across a build boundary" belong](#does-across-a-build-boundary-belong-in-the-doctrines-list-yes-with-the-qualification-that-makes-it-useful).
>
> **4. "Whether any secret or host is embedded" — measured in the binary rather than inferred, and
> the number is smaller and more specific than the neighbouring path could establish.**
> [environment-variable-configuration §7 B1](./environment-variable-configuration.md) reasoned that a
> locally-built installer *"bakes four real credentials plus two client IDs into the binary as
> plaintext string literals"*. Scanning the actual release executable: **one** Supabase project host
> and **one** anon-key-shaped JWT. Zero Sentry DSN, zero Google client id, zero Google client secret,
> zero Microsoft secret. **Two of `build.rs`'s nine forwarded names arrived; seven did not** — the
> operator's `.env` simply does not hold the other seven. The conclusion survives (a credential *is*
> frozen into a shipped-shaped binary) and the magnitude was 3× over-stated. §7 D1.

## 1. Trigger

- "Can I just bake that in at build time?" / "make it a compile-time constant"
- "Which build is this?" / "is this the lite build or the full one?" / "which tier is this installer?"
- "A user sent a crash — what was actually in their binary?"
- "Why is this generated file out of date?" / "did the codegen run?"
- "Sentry says 1.1.0, but which 1.1.0?"
- "Add the commit SHA to the About box"

If you are about to type `option_env!("…")`, `env!("…")`, `import.meta.env.VITE_…`, a `define:` entry
in `vite.config.ts`, a `println!("cargo:rustc-env=…")` in `build.rs`, a new task in
`scripts/run-codegen.mjs`'s `TASKS`, or a field named `version` / `app_version` / `release` on a
struct that gets serialized — you are in this situation.

## 2. The one way

**Freeze the value if you must, but freeze its PROVENANCE with it, in one type, constructed once —
because the moment the artifact leaves the machine, everything the build knew and did not record is
gone forever.** A build-time constant is not just a value that cannot be changed; it is a value whose
*origin* becomes unaskable, and the failure is silent by construction: an installer built without a
value is byte-identical in shape to one built with it, and neither can be interrogated. So define a
single `BuildIdentity` — version **plus** the compiled feature set **plus** the profile **plus** a
`build.rs`-forwarded commit SHA and build timestamp — construct it in exactly one place, export it
through ts-rs so the frontend gets the same shape rather than a second answer, and make every place
that today writes a bare version string take that value instead. **Prefer `env!` over `option_env!`
for anything a build must not silently omit**: `env!` is a compile error when the variable is absent,
which is the only mechanism in this stack that lets a *type* reach across the build boundary at all —
`option_env!` collapses "never configured", "configured empty" and "dropped by `build.rs`'s emptiness
guard" into one indistinguishable `None`. **Never freeze a credential**; a `strings` pass over a
137 MiB executable finds it in under a second, and the environment is where a secret *arrives*
(`foraging.rs`), never where it lives. **Never freeze a build-machine path** — `env!("CARGO_MANIFEST_DIR")`
puts the building operator's home directory into every shipped copy. And treat a **generated file as
a frozen value too**: it is a build-time constant that happens to be spelled as source, so it needs
the same provenance discipline — a header naming its generator and its inputs (the repo already does
this well), an **atomic** write so an interrupted build cannot leave a zero-byte artifact behind, and
a drift check so a stale one cannot ship. Then stop: do not add a second reader for a frozen value
that already has one, and do not write a value into an artifact that the artifact cannot later
explain.

## 3. Mandated primitives

**Exist today — use them.**

- **`src-tauri/build.rs:51-56` — the forwarding loop, and the one correct emptiness guard in the
  build lane.** `println!("cargo:rerun-if-env-changed={key}")` per key, then `if !val.trim().is_empty()`
  before the `cargo:rustc-env=` emit. This is where any new frozen value is declared, and the
  25-line comment at `:43-50` is the standard to write to: it names a second-order hazard
  (`swatinem/rust-cache` restoring `target/` across CI runs, so a cached build-script output ships a
  rotated secret's previous value) rather than restating the mechanism.
- **`src-tauri/build.rs:20` — `cargo:rustc-env=TS_RS_EXPORT_DIR=../src/lib/bindings`, and the comment
  above it.** ***The single most instructive artifact in this leaf.*** It exists because the `[env]`
  table in `.cargo/config.toml` **did not reliably reach proc-macro expansion** — a build-time value
  that silently failed to arrive, produced a second committed bindings tree, and was diagnosed only
  after the drift was visible in git. If you need a value to reach a specific compilation stage,
  `cargo:rustc-env` from `build.rs` is the mechanism that provably gets there; an `[env]` table is
  not.
- **`env!("CARGO_PKG_VERSION")` — the fail-loud compile-time read.** Unlike `option_env!`, an absent
  variable is a compile error. Every value a build must not omit should use this form. **22 uses
  across 17 files.**
- **`vite.config.ts:222-224` — `define: { "import.meta.env.VITE_PLATFORM": JSON.stringify(platform) }`.**
  The frontend's only build-time value that **cannot be absent, empty or typo'd**, because it is
  computed in the config (`:17-21`, from `TAURI_ANDROID`/`TAURI_IOS`, which Tauri's own CLI sets) and
  injected, so there is no environment lookup left to fail. Copy this whenever the value is derivable.
  *(Verified downstream: the literal survives into `dist/` — see §6.)*
- **`scripts/run-codegen.mjs:22-73` — `TASKS` + `PRESETS`.** A flat, explicit, reviewable map with a
  written rule against auto-discovery, and a per-task comment for each of the 13. This is the
  declaration of what the build generates, and it is genuinely good. Add here, not to a `buildStart`
  hook — `vite.config.ts:39-49` records why the hook was deleted.
- **The generated-header convention.** `src/lib/commandNames.generated.ts:1-4` is the model:
  generator path, re-run command, **and the input it was derived from with a count**
  (*"Generated from src-tauri/src/lib.rs invoke_handler (1585 commands)"*). `src/i18n/generated/types.ts:1-5`
  and `enSectionStrings.ts:1-2` follow it. **34 committed files carry a generated header and the
  convention is well kept** — this is the repo's best existing provenance practice and it is on the
  *generated file*, not on the binary.
- **`.github/workflows/ci.yml:336` and `:432` — the two drift checks.** `git diff --quiet` on
  `commandNames.generated.ts` and on `src/lib/bindings/`. Two of thirty-four. The model to extend,
  not to admire.
- **`src-tauri/src/commands/infrastructure/system/mcp_integration.rs:138`,
  `commands/live_roadmap.rs:396`, `commands/obsidian_brain/graph.rs:520`, `companion/tts/pocket.rs:154`,
  `companion/stt/downloader.rs:214`, `daemon/lock.rs:246`, `commands/artist/persistence.rs:317` — the
  atomic write.** `std::fs::rename(&tmp_path, &path)`, write-then-rename, **18 sites across 8
  modules**. The repo knows this pattern well on the Rust side. It is used **zero** times in the
  build tooling (§7 E1).

**Do not exist — and this is the leaf's structural finding.**

- **There is no `BuildIdentity` value, at either layer.** No struct, no constant, no command. The
  running app knows one thing about its own build: a version string.
- **There is no capability or build-info probe.** No IPC command reports the compiled feature set,
  the profile, or the tier. `cfg!(feature = …)` is used **0 times in 963 `.rs` files** (49 `cfg!`
  uses exist; 12 `debug_assertions`, 27 `target_os`, 8 `windows`, 2 `target_arch` — **not one tests a
  feature**), so nothing could answer even if asked.
- **There is no build-metadata forwarding.** `build.rs` forwards nine *configuration* names and
  **zero** identity ones. No `vergen`, no `built` crate, no `GIT_SHA`, no `BUILD_TIMESTAMP`,
  no `BUILD_PROFILE`, no feature list.
- **There is no atomic-write helper in the build tooling.** 116 `writeFileSync` calls across 67
  scripts; `renameSync` appears **zero** times in code this repo owns.

## 4. Steps

1. **Decide whether the value is a property of the ARTIFACT or of the ENVIRONMENT.** Only the first
   may be frozen: which tier this bundle is, which release this binary reports as, which commit built
   it. Anything the installing user or machine could need to change is runtime — see
   [environment-variable-configuration §4](./environment-variable-configuration.md), which owns that
   half.
2. **If you freeze it, ask the provenance question out loud: "six months from now, holding only the
   installer, how would I find out what this was set to?"** If the answer is "you couldn't", you are
   about to create the defect this leaf is about. Add the value to `BuildIdentity` (step 4) rather
   than to a call site.
3. **Declare it in `build.rs:32-42` (Rust) or `vite.config.ts`'s `define` (frontend), never as a bare
   read at the point of use.** The `define` form is strictly better where the value is derivable,
   because it removes the lookup entirely (`VITE_PLATFORM` is the proof). For Rust, pair every entry
   with `cargo:rerun-if-env-changed` **and** the `!val.trim().is_empty()` guard — both already at
   `build.rs:51-53`.
4. **Use `env!`, not `option_env!`, for anything whose absence must not ship.** `env!` fails the
   compile; `option_env!` returns `None` and the three reasons it might be `None` are
   indistinguishable forever after. Where `option_env!` is genuinely right (an optional capability),
   layer it under a runtime resolver — `engine/src/google_oauth.rs:57-64` `resolve_env_value` — so a
   build that omitted it can still be repaired at run time.
5. **Never freeze a credential, and never freeze a build-machine path.** Both are measurable in the
   shipped artifact today (§7 C1, §7 D1). For a path, `option_env!` + a runtime fallback; for a
   credential, the Vault.
6. **If you are adding a generated artifact, add all four things in the same change**: (a) the task
   in `run-codegen.mjs`'s `TASKS` and both `PRESETS`; (b) the header naming generator, re-run command
   and inputs; (c) an **atomic** write — build the content in memory, `writeFileSync` to
   `<dest>.tmp`, then `renameSync` onto `<dest>`; (d) a drift check. Without (c) an interrupted build
   leaves a **zero-byte** artifact (§7 E1, executed). Without (d) a stale one ships (§7 E3).
7. **Then stop.** Do not add a second resolver for a frozen value. Do not hand-write another version
   string into a serialized struct — take `BuildIdentity`. Do not write `tree-shake` in a comment
   about a value that is only read at runtime (`uiModes.ts:22` does; the neighbour path measured that
   it does not).

### Can the primitive's signature make the wrong call impossible? — yes, once, and it subsumes almost every deviation below

The [contract](../golden-path-contract.md) requires this before §9. The second pass over §7 found
that **thirteen of the fourteen deviations are the same missing value**, so there is one answer, not
a list:

- **`BuildIdentity` should be a type, constructed once. YES — this is the fix.**
  ```rust
  #[derive(Serialize, TS)] #[ts(export)]
  pub struct BuildIdentity {
      pub version: &'static str,       // env!("CARGO_PKG_VERSION")
      pub commit: Option<&'static str>,// build.rs -> cargo:rustc-env=BUILD_GIT_SHA
      pub built_at: Option<&'static str>,
      pub profile: &'static str,       // "release" | "debug" via cfg!(debug_assertions)
      pub features: &'static [&'static str], // cfg!(feature = "ml") etc., built once
  }
  ```
  Construct it in one `const fn`/`OnceLock`, register one `get_build_identity` command, and make the
  13 sites in §7 B2 take it. **The type does the work `--features desktop` discipline cannot**: a
  field cannot be omitted, and `features` is derived from `cfg!` rather than hand-maintained. It also
  supplies the missing halves of three neighbours at once —
  [feature-flagged-compilation Gap 3](./feature-flagged-compilation.md) (*"There is no capability
  probe"*), [environment-variable-configuration §3](./environment-variable-configuration.md)
  (*"A capability/diagnostics surface … does not exist"*), and this leaf's whole §7 A.
- **Sentry's `dist` field is the same fix, already designed by someone else, and it is free.** Sentry
  models exactly this: `release` groups by version, `dist` separates *builds within* a release.
  Personas sets `release` on both sides and `dist` on **neither** (`src-tauri/src/main.rs:87`,
  `src/lib/sentry.ts:201-203`). Setting `dist` from `BuildIdentity`'s profile+features+commit is a
  two-line change that retroactively makes every future crash attributable. **No gate can substitute
  for this; a ratchet on the 13 stamping sites only stops the count rising.**
- **A frozen path should not be spellable as `env!`. PARTLY.** `env!("CARGO_MANIFEST_DIR")` is 11
  sites, 9 of them legitimate `#[cfg(test)]` fixtures. There is no type that separates the two — the
  macro is the same. This one stays a ticket (§7 C1), and §9 explains why it is *not* gated.

## 5. Anti-patterns

- **Writing a bare version string into a serialized struct.** 13 sites do it (§7 B2). Every one
  produces a record that cannot distinguish two materially different builds — and they *are*
  materially different: the release binary on this disk contains `quinn` 247 times and `fastembed` 10
  times, a `tauri:build:lite` binary would contain neither, and both would be stamped `1.1.0`.
- **`option_env!` where the value must not be missing.** It returns `None` identically for "never
  configured", "configured empty", and "dropped by the `build.rs` guard". `env!` fails the build.
  Choosing the silent macro for a required value is choosing to find out from a user.
- **Freezing a build-machine path into shipped code.** `env!("CARGO_MANIFEST_DIR")` is not an
  abstract hazard here: the release executable on this disk contains the operator's absolute home
  path (§7 C1, verified). It is one line to make it `option_env!` with a runtime fallback.
- **Assuming the previous good file survives a killed generator.** It does not.
  `fs.writeFileSync(dest, …)` truncates `dest` to zero **before** writing, so a SIGKILL from
  `run-codegen.mjs`'s 60 s watchdog leaves an **empty** committed artifact. Executed, §7 E1.
- **Running `vite build` directly.** `vite.config.ts:46-49` says in as many words: *"if you bypass
  `npm run dev` / `npm run build` (e.g., by running `vite build` directly), regenerate codegen first
  via `node scripts/run-codegen.mjs prebuild`."* `.claude/CLAUDE.md` lists `npx vite build` as
  **"Production frontend build"**. §7 E4.
- **Adding a codegen task without adding a drift check.** 13 tasks, 34 committed generated
  artifacts, **2** drift checks. A generated file with no drift check is a hand-edited file that
  nobody knows is hand-edited.
- **Deriving one identity from two files.** The Rust half reads `Cargo.toml`'s version through
  `env!` at compile time; the frontend half reads `tauri.conf.json`'s through an IPC round-trip at
  run time. Nothing compares them (§7 B1).
- **Defaulting a build identity to a plausible-looking literal.** `src/main.tsx:299` seeds
  `appVersion = "dev"` and the `getVersion()` failure is swallowed by `silentCatch` at `:302`, so a
  production frontend can report its Sentry release as the literal string `"dev"` with no diagnostic
  anywhere.
- **Believing a tier bundle is identifiable.** It is not: `dist/` on this disk cannot be attributed
  to `build:starter`, `build:team` or `build:builder` by any inspection (§7 A2).

## 6. Evidence

**Adoption, measured against the real artifacts.** 11 `option_env!` reads / 4 files · 22
`env!("CARGO_PKG_VERSION")` / 17 files · 11 `env!("CARGO_MANIFEST_DIR")` / 9 files · 9 names forwarded
by `build.rs` of which **2 arrived in this binary** · 100 `import.meta.env` reads / 63 files (91 of
them `DEV`) · **1** `define` entry · 13 codegen tasks writing 15 artifacts · 34 committed generated
files · **2** drift checks · **0** atomic writes in build tooling · **0** `cfg!(feature = …)` tests.

> **Three of those figures corrected 2026-08-17 by
> [codegen-task-registration](./codegen-task-registration.md), which enumerated and executed the
> whole registry.** The registry holds **14** tasks, not 13 — this line read a *preset's* length as
> the registry's. There are **19 generators** writing **1,861** committed artifacts, not 34; and
> **3** drift checks, not 2 — the third (`check-command-contract.mjs:231-250`) is the only one that
> runs locally inside `npm run check`, the other two being CI-only on a red pipeline whose own
> binding-drift job documents itself as *"5/20 green"*. `0` atomic writes still holds: `renameSync`
> is absent from all 150 tooling files.

- **`src-tauri/build.rs:1-21` — copy this comment, not just this code.** The `TS_RS_EXPORT_DIR`
  forwarding is the repo's one worked example of a build-time value that *silently failed to arrive*,
  diagnosed and fixed, with the reasoning left in place: the `[env]` table *"does NOT reliably
  inherit"* into proc-macro expansion, so the value is emitted via `cargo:rustc-env` instead. Every
  future frozen value should be introduced with this much evidence.
- **`vite.config.ts:222-224` + `dist/assets/*.js`** — the frontend's one un-absent build value, and
  it survives verification: scanning the 1,399-chunk bundle, the string `import.meta.env` appears
  **0 times** (everything inlined) while `VITE_PLATFORM` appears **2 times**, i.e. the `define` key
  is what reached the output. Contrast `VITE_APP_TIER` and `VITE_SENTRY_DSN`, which appear **0**
  times each — inlined to literals that cannot be recovered.
- **`src/lib/commandNames.generated.ts:1-4`** — the best generated header in the repo: generator,
  re-run command, source file, **and the derived count**. A reader can falsify it without running
  anything.
- **`scripts/run-codegen.mjs:39-49, 61-67`** — comments that record *why* a task is in the list, each
  naming the failure that put it there (`agent-icon-sprites` was in `buildStart` only and silently
  diverged; `system-skills` was missing so a fresh clone failed with *"resource path
  `resources\skills` doesn't exist"*). This is the declaration of the build's generated surface and
  it is honestly maintained.
- **`.github/workflows/ci.yml:222-235`** — the clearest statement in the repo of a build-time
  environment dependency discovered by failure, and the model for how to write one down. Five
  comment lines establish that the crypto job *"has been 0/20 green"*, that the hatch is documented
  at `core/src/crypto.rs:495` rather than invented, that the remedy string is printed by the code
  itself at `:527`, that it had **zero occurrences across `.github/` before that line**, and that the
  scope is a test runner only. *(Note for this leaf: `PERSONAS_ALLOW_FALLBACK_KEY` is a **runtime**
  read — `crypto.rs:464` `std::env::var(...)` — so it belongs to
  [environment-variable-configuration](./environment-variable-configuration.md). It is cited here as
  the standard of documentation a frozen value deserves and does not get.)*
- **`src-tauri/src/commands/infrastructure/system/mcp_integration.rs:130-138`** — the atomic write
  done right: build content, write to `tmp_path`, `std::fs::rename(&tmp_path, &config_path)`. Eight
  modules do this. The build tooling does it nowhere.
- **`src/lib/sentry.ts:196-203`** — two guards that are correct (`import.meta.env.PROD` before
  reading the DSN, `dsn || undefined` so empty is absence) sitting beside the one that is missing
  (`dist`). Worth reading precisely because the file is careful everywhere except about *which build
  it is*.

## 7. Deviations found

**Five categories, 14 individually-addressable items.** All ship green under `npm run check` (which
includes `census:check`, `check:contracts`, `check:tiers`, `check:tauri-configs`, `tsc --noEmit`),
and all five read-only drift checks in the repo exit **0** today — `gen-shared-catalog --check`,
`check-command-contract`, `check-tauri-configs`, `check-event-registry`, `i18n check-coverage`. The
committed generated surface is *currently* clean; nothing makes it stay that way.

### A. The artifact cannot say what it is — 4

**A1 — the release binary does not name its own feature set, and the only way to determine it is to
grep for third-party crate names.** Scanning `src-tauri/target/release/personas-desktop.exe`
(137.6 MiB): the literal `desktop-full` appears **0** times; so does `desktop_full`, `tauri.lite.conf`
and `tauri.stable.conf`. There is no git SHA, no build timestamp, no profile marker. The feature set
had to be **inferred forensically from the symbol residue of the optional dependencies**:

| marker | occurrences | implies |
|---|---:|---|
| `quinn` | 247 | `p2p` was on |
| `mdns` | 114 | `p2p` was on |
| `sqlite-vec` | 41 | `ml` was on |
| `fastembed` | 10 | `ml` was on |
| `onnxruntime` | 2 | `ml` was on |

That identifies it as a `desktop-full` build. **It is a correct answer obtained by the wrong method** —
it depends on crate names that a dependency bump can change, it cannot distinguish `scraper` or
`ollama` (which nothing compiles anyway), and it is unavailable to the running program, to a support
engineer, and to Sentry.

**A2 — the frontend bundle cannot be attributed to a tier.** Scanning `dist/assets/*.js` (1,399
chunks, 30.9 MiB): `import.meta.env` survives **0** times (fully inlined, as designed);
`BUILD_MAX_TIER` survives **0** times (minified away); the version string `1.1.0` appears **0** times;
`dist/index.html` (1,974 bytes) contains no version, no tier and no date, and the only other files at
the `dist/` root are `theme-init.js` and `webview2-compat.js`. `starter`/`team`/`builder` appear only
as bare words (16 / 693 / 71) belonging to route ids, i18n keys and copy. **`npm run check:tiers`
builds three bundles on every change and the three are mutually unidentifiable after the fact.**

**A3 — the runtime provenance surface is one string.** The only build fact the UI can obtain is
`getVersion()` from `@tauri-apps/api/app` (`src/features/shared/chrome/sidebar/Sidebar.tsx:130`,
`src/features/settings/sub_account/components/AccountSettings.tsx:42`), which returns
`tauri.conf.json`'s `version`. **No IPC command reports the feature set, the profile or the tier**,
and `cfg!(feature = …)` appears **0 times in 963 `.rs` files**, so no command could.

**A4 — Sentry receives `release` from both halves and `dist` from neither.**
`src-tauri/src/main.rs:87` `release: Some(env!("CARGO_PKG_VERSION").into())`;
`src/lib/sentry.ts:202` `release: appVersion`. Sentry's `dist` field exists precisely to separate
builds inside one release and is **unset on both sides**. Consequence: a crash from
`tauri:dev:lite`, one from `tauri:build:stable`, one from a starter bundle and one from a builder
bundle all arrive tagged `1.1.0`, indistinguishable, in the one channel that ships data off-device.
*Compounding it:* `src/main.tsx:299-302` seeds `appVersion = "dev"` and swallows a `getVersion()`
failure through `silentCatch`, so a production frontend can silently report its release as `"dev"`.

### B. One identity, two sources, thirteen hand-written copies — 2

**B1 — the two halves of the same `release` string come from different files by different
mechanisms, and nothing compares them.** Rust reads `src-tauri/Cargo.toml`'s `version` at **compile
time** via `env!`; the frontend reads `src-tauri/tauri.conf.json`'s `version` at **run time** via an
IPC round-trip. All three manifests say `1.1.0` today (`Cargo.toml`, `package.json`,
`tauri.conf.json:4`) and **`scripts/check-tauri-configs.mjs` does not compare versions** — it
validates `build.features` against `Cargo.toml`'s `[features]` and CSP, and the token `version`
appears in it only inside an unrelated comment at `:125`. A bump to one file and not the other splits
one app's crashes across two Sentry releases with no warning.

**B2 — 13 sites hand-write the version into a durable or transmitted record.** Two independent
implementations (a content regex, and a token scan that classifies each `env!("CARGO_PKG_VERSION")`
by walking backward to its enclosing syntactic position) **agree on 22 total occurrences and on the
13-member violating subset**:

| Site | Record |
|---|---|
| `src/main.rs:87` | Sentry `release` |
| `src/cloud/sync/rows.rs:306` | a synced row (`app_version`) |
| `src/commands/core/data_portability.rs:2745` | export bundle manifest |
| `src/engine/bundle.rs:272` | portability bundle |
| `src/commands/artist/persistence.rs:89`, `:163` | saved artist project (`saved_by`) |
| `src/daemon/lock.rs:207` | the daemon lock file |
| `src/engine/management_api.rs:1613` | HTTP API response |
| `src/gitlab/converter.rs:219` | emitted JSON |
| `src/mcp_server/mod.rs:58`, `:77` | MCP `initialize` response |
| `src/browser_bridge/mcp.rs:23` | `const SERVER_VERSION` → MCP `serverInfo` |
| `src/companion/orchestration/mcp/mod.rs:71` | `const SERVER_VERSION` → MCP `serverInfo` |

Every one of these outlives the process or leaves the machine. Not one carries the profile, the
feature set, or a commit. *(A 14th, `commands/infrastructure/system/crash_telemetry.rs:74`, binds the
version to a local and inserts it into the `frontend_crashes` table — semantically identical, and the
§9 signal deliberately does not match the `let` form; see §9 for why that trade was taken.)*

### C. Build-machine provenance leaks — in the wrong direction — 2

**C1 — `env!("CARGO_MANIFEST_DIR")` ships, verified in the binary.** 11 sites across 9 files; 9 are
`#[cfg(test)]` fixtures and **2 are production** (`engine/src/team_preset_loader.rs:89`,
`src/companion/dev_mode.rs:25`). [environment-variable-configuration §7 B4](./environment-variable-configuration.md)
predicted the literal would be present in the release executable but could not check. **It is: 2
occurrences in `target/release/personas-desktop.exe`, 3 in the debug build, 0 in `personas-mcp.exe`.**
Both call sites are behaviourally safe and honest about it — `team_preset_loader.rs:76-99` uses it as
a third `.is_dir()`-checked candidate, `dev_mode.rs:21-31` is debug-only with a doc comment naming
the one scenario it is correct in — but the operator's home directory is a string in the shipped
executable either way. One-line fix: `option_env!` plus the runtime fallback that is already there.

**C2 — and the same information arrives 2,813 more times through a channel no source edit can
close.** The release binary contains the build machine's cargo-registry path **2,813 times** (1
distinct string), from dependency panic-location metadata. Fixing C1 removes 2 of ~2,815
occurrences of the operator's OS username. **This is recorded so that C1 is not mistaken for a
privacy fix** — it is a hygiene fix, and the real lever is a `--remap-path-prefix` in
`.cargo/config.toml`, which is a build-configuration change and therefore out of bounds for this
campaign. See Gap 5.

### D. Frozen secrets — measured, and one false positive cleared — 2

**D1 — the release binary contains one Supabase project host and one anon-key-shaped JWT.** Scanning
for shapes only: 2 occurrences / 1 distinct host matching `https://<ref>.supabase.co` (40 chars), and
2 occurrences / 2 "distinct" three-part JWT-shaped literals of length 208 and 225 — which **share a
208-character prefix**, so they are one key matched at two extents, not two keys. Identical in the
debug binary; **zero** in `personas-mcp.exe` (which has no `option_env!` Supabase read) and **zero**
in the frontend bundle. Zero Sentry DSN, zero `*.apps.googleusercontent.com`, zero `GOCSPX-` in
either binary. **So exactly 2 of `build.rs`'s 9 forwarded names arrived**, both by way of
`dotenvy::dotenv()` at `build.rs:26` reading the operator's gitignored `.env`, and both are now
plaintext literals in a 137.6 MiB executable. This is the direction
[environment-variable-configuration §7 B1](./environment-variable-configuration.md) called
"exactly backwards", now with the artifact as evidence rather than the inference.

**D2 — a false positive, cleared by hand, recorded because it would have become a finding.** The
first scan reported **27 occurrences / 3 distinct** of the Google-client-secret prefix `GOCSPX-` in
`dist/assets/*.js` across 24 chunks. Opening the preceding 60 characters at each site: every one is
`"label":"OAuth Client Secret","type":"password","placeholder":"<…>` — a **placeholder string in a
credential-capture form**, shipped in 24 use-case template chunks. Not a secret. The doctrine's
instruction to hand-verify a sample regardless of whether implementations agree is what caught it;
a shape-only scanner reporting "3 distinct Google client secrets in the frontend bundle" would have
been the most alarming line in this document and entirely wrong.

### E. Build-time codegen — the generated file is a frozen value too — 4

**E1 — 12 of 12 generators write in place; a killed task leaves a zero-byte artifact. Executed.**
`scripts/run-codegen.mjs:97-102` kills a task with `SIGKILL` after 60 s (`CODEGEN_TIMEOUT_MS`). All
15 write sites across the 11 writing generators are `writeFileSync(<committed destination>, content)` —
`generate-command-names.mjs:62,:93`, `i18n/gen-types.mjs:54`, `i18n/split-locales.mjs:21`,
`generate-connector-seed.mjs:99`, `generate-template-checksums.mjs:172,:292`,
`generate-n8n-limits.mjs:82`, `generate-guidance-anchors.mjs:63`, `skills/gen-scan-match-rules.mjs:67`,
`events/generate-connector-events.mjs:320,:327,:330,:335`, `docs/gen-shared-catalog.mjs:192`. **`renameSync`
appears 0 times in code this repo owns.**

> *A measurement correction, kept because it is the doctrine's composition warning in miniature.* A
> first pass reported **20** `rename` matches under `scripts/`. Opening them: **all 20 are inside
> `scripts/mcp-server/node_modules/sql.js/dist/*`** — an emscripten filesystem shim. The repo's own
> count is **0**, which is what a stricter earlier matcher had said. Two implementations disagreed
> 20-vs-0 and the stricter one was right; the looser `\brename\s*\(` was matching a method name.

Replicating the runner's `spawn` + `SIGKILL` against a child whose write is targeted precisely
(readiness signalled on stdout immediately before `fs.writeFileSync`, kill at `READY + 0 ms`): the
destination is left at **0 bytes**. `writeFileSync` opens `'w'`, truncating first. So the artifact
left behind is not stale and not half-written — it is **empty**.

**E2 — and the highest-fan-out generator is the one nothing downstream can notice.**
`scripts/i18n/split-locales.mjs:21` writes **793** JSON files under `src/i18n/section-locales/` from a
single `fs.writeFileSync` inside a loop, so there is no atomicity per file *and none across the set* —
a kill leaves a mixture of new and stale sections. Those 793 files are the only generated artifacts
in the repo that are **not compiled**: `src/i18n/useTranslation.ts` loads them through
`import.meta.glob` at run time. `tsc` cannot see an emptied one and `cargo` cannot either; the failure
surfaces as a missing translation section in a shipped app.

> **Corrected 2026-08-17 by [codegen-task-registration](./codegen-task-registration.md), which
> executed the kill instead of reasoning about it — and the real behaviour is worse than "a
> mixture".** `split-locales.mjs:56` `rmSync`s the whole directory *before* the write loop, so
> there are no stale sections left to mix with. Killed at READY+320 ms against a scratch copy:
> **the directory does not exist and 793 tracked files are gone.** An uninterrupted run takes
> 2,760 ms, so the 60 s codegen watchdog is not the trigger — **a Ctrl-C on `npm run dev` is.**
> Three states, not two: untouched / 0-byte / **absent**. The same `rmSync` also makes the file's
> own `writeIfChanged` guard dead for 793 of its 794 calls.

**E3 — 2 drift checks for 34 committed generated artifacts.** `ci.yml:336`
(`commandNames.generated.ts` + `commandNames.overrides.ts`) and `ci.yml:432` (`src/lib/bindings/`).
**Exactly one generator supports a `--check` mode at all** — `docs/gen-shared-catalog.mjs` — and per
`.claude/CLAUDE.md` a stale catalog *"no longer fails `npm run check`"*. Everything else — the two
i18n artifacts (1.6 MB combined), `builtin_connectors.rs` (292 KB), `builtin_shared_events.rs`
(168 KB), `templateChecksums.ts` + its Rust twin, `n8nLimits.generated.ts`, `generated_anchors.rs`,
`scanMatchRules.gen.ts`, `agentIconSprite.generated.ts` — can be hand-edited, left stale, or emptied
by E1, and nothing anywhere will say so.

**E4 — the repo's own agent instructions document the one command that skips all of it.**
`vite.config.ts:46-49` records that the `buildStart` codegen plugin was deleted on 2026-05-10 and
warns: *"if you bypass `npm run dev` / `npm run build` (e.g., by running `vite build` directly),
regenerate codegen first via `node scripts/run-codegen.mjs prebuild`."* `.claude/CLAUDE.md:17` lists **`npx vite build           # Production frontend build`**. `npx vite build`
does not fire `prebuild`, so it runs none of the 13 tasks. The safety net is real —
`run-codegen.mjs:150` exits 1 and npm aborts `build` — and the documented command routes around it.

**And a second stale line in the same file closes the loop.** `.claude/CLAUDE.md:321` states that
`scripts/i18n/split-locales.mjs` *"runs in `vite buildStart`"*. It does not, and has not since
2026-05-10: the string `split-locales` appears **nowhere** in `vite.config.ts`, and `buildStart`
appears there only at `:43` and `:45`, inside the comment explaining that the plugin was **deleted**.
Read together, the two lines describe a workflow in which the 793 section-locale JSON files of §7 E2
are regenerated by a hook that no longer exists, invoked by a command that skips the hook that
replaced it. **A reader following `.claude/CLAUDE.md` exactly would ship stale translations and get
no error from anything.** Both fixes are one line of documentation, in the file agents read first.

## 8. Gaps in the primitive

1. **`option_env!` cannot report why it is `None`.** Never configured, configured empty, and dropped
   by `build.rs:53`'s emptiness guard are one value. No wrapper fixes this without changing the
   macro; the answer is to use `env!` where absence must fail, and a declaration for the rest.
2. **Cargo cannot require an environment variable per profile.** `build.rs` can `panic!`, but that
   breaks every developer build; there is no "required in release only". So `build.rs:32-42`'s list
   can only ever be advisory — which is why it is a contract nothing enforces.
3. **`cfg!` cannot enumerate.** There is no `cfg!(all_features)` or reflection over the enabled set,
   so `BuildIdentity.features` must be a hand-written list of `cfg!(feature = "x")` tests, one per
   feature. Eight features means eight lines that a ninth feature will not update. This is the one
   place the type is genuinely leaky, and it is why §9's rule remains useful after the type lands.
4. **Vite's `import.meta.env` is an untyped string bag.** There is no `env.d.ts` declaring the
   `VITE_*` surface, so `import.meta.env.VITE_APP_TEIR` type-checks and inlines `undefined`. `define`
   is the only frontend mechanism that can fail at config time, and it is used for one variable.
5. **`--remap-path-prefix` is the only lever on C2, and it is a build-configuration change.**
   Dependency panic metadata puts the build machine's paths into the binary 2,813 times with no
   source edit involved. Out of bounds for this campaign (it changes what the compiler emits), and
   listed so a future pass does not re-derive C1 as if it were the whole problem.
6. **The census runner cannot join a generator to its output, or a codegen task to a drift check.**
   Both are relational properties across `scripts/`, `.github/` and the generated file. `scanRule`
   matches one regex against one file's content with no cross-file state — the same limit
   [environment-variable-configuration §9](./environment-variable-configuration.md) hit joining a
   reader to a writer, and [feature-flagged-compilation §9.2](./feature-flagged-compilation.md) hit
   reading a build invocation. §9 refuses on exactly this ground and names the checker instead.
7. **A census rule cannot assert that an artifact *contains* something.** The strongest evidence in
   this document — a credential in a 137.6 MiB binary, a build-machine path in it, `desktop-full`
   absent from it — came from scanning a compiled artifact, which no source-pattern gate can reach
   and no CI job here produces cheaply. §9 specifies the artifact scanner separately for that reason.

## 9. The missing gate

### The semantic conditions, stated first

Two, both stack-free:

> **(A)** An artifact, telemetry event, or protocol handshake **claims to identify the build that
> produced it**, and names only a value that many materially different builds share.
> **(B)** A build-time-generated artifact is written **non-atomically onto its committed destination**,
> so an interrupted build leaves a file that nothing downstream can distinguish from a complete one.

What follows is **one repo's proxy for (A)**, an explicit **refusal for (B)** with the numbers that
forced it, and a second refusal plus the instrument that does work. Per the
[portability test](../research/portability-test.md), a proxy does not travel: an adopting repo
inherits the two sentences and re-derives its own signal against its own idiom.

### Rules checked first, and why none of the 140 covers this

Opened and read: **`config-value-frozen-at-compile-time`** (keys on `option_env!` — whether a value
was *frozen*, not whether the artifact can *report* it; disjoint match set from mine, zero overlap);
**`env-default-conflates-unset-with-empty`** (`??` on an env read; JS/TS lane, different anchor);
**`build-gated-ipc-entrypoint`** (`#[cfg]` in `generate_handler![]` — existence, not identity);
**`undeclared-tier-branch`** and **`unfalsifiable-tier-guard`** (where a tier is *consumed*);
**`machine-specific-path-in-tooling`** (literal machine paths, roots `scripts`/`.ai`, not
`src-tauri`). **No existing rule matches `env!(` anywhere.**

### 1. Census rule — `version-only-build-stamp`

Published as fenced JSON for the orchestrator to merge; **`scripts/census/rules.json` was not
edited**, per the contract's concurrent-writer warning.

```json
{"rules":[
  {
    "id": "version-only-build-stamp",
    "goldenPath": "docs/concepts/golden-paths/compile-time-env-embedding.md",
    "title": "A durable or transmitted record is stamped with the compile-time version as its ONLY build identity, so two materially different builds of the same version are indistinguishable in the record",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:\\b(?:release|version|app_version|saved_by)\\s*:\\s*(?:Some\\(\\s*)?|\"version\"\\s*:\\s*|\\bconst\\s+[A-Z_]*VERSION[A-Z_]*\\s*:\\s*&(?:'static\\s+)?str\\s*=\\s*)env!\\s*\\(\\s*\"CARGO_PKG_VERSION\"\\s*\\)",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "the compile-time crate version written into a struct field, a serialized JSON key, or a transmitted protocol constant, as that record's whole build identity. PROXY FOR the stack-free condition: \"an artifact, telemetry event or protocol handshake claims to identify the build that produced it, and names only a value that many materially different builds share.\" MEASURED BY EXECUTION 2026-08-16 against the real artifacts on disk, not by reading source: src-tauri/target/release/personas-desktop.exe (137.6 MiB) contains the literal 'desktop-full' ZERO times and carries no git sha, no build timestamp and no feature list, so the ONLY way to determine which cargo feature set produced it was to grep it for third-party crate names left behind by the optional dependencies (quinn 247 occurrences and mdns 114 => the p2p feature was on; fastembed 10, sqlite-vec 41, onnxruntime 2 => ml was on). dist/assets/*.js (1,399 chunks, 30.9 MiB) survives with ZERO occurrences of the string 'import.meta.env' - every build-time value is fully inlined - and BUILD_MAX_TIER is minified away, so the bundle cannot report which of build:starter/build:team/build:builder produced it, and dist/index.html carries no version, no tier and no date. Both Sentry inits set release from this same version constant (src-tauri/src/main.rs:87, src/lib/sentry.ts:202) and NEITHER sets Sentry's `dist` field, which exists precisely to separate builds within one release - so a crash from tauri:dev:lite, tauri:build:stable, a starter bundle and a builder bundle all arrive tagged 1.1.0 with nothing to tell them apart. THE FIX IS A TYPE, NOT MORE CALL SITES: one BuildIdentity struct constructed once from the version PLUS the compiled feature set (a cfg!-derived list; there are currently ZERO cfg!(feature=..) tests in 963 .rs files) PLUS a build.rs-forwarded commit sha, ts-rs-exported so the frontend and every export bundle carry the same shape. Every match below then becomes a field of one value instead of a hand-written version string. PRECONDITION (must be re-derived per repo): this proxy keys on Rust's env!(\"CARGO_PKG_VERSION\") and on struct-field / JSON-key / associated-const syntax. A repo that stamps identity from package.json at bundle time (NEXT_PUBLIC_APP_VERSION), from a Docker label, or from an npm-injected npm_package_version scores ZERO here while the same condition is present - measured across five sibling repos on 2026-08-16, NONE of the five can report its own commit sha, branch, build timestamp or build profile at runtime, so the condition is fleet-wide and only the markup is local."
    },
    "baseline": { "files": 11, "matches": 13 },
    "floor": 900
  },
  {
    "id": "version-only-build-stamp-positive-control",
    "goldenPath": "docs/concepts/golden-paths/compile-time-env-embedding.md",
    "title": "POSITIVE CONTROL - not a rule; the SAME anchor pointed at the EPHEMERAL position, to prove the rule discriminates on where the frozen version LANDS and not on the macro itself",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:tracing::(?:info|warn|error|debug|trace)!|println!|eprintln!|format!|write!|writeln!|\\.user_agent\\()[^;]{0,200}?env!\\s*\\(\\s*\"CARGO_PKG_VERSION\"\\s*\\)",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "POSITIVE CONTROL - the merger must SKIP this entry (no baseline, `-positive-control` id suffix). Same anchor as version-only-build-stamp, env!(\"CARGO_PKG_VERSION\"), but pointed at the position where freezing the version alone is FINE: a log line or a format string, which is ephemeral and sits next to the other lines a reader can correlate it with. It PARTITIONS the anchor's 22 raw matches in this tree rather than reporting a ratio: 13 land in a durable or transmitted record (the rule) and the remainder land in a log or format expression (this control). Its purpose is to prove the discriminator is the DESTINATION, not the macro - a matcher that drifted into counting every env! read would show up here as the two populations merging toward 22, and a matcher whose anchor rotted would show up here as zero over the same 963-file walk. It gates nothing and carries no baseline, because a ratchet is monotone-downward and there is no reason to discourage logging the version."
    },
    "floor": 900
  }
]}
```

**Counts verified through two independent implementations before baselining, and then hand-verified
anyway.** Implementation A is a content regex (what the engine runs); implementation B walks every
`env!("CARGO_PKG_VERSION")` token and classifies it by walking *backward* to the enclosing syntactic
position. **They agree: 22 total, 13 violating** — and agreement was not taken as soundness. Opening
all 22 found that an earlier, looser version of the pattern (accepting `=` as well as `:`) had
**2 false positives** — `src/daemon_bin.rs:105` is a `tracing::info!(version = …)` structured field
and `src/main.rs:35` is `let version = …; println!(…)`, both ephemeral. Restricting the assignment
form to `:` removes both. **Precision is 13/13.** The trade is one false negative,
`crash_telemetry.rs:74`, which binds through a `let` before inserting into the `frontend_crashes`
table; it is named in §7 B2 as a ticket rather than admitted into the rule, because widening the
pattern to `let` re-admits both false positives. **Two `const SERVER_VERSION` sites are matched by
the third alternation branch** — they were missed by the first draft, which is the doctrine's
vocabulary-recall warning arriving on schedule (*"the words you forget to list are
disproportionately the interesting ones"*: those two are the MCP handshakes, the only stamps that
travel to another program).

**The positive control partitions rather than reporting a ratio**: over the same 963-file walk, the
same anchor yields **13 durable-record matches (11 files)** and **7 log/format matches (6 files)**.
Two of the 22 fall in neither bucket (`gitlab/converter.rs:326`, `commands/credentials/auto_cred_browser.rs:305`
— format expressions longer than the control's 200-character bounded span), and that is reported
rather than tuned away.

**Validation — standalone in a private scratch registry, then re-extracted from this document and
re-run.** Filename unique to this composition per the shared-scratchpad collision incident:
`census-cte-7f3a1c.json`. `node scripts/census/run-census.mjs --rules <scratch>/census-cte-7f3a1c.json --check`

```
  rule                                        files  base  matches  base  walked  floor
  OK  version-only-build-stamp                   11    11       13    13     963    900
  OK  version-only-build-stamp-positive-control   6     —        7     —     963    900

  census OK — 2 rule(s), 1926 file-visits, 20 surviving violation(s) across 17 file(s).
```

Exit 0, byte-identical on repeat, and identical again when the JSON block above was extracted from
this document and re-run. `963 walked` is exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json) — an independently derived count agreeing, which is the
only reason to trust the walk. Whole run ≈ 4 s; no lookbehind, every quantifier forward-anchored and
bounded (`{0,200}?`), so neither pattern can backtrack across a file.

**Fault injection against the real tree.** A gate that cannot fail is not a gate.

| Induced fault | Exit | Reported as |
|---|---|---|
| unmutated baseline | **0** | surviving counts printed |
| rule matcher matches nothing | **1** | `[structural] matched zero files anywhere` + `[drift] files dropped 11 → 0` |
| floor above the walk (`9000`) | **1** | `walked 963 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| renamed root (`src-tauri-x`) | **1** | `walked 0 files but floor is 900` |
| count rises (baseline 10) | **1** | `[drift] files rose 9 → 11 (+2)`, `matches rose 10 → 13 (+3)` |
| silent drop (baseline 40) | **1** | `matches dropped 40 → 13 (-27) without the baseline moving` |
| stale `exclude` | **1** | `exclude "…" matched no file. The exemption is stale` |
| unexplained `exclude` (4-char reason) | **1** | shape validation |
| missing `goldenPath` | **1** | shape validation |
| invalid regex | **1** | `Invalid regular expression` |
| **control** given a `baseline` | **1** | `a positive control must NOT carry a baseline` |
| **control** anchor rots | **1** | `matched zero files anywhere` |
| **control** root renamed | **1** | `walked 0 files but floor is 900` |

**Twelve mutations, twelve failures, one clean baseline.** No `exclude` entries: there is no file that
must legitimately contain this shape, and an exclude added for symmetry is a stale exemption waiting
to happen.

**What this rule does and does not buy.** It is a ratchet that stops a 14th hand-written version
stamp landing. It does **not** fix the 13, and it cannot: the fix is `BuildIdentity` (§4), after which
the honest move is to **delete this rule** rather than baseline it at 0 — the census cannot express
"must be zero" and says so itself.

### 2. REFUSED as a census rule — the non-atomic generated write (condition B). The numbers that forced it.

This is the condition I most wanted to gate, and the refusal is on the **positive control**, not on
precision.

- Candidate signal: `writeFileSync\s*\(` under `scripts/` → **116 matches across 67 files**. Within
  the 11 codegen generators specifically, **15 sites, precision 15/15** — every one writes a committed
  generated artifact.
- Required positive control: the same anchor pointed at the **compliant** form, `renameSync` /
  `fs.rename` after a temp write, under the same roots → **0 in code this repo owns** (the 20 raw
  matches are all vendored `sql.js` inside `scripts/mcp-server/node_modules/`).

**A control that returns zero cannot do its job.** It exists to distinguish "my matcher works and the
compliant form is genuinely absent" from "my matcher is broken", and at 0 those two are the same
reading. Shipping the rule anyway would be shipping an instrument I could not assert. *(The compliant
form is not absent from the repo — it is absent from this lane: 18 `fs::rename` sites across 8 Rust
modules, §3. That is a strong argument for the fix and not a usable control for a JS-lane rule.)*

**The fix does not need a gate.** It is 3 lines per generator — write to `<dest>.tmp`, `renameSync`
onto `<dest>` — 12 times, and then the condition is structurally impossible rather than counted. Do
that instead of gating it.

### 3. REFUSED as a census rule — "a generated artifact has no drift check" (relational), and here is the checker.

The condition is relational: it joins a task in `run-codegen.mjs`'s `TASKS` to its output path to a
`git diff` step in `ci.yml`. `scanRule` has no cross-file state (Gap 6). It is also an **absence**,
which the census cannot assert in either direction.

**Specify instead `scripts/check-codegen-contract.mjs` (~90 lines), wired into `npm run check:contracts`**
so it runs with no cargo build and no vite build:

- **Read the tasks as structure.** Parse `scripts/run-codegen.mjs`'s `TASKS` object and both
  `PRESETS` arrays (they are static object/array literals by deliberate design — the file says
  *"no glob/auto-discovery, so the set of codegen tasks is reviewable in one place"*).
- **Read each generator's destinations by position, not by pattern**: the argument expressions of
  `writeFileSync` / `writeFile` calls, resolved through the module-scope `const` they reference
  (`OUTPUT`, `OUT_FILE`, `RUST_OUTPUT_FILE`, `OUTPUT_RS`, `MANIFEST_FILE`, …). Everything inside a
  comment or a quoted message is out of scope **by position** — the same reason
  [feature-flagged-compilation §9.2](./feature-flagged-compilation.md) refused its build-invocation
  rule.
- **Assert five things.** (a) Every destination under `src/` or `src-tauri/` that is git-tracked is
  named by a `git diff --quiet` step in `.github/workflows/ci.yml` **or** carries an explicit
  allowlist entry with a `reason`. (b) Every write to such a destination goes through a temp path
  plus a rename (condition B, enforced structurally instead of counted). (c) Every such file's first
  8 lines name its generator (34/34 pass today — this locks in the repo's best existing practice).
  (d) Every task appears in **both** presets or carries a reason for appearing in one
  (`checksums` is prebuild-only, `host-check` predev-only — both deliberate). (e) `CODEGEN_TIMEOUT_MS`'s
  default is still finite and the runner still exits non-zero on failure, so the safety net that makes
  E1 survivable has not been removed.
- **Fail loudly if its own precondition is absent** — the point of the exercise. Assert the walk found
  **≥ 12 tasks, ≥ 14 write destinations, ≥ 30 git-tracked generated files, and ≥ 2 existing drift
  steps** before asserting anything about them (measured today: 13 / 15 / 34 / 2). A parser that
  silently stopped resolving destinations would otherwise report a perfect contract. Print the
  audited totals on success — `codegen contract OK (13 tasks, 15 destinations, 34 generated files, 2
  drift-checked, 32 allowlisted)` — so a green log distinguishes a clean run from an empty one.

**Its first run fails on 32 files**, which is the correct outcome and the reason to build it: the work
is writing the allowlist with a reason per entry, not writing the checker.

### 4. Specified, not refused — the artifact scanner, because no source gate can reach the evidence

Everything strongest in §7 A, C and D came from scanning a compiled artifact, and **no source-pattern
gate can see any of it** (Gap 7). This is not a census rule and should not be one; it is a
**release-time** step, and it must not run in `ci.yml`, which builds no installer and is red on 10
pre-existing failures.

Add to `release.yml`, after `tauri-action` and before the upload: scan the produced executable and
`dist/` for (i) credential *shapes* — JWT, `GOCSPX-`, `*.apps.googleusercontent.com`,
`*.ingest.sentry.io` DSN, `<ref>.supabase.co` — failing on any match with **name, offset and count
only, never the value**; (ii) the runner's own home-directory path; (iii) the **presence** of the
`BuildIdentity` marker, so a build that lost its provenance stamping fails rather than ships
anonymously. The precondition that keeps it honest: assert the scanned file is **> 50 MiB** and that
the known-good marker (`CARGO_PKG_VERSION`'s value) is present before asserting any absence —
otherwise a scanner pointed at a missing path reports a clean bill of health forever, which is the
`ci.yml` failure mode the contract's §9 was written against.

### On severity, if any of this ships as an ESLint rule

Nothing here is proposed as an ESLint rule, so the question does not arise — and it must not be
argued from warning volume in either direction. The count-independent argument is the only one that
holds: `npm run check` runs `eslint src/` with **no `--max-warnings`** (`package.json:51`), and the
pre-commit hook runs `--quiet --max-warnings 99999` (`lefthook.yml:20`), where `--quiet` discards
warnings before they can be counted. **A warn-level rule enforces nothing at either gate, at any
count.** The census is a different mechanism: `census:check` exits 1 on drift and is already inside
`npm run check`.

## Does "across a build boundary" belong in the doctrine's list? YES — with the qualification that makes it useful

The [doctrine §1](../golden-path-doctrine.md) names three places a type cannot reach — inside a SQL
string literal, through a `OnceLock`, in an ambient environment variable — and a fourth was added
later: across a JSON boundary before the type exists. The brief asked whether a fifth belongs.

**It does, and this leaf is its home. But the boundary is not uniformly opaque, and stating it
without the qualification would be false.** Measured in this repo:

- **`env!("X")` DOES reach across it.** An absent variable is a compile error. This is a genuine
  type-level guarantee crossing from build time into run time, and it is the reason §2 prescribes
  `env!` over `option_env!`. A flat "types cannot reach across a build boundary" would have told a
  composer to give up on the one mechanism that works.
- **`option_env!("X")` does NOT.** `Option<&'static str>` is the same type for never-configured,
  configured-empty, and dropped-by-the-guard. The type is present, well-formed, and carries zero
  information about arrival.
- **`import.meta.env.VITE_X` does NOT.** No `env.d.ts` exists, so the value is `any`; a typo
  type-checks and inlines `undefined`.
- **`cargo:rustc-env` from `build.rs` reaches further than an `[env]` table** — the documented
  `TS_RS_EXPORT_DIR` case (`build.rs:1-21`) is a value that silently failed to arrive at proc-macro
  expansion and had to be re-routed. Nothing typed it either way; the drift was found in git.

So the entry, in the doctrine's own voice:

> **5. Across a build boundary.** A value frozen when the artifact is built carries no type-level
> record of *whether it arrived, or what it was*. `option_env!` returns the same `None` for never
> configured, configured empty, and dropped by the build script; a bundler `define` for a name
> nobody set inlines `undefined` and type-checks. The discriminator is **whether the mechanism is
> allowed to fail**: `env!` is a compile error when the variable is absent and therefore *does*
> carry the guarantee across; every mechanism that returns an `Option`/`undefined` instead of failing
> erases exactly the information a type would have carried. Prefer the failing form; where you
> cannot, the value's provenance must be recorded *in the artifact*, because after the build there is
> nothing left to ask.

That last clause is what distinguishes this from the other four. Items 1–4 are **spatial** — the
value crosses a boundary the compiler does not model, but both sides still exist and can be
inspected. This one is **temporal**: the other side of the boundary is gone. `feature-flagged-compilation`'s
conclusion is the same shape from the code direction (*"the callee always exists; absence is a typed
refusal"*) and it is the strongest converged result in the corpus. This leaf is that principle
applied to values instead of symbols, and its version reads: **the record always exists; a build that
omitted something must say so, in the artifact.**

## Convergence — six repos agree, and they agree on the omission

Read-only sweep, 2026-08-16, of `../personas-web` (Next.js App Router), `../brainiac` (Rust workspace
+ Next.js console, docker-compose), `../personas-cloud` (Node orchestrator + FastAPI facade),
`../vibeman` (Tauri + Next.js), `../ascent` (Next.js on Vercel). All five exist. No values read;
names, shapes and counts only. Nothing was edited.

| | **personas** | personas-web | brainiac | personas-cloud | vibeman | ascent |
|---|---|---|---|---|---|---|
| Runtime build identity | version only | version only (marketing UI) | version (3 surfaces) | **none** | version, **and it lies** | **none** |
| git SHA / branch / CI id | **none** | **none** | **none** | **none** | **none** | **none** |
| build timestamp | **none** | **none** | **none** | **none** | **none** | **none** |
| build profile / feature set / tier | **none** | **none** | **none** | **none** | **none** | **none** |
| Freeze mechanism | `option_env!` ×11, 1 `define` | 1 `define` (3 keys), 18 inlined names | 4 Docker `ARG`→`ENV`, 5 `env!` (all `CARGO_*`) | **zero of everything** | 2 `env!` | 4 inlined, 0 defines |
| Committed generated artifacts | **34** | 1 | ~2 | 0 | 0 | 12 |
| Drift check on them | **2 of 34** | none | **YES — 1, and it is good** | n/a | n/a | none |
| Generator writes atomically | **0 of 12** | no | no | n/a | n/a | no |
| Telemetry `release` from a build value | **yes**, `dist` unset | **no** (`environment` only) | **yes**, `dist` unset | no reporter | none | none |
| Secret frozen into a shipped artifact | **yes** (§7 D1) | **yes** (`NEXT_PUBLIC_TEAM_API_KEY`) | no (publishable ids only) | n/a | n/a | no |

**Physics — reinvented independently, so these clauses travel.**

- **"A build-time value is frozen and its provenance is not." Six of six.** Not one repo can report
  its own commit, branch, build timestamp, or build profile at run time — across Rust, TypeScript,
  Python; across cargo, Next.js, Vite, Docker. **Two are handed it for free and do not take it**:
  `ascent` deploys on Vercel where `VERCEL_GIT_COMMIT_SHA` is ambient and unused (its
  `src/app/api/health/route.ts` is thorough about dependency readiness and silent about identity);
  `brainiac` builds in GitHub Actions where `github.sha` is ambient and never becomes a `ARG`, and
  its `Dockerfile` has none. **This is the strongest agreement the oracle has produced for this
  leaf — and see §12: agreement on an omission is not a converged answer.**
- **The `/health` endpoint that exists is the wrong shape, three times.** `brainiac`'s returns
  `{"status":"ok"}` and nothing else, while the *version* it does know is served only from
  `/openapi.json` and the MCP handshake — i.e. the endpoint an operator actually curls is the one
  that tells them nothing. `personas-cloud`'s adds a static service name. `ascent`'s reports
  dependency readiness and no identity. Personas has no equivalent surface at all. **Four
  independent teams built a liveness probe and none built an identity probe**, which is precisely
  the shape of §4's `BuildIdentity` gap.
- **"The version string is the only identity, and it can be a lie."** `vibeman` is the instructive
  case: its Tauri half is honestly build-frozen (`src-tauri/src/commands/system.rs:12`
  `env!("CARGO_PKG_VERSION")`), but its Next.js half reads `npm_package_version` — **injected by the
  npm CLI at run time, not frozen at build** — with `readOr(..., '1.0.0')`
  (`src/lib/config/envConfig.ts:77`). Any production start not launched through an npm script
  (systemd, `CMD node server.js`, PM2) reports **`1.0.0`, a version that project has never had**
  (`package.json` says `0.1.0`). Personas' `src/main.tsx:299` `let appVersion = "dev"` is the same
  defect with a less plausible literal — and a less plausible literal is *better*, because `"dev"`
  looks wrong in a dashboard and `1.0.0` does not.
- **"A prose warning in the same file as its own violation."** `personas-web/.env.example:3` states
  *"All `NEXT_PUBLIC_*` vars are inlined into the client bundle at build time — never put secrets
  here"* and line 20 declares a real shared team secret (compared with `timingSafeEqual` at
  `personas-cloud/packages/orchestrator/src/auth.ts:104-113`). Personas' own version of this shape is
  §7 E4 — `vite.config.ts:46-49` warns against bypassing the codegen hook and `.claude/CLAUDE.md`
  documents the bypass as a standard command. **Two repos, same failure: documentation used where a
  mechanism was needed.**

**The single practice worth importing, and it comes from the control repo.** `brainiac` has the only
genuine drift check in the fleet, and it is better than a `git diff` step:
`crates/brainiac-server/src/openapi.rs:425` `fn committed_document_is_current()` asserts, **as a unit
test**, that the committed `openapi.json` equals what the code generates — EOL-insensitive, failing
with regeneration instructions, running under `cargo test` in CI. A test rather than a workflow step
means it runs locally, in every fork, and cannot be skipped by a `continue-on-error`. **That is the
right shape for §9 item 3's assertion (a), and Personas' 32 unchecked generated artifacts are the
population it should cover.** *(Its own second hop is unchecked — `console/package.json:13`'s
`gen:api` can lag a regenerated `openapi.json` — reported upward, not edited.)*

**Local calibration — no trace anywhere else.** `option_env!`-fed-by-a-`build.rs` is Personas-specific:
`brainiac`'s Rust workspace has **zero** `option_env!` and no `build.rs` at all; `vibeman`'s has zero.
The three-tier frontend bundle is likewise unique in the fleet. So the *markup* of §9's proxy is
local, exactly as its `PRECONDITION` clause says — while the *condition* is six-for-six.

**One correction offered upward to a sibling, not applied.** `../vibeman`'s
`src/app/api/health/route.ts:148` will report `1.0.0` for any non-npm-launched production start. A
health endpoint that fabricates a version is worse than one that omits it, because a monitoring
system will believe it.

---

**Composition note.** Nothing in this document was applied. Two changes are one line each and both
are behaviour-neutral, and they are still left as notes because they touch the build lane the
operator uses daily: correcting `.claude/CLAUDE.md`'s `npx vite build` entry (§7 E4), and setting
Sentry's `dist` (§4). Per the [runbook](../golden-path-runbook.md), when in doubt it is a note.
