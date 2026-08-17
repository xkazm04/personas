# Golden path — Dev-only diagnostics

> Situation node: `product-surfaces/monitoring-surfaces/dev-only-diagnostics` ·
> [situation spine](../situation-spine.md) · recurrence 12 · risk **medium** ·
> sides: **client** · convergence: **converged** ·
> dimensions: **code-quality · performance · security**
> Composed 2026-08-17 against `master` @ `6c97502d3`, and **every count
> re-verified at `c7c153b57`** after a concurrent session landed
> *"delete the unreachable `sub_canvas` tree (29 files, 3,200 lines)"*
> mid-composition. The census baseline (15 files / 18 matches) and the 75/86
> inventory are byte-identical at both commits; only the `.tsx` denominator moved
> — **`frontend.tsxFiles` 2,104 → 2,083** — which is why the rule's `floor` is
> 1,500 and not a number near the true count. Mode-2 batch
> (`product-surfaces/monitoring-surfaces`), shared measurement pass with
> [`usage-analytics`](./usage-analytics.md) and
> [`session-delta-digest`](./session-delta-digest.md).
>
> **Sweep.** Every `import.meta.env.{DEV,PROD,MODE}` site in `src/`
> (`frontend.tsFiles` **4,829**, of which `frontend.tsxFiles` **2,104** at
> `6c97502d3` and **2,083** at `c7c153b57` — both cited from
> [`shared-facts.json`](../shared-facts.json) and re-verified by running the
> recorded instrument, exit 0, no `value` changed). Every
> `debug_assertions` site under `src-tauri/` (`rust.files` **963**). All **5**
> git-tracked Tauri config files. `src/App.tsx` (dev-gate cluster of 9),
> `src/features/personas/PersonasPage.tsx` (6), `src-tauri/src/lib.rs`'s
> webview-plugin and test-bridge blocks, `src-tauri/src/test_automation.rs`
> (46 routes), `src/test/automation/bridge.ts` (2,887 lines / 120 exposed
> methods), `src-tauri/src/commands/fleet/bench.rs` (336 lines),
> `src/lib/navigation/registry.ts`, `src/features/shared/chrome/sidebar/sidebarData.ts`,
> and the six `handleSeed*` render sites.
>
> **Measured by executing, not by reading.**
>
> 1. **The dev-gate inventory was produced twice** — once by a bespoke line
>    scanner over raw source, once by the shared instrument
>    `scripts/census/lib/instruments/stripComments.mjs`. Their disagreement is
>    reported in §6.2 and is the reason the headline count is 75 and not 86.
> 2. **The census runner was run in a private scratch registry** over the
>    proposed rule and its positive control (§9). The full registry was **not**
>    run, per the doctrine.
> 3. **19 hand-written fault injections** were run against the *final published*
>    pattern, covering both the forms it must match and every compliant/adjacent
>    form it must not. All 19 pass; the script is in §9.4.
> 4. **The i18n cost of the dev-only affordances was counted against all 14
>    locale catalogs**, not estimated.
> 5. **CI was queried**, not assumed: `gh run view 32025966929` for the most
>    recent completed run of the `CI` workflow.

---

## 0. The headline

**The backend's gate on the test-automation bridge has three arms and gets it
right. The frontend's copy has one arm, and it is the wrong one.**

`src-tauri/src/lib.rs:1556-1583` compiles three mutually exclusive versions of
the bridge's port decision, and the third one exists specifically to say no:

```rust
#[cfg(feature = "test-automation")]                                    // always on
#[cfg(all(not(feature = "test-automation"), debug_assertions))]        // env override, debug only
#[cfg(all(not(feature = "test-automation"), not(debug_assertions)))]   // refuse + warn
```

with the reasoning written above it: *"Release installers must never expose the
bridge: it has no auth and its routes include `/eval` (arbitrary JS in the
webview) and `/list-credentials`, so an env var alone must not be able to open it
on an end user's machine (ship-loop security audit 2026-07-02)."* That is a
correct gate, and the release arm is a `tracing::warn!`, not a silent drop.

Twenty lines earlier, at `lib.rs:589-601`, the flag that tells the **frontend**
to load its half of the bridge is injected with no `cfg` at all:

```rust
let test_port = test_automation::env_test_port();
...
if test_port.is_some() {
    final_builder = final_builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("test-mode-flag")
            .js_init_script(String::from("window.__PERSONAS_TEST_MODE__ = true;"))
```

and the frontend consumes it as a **disjunct** at `src/App.tsx:226`:

```tsx
if (import.meta.env.DEV || (window as unknown as Record<string, unknown>).__PERSONAS_TEST_MODE__) {
  void import("@/test/automation/bridge").then(() => import("@/test/automation/perfInstrument"));
}
```

In a release installer, `import.meta.env.DEV` folds to `false` — and because the
`||` keeps the expression alive, Rollup cannot drop the dynamic import, so the
chunk ships. Setting `PERSONAS_TEST_PORT` on an end user's machine therefore
attaches **`window.__TEST__`** — 2,887 lines, **120 methods**, including
`invokeCommand(command, params)` at `bridge.ts:693-695`, a generic door to any
registered Tauri command from the page context. The HTTP server that would drive
it is correctly refused; the in-page surface it drives is not.

The contrast that makes this a golden-path finding rather than a bug report sits
**180 lines above it in the same file**. `App.tsx:42-50` gates the source
inspector the other way and writes down exactly why:

```tsx
// Conditional + lazy so the module and its chunk are absent from prod builds:
// in prod `import.meta.env.DEV` is replaced with `false`, the dynamic import is
// never referenced, and Rollup drops it.
const DevInspector = import.meta.env.DEV ? lazy(() => import("@/lib/dev/DevInspector")) : null;
```

One file. Two dev-only diagnostics. The author knew the tree-shaking property,
stated it, and applied it to the **lower**-privilege of the two.

Beneath that headline, the inventory. **75 build-flag sites in 54 files**
(two implementations; §6.2), of which **18 in 15 files are inline at a JSX
render site** — while this repo already has a declarative answer,
`devOnly` on a catalog entry resolved by one total function
(`lib/navigation/registry.ts:154` `passesGates`), used at **8 sites in 3 files**.
Six of the eighteen are the same hand-rolled "seed a mock row" button copied
across six surfaces, and their labels are fully translated: **168 strings across
14 locales** (12 keys × 14, 0 missing) shipped in every production bundle for
buttons that fold to `false`. And the four performance gates in
`commands/fleet/bench.rs` — genuinely well-designed, asserting ratios rather
than machine-specific p99s — run only where `cargo test` runs, and the most
recent completed CI run failed `rust-tests` on **all three** operating systems,
in `personas-db`, with no `--no-fail-fast`.

---

## Principle (stack-free head)

A diagnostic surface exists to tell a developer something the product does not
tell a user. That makes it, by construction, **a second product with a different
threat model and no users to complain about it** — and every property that
follows comes from taking that seriously.

**One. Decide what the gate is protecting against, and say it out loud.** There
are three different reasons to hide a diagnostic and they need three different
mechanisms. *Noise* ("this is ugly and users don't need it") is a visibility
concern and a declarative flag on the surface's catalog entry is enough.
*Weight* ("this ships 200 KB of instrumentation") is a bundling concern and needs
a form the compiler can fold away. *Privilege* ("this can read credentials or
evaluate arbitrary code") is a security boundary and needs a gate that cannot be
re-opened at runtime by anything the attacker controls. A single `if (DEV)`
spelled the same way for all three is three different promises made with one
word, and only one of them will hold.

**Two. A build flag is a compile-time constant only where nothing else can
reach the branch.** The moment you write `DEV || <runtime value>`, you have a
runtime gate wearing a build flag's clothes: the dead-code eliminator can no
longer remove the branch, the code ships, and whoever controls the runtime value
controls the feature. This is not a subtle property — it is the difference
between "absent from the artifact" and "present and disabled" — and it is
invisible in review because both spellings read as "dev only".

**Three. Declare the gate on the surface, resolve it in one place.** A gate
inlined at a render site is a decision that cannot be enumerated, tested, or
audited: nothing can answer "what is hidden in production?" without reading every
file. A gate declared as a field on the entry that already describes the surface
— its id, its label, its icon, its tier — is a decision that a single resolver
applies, a single test covers, and a single query can list.

**Four. Gate the readout, never the capability.** Hiding a panel that *shows*
something costs nothing when you are wrong. Hiding the only control that
*performs* something — especially the control that undoes a privileged action —
means the capability still exists and the user can no longer reach it. When a
capability and its diagnostic UI are gated together, the correct split is almost
always: capability ships, readout hides, and the *undo* ships with the
capability.

**Five. A dev-only affordance still costs the shipped artifact.** Its strings
are in the bundle, its translations are in every locale catalog, its chunk may
still be emitted, and its backend command is still registered. If it is worth
building, it is worth one shared primitive rather than six copies — because the
copies are what make the cost invisible.

**Six. If you built a gate to protect a claim, run it where the claim is
made.** A performance assertion that only executes in a suite nobody watches is
documentation with a semicolon.

---

## 1. Trigger

You are in this situation when you catch yourself typing or saying:

- "let's add a debug panel / an inspector / a seed button so I can test this"
- "hide this behind `import.meta.env.DEV` for now"
- "this tab isn't ready for users yet"
- "I need a way to drive the app from a script"
- "wrap it in `#[cfg(debug_assertions)]`" / `#[cfg(feature = "…")]`
- **the "if you are about to write X" test:** if you are about to type
  `{import.meta.env.DEV && …}` inside JSX, or `DEV || something`, stop. The
  first belongs on a catalog entry (§3); the second is not a build gate at all.

You are **not** in this situation when the surface is hidden by *tier* or by
*plan* — that is a product gate on a paying axis, resolved by
`tier.isVisible(...)` through the same registry, and its failure modes are
commercial rather than diagnostic. You are also not in this situation for a Rust
`#[cfg(feature = …)]` that changes which *implementation* compiles — that is
[`feature-flagged-compilation`](./feature-flagged-compilation.md), whose census
rule `build-gated-ipc-entrypoint` already ratchets the IPC half.

---

## 2. The one way

**Pick the mechanism from the reason, declare the gate on the surface's catalog
entry, and never join a build flag to a runtime value with `||`.** Concretely:
(a) if the reason is *noise*, add `devOnly: true` to the entry in the registry or
catalog that already describes the surface (`NAV_SECTIONS`, `sidebarData`'s item
arrays, a `TabDef`) and let the one resolver — `passesGates(gates, { isDev,
isTierVisible })` at `lib/navigation/registry.ts:154` — decide; write no
`import.meta.env.DEV` at the render site; (b) if the reason is *weight*, use the
foldable module-scope form `const X = import.meta.env.DEV ? lazy(() => import(…))
: null` so the constant folds to `false`, the import is unreferenced, and the
chunk leaves the artifact — and say so in a comment, because the property is not
obvious from the syntax; (c) if the reason is *privilege*, put the gate in the
**backend**, as a `#[cfg]` arm that refuses and logs on the release path, and let
the frontend learn about it only through a signal the backend has already
decided to send — never by re-deriving the decision from an environment variable
it also reads; (d) never write `import.meta.env.DEV || <runtime>` — if you need a
runtime escape hatch, that is a separate, named, deliberately-runtime flag whose
own gate is the backend's; (e) gate the readout and ship the capability, and if
the capability is privileged, ship its **revocation** with it; (f) build the
affordance once as a shared component with one i18n key rather than six times
inline, because six copies is how a dev-only cost becomes a shipped cost nobody
has counted.

If two answers seem correct, reach for the **declarative** one first: a `devOnly`
field is enumerable, testable and greppable as data, and an inline conditional is
none of those. The foldable form is the exception you take deliberately, for
weight, and it should carry the comment explaining what it buys.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `lib/navigation/registry.ts` `NavGates.devOnly` + `passesGates(gates, ctx)` (`:154`) | The one total resolver for "is this surface reachable here", combining dev and tier. Tested at `registry.test.ts:142-154`. **This is the destination for every §7 D2 site.** |
| `features/shared/chrome/sidebar/sidebarData.ts` `devOnly?: boolean` (`:27`, and per-item at `:100,:117,:118,:313,:314,:322,:323,:324`) | The declarative form on a catalog entry, already used for 8 surfaces. `:326` is the single filter that applies it. |
| `features/personas/sectionRouter` `isSectionGated(section, { isDev, isTierVisible })` | The mount-time half of the same decision, so a gated section cannot be reached by a stale persisted destination. |
| `App.tsx:46-50` — the foldable `import.meta.env.DEV ? lazy(...) : null` form | The *weight* mechanism. Copy this exact shape, including its comment, whenever the diagnostic carries a chunk. |
| `src-tauri/src/lib.rs:1556-1583` — the three-arm `#[cfg]` on the bridge port | The *privilege* mechanism. A refusing arm with a `tracing::warn!` on release is what makes the gate auditable. Copy this shape for any diagnostic transport. |
| `commands/fleet/bench.rs` `Samples::collect` / `speedup(slow, fast)` (`:66`, `:121`) | Machine-independent performance assertions — ratios and scaling shape, not committed p99s. The right way to gate a perf claim. |

**Do not** reach for `feedback/LoadingSpinner` as a diagnostic affordance: it
renders `null` (`LoadingSpinner.tsx:12-21` — a compatibility shim that emits only
an `sr-only` `role="status"` when given a `label`). It is not a spinner and not a
ghost. That is repo-wide doctrine, restated here only because a debug panel is
exactly the kind of surface where someone reaches for it without checking.

---

## 4. Steps

1. **Name the reason: noise, weight, or privilege.** Write it in the comment
   beside the gate. Every deviation in §7 is a case where the reason was one
   thing and the mechanism was another.
2. **Noise → declare it.** Add `devOnly: true` to the surface's entry. If the
   surface has no catalog entry, that is the finding: give it one, because a
   surface nobody can enumerate is a surface nobody can audit.
3. **Weight → fold it.** `const X = import.meta.env.DEV ? lazy(() => import(…)) :
   null`, at module scope, with the comment. Verify the chunk is gone from a
   production build rather than assuming it.
4. **Privilege → gate it in the backend, with a refusing arm.** Three `#[cfg]`
   arms, and the release arm logs why it refused. The frontend must not re-derive
   the decision.
5. **Never `||`.** If you find yourself widening a build flag with a runtime
   value, you have changed category from "absent" to "present and disabled" —
   go back to step 1 and check whether the reason was privilege.
6. **Split capability from readout.** List the actions inside the gated subtree.
   For each, ask what happens to a user who already has the state that action
   manages. If the answer is "they cannot undo it", the gate is in the wrong
   place.
7. **Count the strings.** If the affordance carries user-facing text, it will be
   translated into every locale. Either accept that cost knowingly, or build the
   affordance once with one key.
8. **Then stop.** Do not add a `useIsDev()` hook, a `<DevOnly>` wrapper
   component, or a second gate context. `passesGates` and the foldable ternary
   are the whole vocabulary; a third mechanism is a third place the answer can be
   wrong.

---

## 5. Anti-patterns

**`import.meta.env.DEV || <runtime value>`.** The failure mode is a category
change that looks like a widening: the branch survives dead-code elimination, the
chunk ships, and the gate's effective authority moves from the build system to
whoever sets the runtime value. `App.tsx:226` is the live instance and its
runtime value is an environment variable an end user can set.

**Inlining the gate at the render site.** The failure mode is not that any one
site is wrong — it is that the set of them cannot be enumerated. Nothing in this
repo can currently answer "what does a production build hide?" without a grep,
which is why §7 D2's count had to be produced by two scanners rather than read
off a registry.

**Gating a capability and its undo together.** The failure mode is asymmetric
state: the capability was exercised in one build and its state persists into
another where the control that reverses it does not render. Measured instance in
this repo:
[`cross-device-pairing`](./cross-device-pairing.md) §7 — `FleetSettingsPage.tsx:213`
gates `FleetPairDevice` on `DEV`, and the revoke button lives inside it, so a
production user who paired in a dev build cannot revoke.

**Justifying the gate with a comment that has gone stale.** The failure mode is
that the justification is the only record of the decision, so nothing re-examines
it when the premise changes. Same site: the comment says the panel is *"Inert (no
backend handshake yet)"*, and `commands/fleet/pairing.rs:4-5` opens with
*"Replaces the `genToken` UI theatre in `FleetPairDevice.tsx` with a real backend
handshake"*. Both comments are in the repository, and they disagree.

**Six copies of one dev affordance.** The failure mode is cost invisibility: each
copy individually looks like three lines, and the aggregate is 168 translated
strings in every shipped locale bundle plus six handlers no shared test covers.

**A performance gate that runs only where the suite is red.** The failure mode is
the contract's fourth: a gate that no-ops manufactures confidence. `bench.rs`'s
own header says *"These gates therefore run in CI"* — an assertion about the
world, in a comment, which was true when written.

**Assuming `#[cfg(debug_assertions)]` and `import.meta.env.DEV` mean the same
thing.** They are decided by two different build systems that can disagree: a
`tauri dev` run against a `vite build --mode production` frontend, or the
reverse, is a legal configuration. The backend gate and the frontend gate are
two gates, and §7 D1 is what it looks like when they disagree by one arm.

---

## 6. Evidence

### 6.1 The sites to copy

**For privilege: `src-tauri/src/lib.rs:1556-1583`.** Three `#[cfg]` arms whose
union is total, a refusing release arm that logs, and the security reasoning
inline with the date of the audit that produced it. Nothing else in this repo
gates a transport this carefully.

**For weight: `src/App.tsx:42-50`.** The foldable ternary plus the four-line
comment explaining what folding buys. The comment is the load-bearing part —
without it, the next editor rewrites it as `{DEV && <DevInspector/>}` and loses
the property silently.

**For noise: `sidebarData.ts:326` with its eight `devOnly: true` entries.** One
filter, eight declarations, and the set is a queryable list.

**For a performance claim: `commands/fleet/bench.rs:1-46` and its four asserts.**
The header is a model of a gate that explains its own design constraints — why
relative invariants rather than committed p99 baselines, with the rival design
(`grok-build`'s frame-boundary percentiles) tested and rejected for a *measured*
reason: the escape it keys on *"appears once in the bundled binary, isolated in
native code ~43 MB from any other terminal escape"*. That is doctrine's *"test
the rival hypothesis before publishing the discriminator"*, done unprompted, in
a comment.

### 6.2 The inventory, and why the two implementations disagree

| implementation | sites | files |
| --- | ---: | ---: |
| A — bespoke line scanner over raw source | **86** | 59 |
| B — the same scan over `stripComments(src)` (shared instrument) | **75** | 54 |
| A-only | **11** | — |
| B-only | **0** | — |

The eleven are prose *about* the gate, not the gate: `App.tsx:44` and `:381`,
`compositeHealthScore.ts:105`, `FleetBootstrap.tsx:7`, `sidebarData.ts:26`,
`canvasTestBridge.ts:10`, `eventTokens.ts:71`, `DevInspector.tsx:15`,
`registry.ts:49`, `bridge.ts:427`, `perfInstrument.ts:5`. Several are the *most
useful* lines in the file — `FleetBootstrap.tsx:7` reads **"Never mount this
behind `import.meta.env.DEV`. It used to live inside…"**, a warning that a naive
scanner counts as an instance of the thing it warns against.

**75 is the number used everywhere below**, and the shared instrument is what
produced it. This is the second time in the corpus that `stripComments` has been
the difference between a plausible number and a true one.

Distribution of the 75: `DEV` **73**, `PROD` 1 (`sentry.ts:196`), `MODE` 1
(`sentry.ts:203`). Concentration: `App.tsx` **9**, `PersonasPage.tsx` **6**; no
other file has more than 3.

Rust side: `debug_assertions` appears in **20** files under `src-tauri/`, led by
`lib.rs` (8) and `commands/execution/knowledge.rs` (5). `feature = "test-automation"`
appears in **7** files.

### 6.3 The i18n cost of the six seed buttons, counted

| | |
| --- | ---: |
| dev-only `mock_*` / `seed_*` UI keys in `en.json` | **12** |
| locale catalogs | **14** |
| translated strings present | **168 / 168** |
| missing | **0** |
| shipped `section-locales/` bundles containing them | **13** |
| present in `generated/enSectionStrings.ts` | yes |

The keys: `overview.review.mock_review` + `seed_tooltip`,
`overview.messages_view.mock_message` + `seed_tooltip`,
`overview.events.mock_event` + `seed_tooltip`,
`overview.cron.mock_schedule` + `seed_tooltip`,
`overview.knowledge_graph.mock_pattern` + `seed_tooltip`,
`schedules.mock_schedule` + `seed_mock_tooltip`. Every one is a complete,
professionally-consistent translation of a string like *"Seed a mock review (dev
only)"* into Bengali, Vietnamese and Czech, for a button that
`import.meta.env.DEV` folds away.

This is not an argument against translating them — the repo's
`i18n-no-gaps` pre-commit hook is right and the alternative is a half-English
UI. It is a measurement of what six copies of one affordance cost, and the fix
is one shared `SeedMockButton` with one key pair, which would make it **28**.

### 6.4 CI, queried rather than assumed

Most recent **completed** run of the `CI` workflow (`gh run view 32025966929`,
`docs(golden-paths): 3 tiers x 4 efforts…`, 2026-08-17T11:39Z):

```
success    command-name-drift
failure    frontend-checks
cancelled  rust-tests (macos-latest, macos)
failure    rust-tests (ubuntu-24.04, linux)
failure    rust-tests (windows-latest, windows)
success    commit-lint
failure    binding-drift
```

The linux leg's log ends at `Process completed with exit code 101` after
`expected JSON-parse validation error, got: Invalid config JSON` — an assertion in
**`src-tauri/db/src/repos/resources/triggers.rs:2488`**. `ci.yml:298` runs
`cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop`
with **no `--no-fail-fast`** (grepped: the flag appears nowhere in `ci.yml` or in
`scripts/build/run-rust-tests.mjs`), and `personas-db` is a dependency of
`personas-desktop`, so it runs first and ends the step. **`app_lib`'s unit tests —
which is where `commands::fleet::bench`'s four asserts live — do not execute in
this run.**

### 6.5 Convergence — cohort established first, then counted

**Cohort: 3 independent.** `personas-web` is a port of this repo's code *and* a
reader of its tables (disqualified twice over, per doctrine §5); `vibeman`
predates this repo and is treated as an ancestor. That leaves `brainiac`,
`personas-cloud`, `ascent`.

- **`brainiac`: 0 build-flag dev gates in the whole repo.** Not a silence about
  the solution — a silence about the *problem*. Its console has no in-app
  inspector; its diagnostics are server logs and tests.
- **`personas-cloud`: 0.** Same shape.
- **`ascent`: 6 files carry a `NODE_ENV`-style gate**, all around error display
  and none carrying a declarative flag. No `devOnly` field anywhere.
- **`vibeman` (ancestor, reported not counted): 15 files.** Also no declarative
  flag.
- **`personas-web` (port, reported not counted): 5 files, and it is the only
  sibling with the declarative form** — `GuideSidebarContent.tsx:109`
  `const isDevOnly = !!topic.devOnly` on a guide-topic catalog entry. It also
  shows a *partial* compliance worth naming: `error.tsx:28` and
  `global-error.tsx:27` hoist the flag to `const isDev = …` and then still
  inline `{isDev && …}` at the render site — the flag read is centralised, the
  decision is not.

**Verdict on the spine's `convergence: converged` label: it fails, in the mode
the doctrine calls the sharpest — the fleet converged on the disease, and the
label points at a 3/3 silence.** No independent sibling has a declarative
dev-gate mechanism; two of the three have no in-app diagnostics at all, so their
agreement is agreement about *not having the problem*. The only repo in the fleet
with a real declarative resolver is **this one** (`passesGates` +
`NavGates.devOnly`), and the only sibling that has anything similar is our own
port. Personas is ahead here, and §7's finding is that it does not use what it
built at 18 of 26 sites. That makes **14 `convergence` labels tested by the
corpus and 14 that did not survive contact with measurement.**

---

## 7. Deviations

### D1 — The bridge's frontend gate is a one-arm copy of a three-arm backend gate, and the missing arm is the release refusal

`src-tauri/src/lib.rs:1556-1583` — correct, three arms, refusing release arm with
a `tracing::warn!` and a cited security audit.

`src-tauri/src/lib.rs:589-601` — **no `cfg` at all**. `env_test_port()` is read at
runtime and, if set, a Tauri plugin injects
`window.__PERSONAS_TEST_MODE__ = true` into the page before any app JS, in
**every** build.

`src/App.tsx:226` — `if (import.meta.env.DEV || window.__PERSONAS_TEST_MODE__)`
then `import("@/test/automation/bridge")`.

Consequences, each verified:

| | |
| --- | --- |
| the chunk in a release build | **emitted** — `false \|\| runtimeValue` is not foldable, so the dynamic import stays referenced |
| what attaches | `window.__TEST__` = `bridge.ts`'s object, **2,887 lines, 120 methods** (`bridge.ts:2880`) |
| the sharpest method | `invokeCommand(command, params)` (`:105` declared, `:693-695` implemented) — `await invoke(command, params ?? {})`, i.e. **any registered Tauri command, by name, from the page** |
| the HTTP driver | correctly refused on release (`lib.rs:1574-1583`) |
| what still reaches it | anything with script access in the webview |
| the app's IPC auth | the bridge runs *inside* the authenticated page context (`lib.rs:583-592` injects the session token into the same webview), so it is on the trusted side of `ipc_auth` |

The comment at `App.tsx:224-225` describes the intent exactly — *"Loaded in dev
builds always, or in production when `PERSONAS_TEST_PORT` is set"* — so this is a
**known** behaviour on the frontend and a **refused** behaviour on the backend,
twenty lines apart, and nothing reconciles them. `perfInstrument.ts:5` and
`tests/playwright/perf/README.md:140` both restate the frontend's version as the
rule.

**Note, not applied.** The one-line fix — make the plugin injection
`#[cfg(any(feature = "test-automation", debug_assertions))]`, mirroring the arm
the port decision already has — changes whether a documented harness path works,
and the harness is the operator's own workflow. Filed for
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md).

### D2 — 18 inline render-site gates against 8 declarative ones, and the repo built the declarative mechanism itself

Measured by the census rule in §9 (15 files / 18 matches) against its positive
control (3 files / 8 matches).

The eighteen:

| file:line | what it hides | reason it should have used |
| --- | --- | --- |
| `App.tsx:378` | `<StudioAttention />` | noise |
| `App.tsx:390` | `<FleetGridLayer />` | weight (and the comment says so) |
| `App.tsx:409` | mobile-preview badge | noise |
| `PersonaEditorHeader.tsx:183` | a setup-status detail | noise |
| `PersonaRunner.tsx:211` | the AI-healing terminal strip | noise |
| `SystemHealthPanel.tsx:115` | `<CrashLogsSection />` | noise |
| `CronAgentsPage.tsx:42` | **seed a mock schedule** | noise + shared primitive |
| `EventLogList.tsx:303` | **seed a mock event** | ″ |
| `KnowledgeGraphDashboard.tsx:193` | **seed a mock pattern** | ″ |
| `ManualReviewList.tsx:367` | **seed a mock review** | ″ |
| `MessageList.tsx:279` | **seed a mock message** | ″ |
| `FleetTerminalOverlay.tsx:230` | `<FleetDebugLogButton />` | noise |
| `FleetSettingsPage.tsx:213` | `<FleetPairDevice />` | **capability** — see D3 |
| `DesktopFooter.tsx:538` | `<NetworkFooterIcon />` | noise |
| `DesktopFooter.tsx:572` | fleet debug pills | weight |
| `RowActionMenu.tsx:76` | template row admin actions | noise |
| `TemplateSearchFilterRow.tsx:120` | `<AdminToolsDropdown />` (backfills, dedupe) | **capability** |
| `AutoCredBrowser.tsx:162` | `<CopyLogButton />` | noise |

Against them, the declarative form, in three files: `EditorTabBar.tsx:15`
(`devOnly?: boolean` on `TabDefBase`, resolved at `:101`),
`CredentialTypePicker.tsx:25,61`, `PluginsSidebarNav.tsx:44,95,101,102,115`
(three plugins declared `devOnly: true`, one `gate<T>` helper at `:115-117`).
Plus `sidebarData.ts`'s eight entries and `NavGates.devOnly` behind
`passesGates`, which the `.tsx`-scoped rule does not see because they are `.ts`.

**The asymmetry is the finding.** Two plugin sub-surfaces (`research-lab`,
`artist`, `scraper`) are declared `devOnly: true` on their catalog rows and
resolved by one filter. Eighteen other surfaces make the same decision by hand,
at the render site, where nothing can enumerate them. The mechanism is not
missing, unfinished, or unknown to the author — `PluginsSidebarNav.tsx:114`
even carries a comment about `devOnly` becoming a dead field if the L3 mapping
drops it, which is a person actively maintaining the declarative path while
eighteen inline gates sit elsewhere.

### D3 — A dev gate over a shipped capability, held in place by a comment that the backend contradicts

`FleetSettingsPage.tsx:210-213`:

```tsx
{/* Pair a device — stage-1 scaffold for the mobile companion.
    Inert (no backend handshake yet), so it only mounts in dev
    builds until the pairing flow is real. */}
{import.meta.env.DEV && <FleetPairDevice />}
```

`src-tauri/src/commands/fleet/pairing.rs:1-24`:

> *"Mobile-companion device pairing — the trust anchor for Fleet Command
> Anywhere… **Replaces the `genToken` UI theatre in `FleetPairDevice.tsx` with a
> real backend handshake**: `fleet_pair_device` mints a 32-byte random device
> token, stores ONLY its SHA-256 fingerprint… `fleet_companion_revoke` kills a
> device's access immediately."*

Three registered Tauri commands (`fleet_pair_device`, `fleet_companion_devices`,
`fleet_companion_revoke`, all in `lib.rs`'s handler list), constant-time digest
comparison, an 8-device cap, a LAN server — shipped. And `revokeCompanionDevice`
has exactly **one** call site in `src/`: `FleetPairDevice.tsx:75`, inside the
dev-gated subtree.

The consequence — *a production user who paired in a dev build has no UI to
revoke* — is
[`cross-device-pairing`](./cross-device-pairing.md) §7's finding and is cited,
not re-derived. **What this leaf owns is the general shape and the count.** Of
the eighteen inline gates in D2, **two** hide an action whose backend is shipped
and whose state persists across builds: this one and
`TemplateSearchFilterRow.tsx:120` (`AdminToolsDropdown` — duplicate cleanup and
two backfills, all real commands). Both were gated for *noise* and both are
*capability*. The other sixteen are readouts, where the gate is free.

The discriminator a reviewer can apply in five seconds, and which nothing in this
repo applies today: **does the gated subtree contain the only control that
reverses a state the product can already be in?**

### D4 — Six copies of one dev affordance, 168 shipped translated strings

`handleSeedCron`, `handleSeedEvent`, `handleSeedKnowledge`, `handleSeedReview`,
`handleSeedMessage` and the schedules variant render the same button: amber
`bg-amber-500/10 text-amber-400 border-amber-500/25`, a `<Plus className="w-3.5
h-3.5" />`, a `mock_*` label and a `seed_tooltip` title. Five of the six are
byte-similar enough that the class strings differ only in `typo-heading` vs
`typo-body font-medium`.

The measured cost is in §6.3: **12 keys × 14 locales = 168 strings, 0 missing**,
present in all 13 shipped section-locale bundles. A single shared
`SeedMockButton({ onSeed, labelKey, tooltipKey })` with one key pair takes that
to 28 and gives the six handlers one place to grow a confirm, a toast, or a
guard.

There is a second cost that is not strings. Each handler writes a **real row to
the live database** through a real command — a mock review, a mock message, a
mock event — into the same tables the product's own metrics count. Nothing marks
them. That is out of scope here (it is
[`metric-definition`](./metric-definition.md)'s axis), but it is the reason
"it's only a dev button" is the wrong frame: the button is dev-only, the row is
not.

### D5 — The five "widening" gates are one widening and four catalog reads, and the heuristic's precision is 1 in 5

A scan for `DEV ||` / `|| DEV` returns five sites. Hand-read:

| site | verdict |
| --- | --- |
| `App.tsx:226` — `DEV \|\| window.__PERSONAS_TEST_MODE__` | **the real widening** (D1) |
| `App.tsx:163` — `!DEV \|\| !(e.ctrlKey && …)` | a *negated* early-return; the flag still folds |
| `EditorTabBar.tsx:101` — `!td.devOnly \|\| DEV` | the **compliant** declarative form |
| `PluginsSidebarNav.tsx:108` — `!p.devOnly \|\| DEV` | compliant |
| `PluginsSidebarNav.tsx:117` — `!i.devOnly \|\| DEV` | compliant |

**1 of 5 = 20% precision** for the obvious "a build flag joined by `||` is a
runtime gate" heuristic, and three of the four false positives are the exact
pattern this path prescribes. Recorded because it is the natural rule a reader
of §2's clause (d) would reach for, and it is not gateable in that form: the
syntactic shape of the compliant resolver and the defect are the same shape, and
the discriminator (is the right-hand operand a *catalog field* or a *runtime
value*?) is semantic. This is why §9's rule keys on the render position instead.

### D6 — Four correct performance gates, behind a red leg, described by a stale caveat

`commands/fleet/bench.rs` — 336 lines, `#[cfg(test)]` from `:127`, four
performance asserts at `:190`, `:220`, `:249`, `:277` plus three unit tests of
the helper. The design is right (§6.1), the thresholds are deliberately loose
(`:163` — *"the threshold is deliberately loose (5×) — the real difference is
orders…"*), and the module exists because *"every performance claim in
`docs/features/plugins/dev tools/fleet.md` … comes from a one-off manual load
test. Nothing re-runs them."*

Two things are true today and neither is in the file:

1. **They do not execute in CI**, because the workspace test step fails earlier in
   `personas-db` and carries no `--no-fail-fast` (§6.4). The header asserts the
   opposite: *"These gates therefore run in CI until that is fixed."*
2. **They do execute locally**, and the header says they cannot. Its caveat —
   *"`app_lib`'s test binary currently fails to launch on this machine with
   `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139)"* — was true when written and has
   since been fixed: `npm run test:rust` →
   `scripts/build/run-rust-tests.mjs` runs
   `cargo test --manifest-path … --features desktop --lib` and **embeds the
   comctl32 v6 manifest post-link** precisely to defeat that loader failure
   (`.claude/CLAUDE.md` documents it; `run-rust-tests.mjs:14-42` is the
   implementation).

So the gate's own documentation is wrong in both directions at once: it points at
the place that is not running them and disclaims the place that is. **A gate's
statement about where it runs is not verified by anything**, and this is the
cheapest possible instance of the contract's fail-loud requirement being applied
to prose instead of to code.

### D7 — A fifth Tauri config turns on the bridge and is referenced by nothing

`src-tauri/.tauri-scraper-dev.conf.json` is git-tracked and is three lines:

```
{ "build": { "features": ["desktop", "scraper", "test-automation"] } }
```

`git grep` over the whole tracked tree finds it named in **five** files, and all
five are golden-path artifacts or the session ledger — `index.json`,
`router.json`, `tauri-permissions-and-csp.md`, `golden-path-deferred-fixes.md`,
`.claude/active-runs.md`. **Zero** npm scripts, CI jobs, lefthook hooks, docs or
source files reference it.

The finding and the config-inventory gap are
[`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md)'s (its §9 table
and Gaps enumerate all five configs and the three-file hardcoded list in
`check-tauri-configs.mjs`), and are cited rather than re-derived. **What this
leaf adds is why it belongs to *this* situation:** the feature it enables,
`test-automation`, is precisely the arm that `lib.rs:1556` treats as
"always on, no env var needed". A build produced from that config has the bridge
compiled in unconditionally, and the file is one `--config` flag away from being
used by anyone who finds it. A diagnostic transport whose enabling artifact is
untracked by any inventory is the same defect as D1 wearing a build-system
costume.

### D8 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"`feedback/LoadingSpinner` renders null."** True (`:12-21`), and re-verified,
  but it is **not a dev-only-diagnostics finding** — it is repo-wide loading
  doctrine and is already in `.claude/CLAUDE.md`, `page-loading` and
  `inline-busy-state`. It appears here only in §3 as a thing not to reach for.
  Recorded so the next composer does not count it twice.
- **"The dev gates are concentrated in a debug feature folder."** False. They are
  spread across **54 files** in 12 feature areas; the largest cluster is
  `App.tsx` at 9, and `src/lib/dev/` contains exactly **one** of the 75.
- **"The catalog has phantom `devOnly` entries."** False. All 8 declarative
  entries resolve to surfaces that exist.
- **"`bench.rs` is dead code."** False, and the brief's phrasing ("execute in
  zero places") over-reaches. They compile, they are reachable by
  `npm run test:rust`, and they run in CI's `cargo test --workspace` whenever
  that step gets past `personas-db`. The true statement is narrower and worse:
  *nothing verifies that they ran*, and the module says they run somewhere they
  currently do not. See §12.
- **"`__PERSONAS_TEST_MODE__` is settable from the devtools console."** Not
  asserted. The flag is injected by a Tauri plugin *before page JS*
  (`lib.rs:598`), so the realistic vector is the environment variable, not a
  console assignment after boot — by which time `App.tsx:226` has already run.
  The distinction matters for the fix and is recorded so the severity is not
  inflated.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`passesGates` covers navigation destinations, not arbitrary subtrees.**
   `NavGates` hangs off a `NAV_SECTIONS` entry. `<StudioAttention/>`, a footer
   pill and a row-action menu item have no registry entry to hang a flag on, so
   D2's fix for 12 of its 18 sites requires *inventing the catalog entry first*.
   That is real work, not a rename, and it is the honest reason the inline form
   won.
2. **Nothing can assert that a chunk left the production bundle.** The foldable
   ternary's property is real and is verified by nobody; a rewrite to
   `{DEV && <X/>}` silently reverses it. A `check-prod-bundle.mjs` asserting that
   named dev chunks are absent from `dist/` is the missing instrument, and it
   would have caught D1.
3. **The frontend cannot ask the backend whether the bridge is enabled**, so it
   re-derives the decision from a flag the backend injects. Any fix for D1 that
   keeps the flag has to keep the two decisions in sync by discipline. The
   structural fix is for the backend to inject the flag *only on the arms where
   it also starts the server* — one condition, one place.
4. **`import.meta.env.DEV` and `debug_assertions` are decided by two build
   systems and nothing asserts they agree.** A `tauri:dev` against a
   production-mode Vite build is legal and produces a frontend that hides its
   diagnostics from a backend that exposes its bridge.
5. **The census cannot see a gate's *reason*.** §9's rule counts render-site
   gates; it cannot tell D3's capability gate from `App.tsx:409`'s badge. The
   capability/readout split needs a human, which is why §4 step 6 is a question
   and not a check.

---

## Prefer a type over a gate

- **Q1 — a required prop carries only what it encodes.** Making `NavGates.devOnly`
  required would force every section to answer the question, and would not reach
  a footer pill that has no `NavGates` at all. The type closes the surfaces that
  are already declared, which is the population that is already fine.
- **Q2 — requiredness ≠ closedness.** `devOnly?: boolean` → `devOnly: boolean`
  changes nothing about which surfaces are declared.
- **Q3 — count the construction sites.** `NavGates` is constructed once per
  registry entry. `passesGates` has **3** call sites
  (`history.ts:196`, `sectionRouter`, `commandPaletteUtils`). A type here
  constrains a small, already-compliant population — Q3's exact warning.
- **Q4 — a type anyone can construct authenticates nothing.** A `DevOnly<T>`
  wrapper is constructible at any render site; it would be a comment.
- **Q5 — withholding beats requiring**, and it is available for D1: **do not
  inject `window.__PERSONAS_TEST_MODE__` on a build that refuses the server.**
  The frontend then has nothing to widen with, `import.meta.env.DEV` folds, and
  the chunk leaves the artifact. That is one `#[cfg]` attribute deleting a whole
  class, and it is the fix §7 D1 files.
- **Q6 — withhold the dangerous freedom, not the answer.** Withhold *the flag on
  release builds*, not the bridge itself; the harness keeps working on the arms
  that already start the server.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value
  voluntarily.** D2's authors supply the inline conditional freely; no widening
  of any type discourages it. That is precisely why D2 gets a **gate** and D1
  gets a **type**, and it is the clean split the doctrine predicts.

**Verdict.** One type/structure change (D1: gate the flag injection with the same
`cfg` as the port decision) removes the highest-severity item outright. D2 is a
population of eighteen voluntary choices with no signature to change — the census
rule below is the right instrument for it, and §9 says so.

---

## 9. The missing gate

**The signal is a manifestation of this stack.** The condition it stands proxy
for, which is what travels to another repo: *the decision to hide a diagnostic is
taken at the point of rendering rather than declared on the artifact that
describes the surface, so the set of things hidden in production cannot be
enumerated, tested, or reviewed as a whole.* An adopting repo must re-derive its
own signal — a JSX-brace pattern will score **zero** in a repo that uses a
`<DevOnly>` component, a Vue `v-if`, a Rust `#[cfg]`, or a template
conditional, while the condition is present at scale.

### 9.1 Existing rules checked first

| rule | owner | why it does not cover this |
| --- | --- | --- |
| `build-gated-ipc-entrypoint` | [`feature-flagged-compilation`](./feature-flagged-compilation.md) | 1 file / 127 matches, **Rust only** — `#[cfg]` on a `generate_handler!` registration. Disjoint by root and extension. |
| `config-value-frozen-at-compile-time` | [`compile-time-env-embedding`](./compile-time-env-embedding.md) | 4 files / 11, `option_env!` in Rust. Disjoint. |
| `env-default-conflates-unset-with-empty` | same | 4 files / 4, `import.meta.env.X \|\| default` — adjacent vocabulary, **disjoint sites**: it keys on a `\|\|` *default*, this keys on a `{`-position gate. Verified: no site is in both. |
| `undeclared-tier-branch` | (tier gating) | 13 files / 13, `useTier()` destructuring — the *other* axis of the same resolver, and confirms the render-site-vs-declaration split is already a recognised concern here. |
| `unfalsifiable-tier-guard` | (tier gating) | same axis, not the dev axis. |

None counts a build-flag decision in a JSX render position.

**Overlap, measured at the SITE level against the FINAL published pattern**, not
at file level and not against a draft — the doctrine's instruction, because file
overlap understates and an intermediate pattern measures a rule you did not ship.
Each neighbour above was run and its sites enumerated:

| neighbour | its sites | shared **sites** with the 18 | shared **files** |
| --- | ---: | ---: | ---: |
| `env-default-conflates-unset-with-empty` | 1 (`uiModes.ts:41`) | **0** | 0 |
| `undeclared-tier-branch` | 13 | **0** | 1 — `DesktopFooter.tsx`, at `:290` against this rule's `:538` and `:572` |
| `unfalsifiable-tier-guard` | 105 | **0** | 0 (Rust) |
| `config-value-frozen-at-compile-time` | 11 | **0** | 0 (Rust) |
| `build-gated-ipc-entrypoint` | 127 | **0** | 0 (Rust) |

**0 of 18 sites overlap; 1 of 15 files (6.7%) is shared, at different lines.**
`undeclared-tier-branch` is the informative one: it is the *same condition on the
tier axis* — "a gating decision taken from an ambient boolean where it is used,
instead of declared on the destination where a test can enumerate it" — reaching
the same destination (`passesGates`, `registry.ts:154`) from the other side. Two
rules, one prescription, disjoint populations. That is the strongest argument for
shipping this one: the repo already ratchets the tier half of the very split this
path is about, and the dev half was unratcheted.

### 9.2 The rule, measured in a private scratch registry

Run with `node scripts/census/run-census.mjs --rules <scratch>`; the full
registry was not run.

```
inline-dev-build-gate                    15 files / 18 matches   (walked 2,104, floor 1,500)
inline-dev-build-gate-positive-control    3 files /  8 matches
1 match ignored on a comment-only line
```

**Precision: 18/18 on the stated condition**, every match hand-read and tabulated
in §7 D2 — each is a build-flag decision taken inside a JSX brace, and none goes
through `devOnly`. As with `unscrubbed-telemetry-side-field`, the rule **asserts
coverage, not harm**, and the title says so: two of the eighteen (D3) are
severe, two are deliberate weight decisions with good comments, and fourteen are
ordinary noise gates that should be catalog rows. All eighteen are the thing the
rule is named for.

**The control partitions the anchor rather than reporting a ratio.** Raw
occurrences of `import.meta.env.DEV` in `.tsx` files split into: **18** inside a
JSX brace (violating), **8** `devOnly` declarations (compliant, and the
destination), and the remainder in control-flow positions the rule deliberately
does not claim — `if (DEV)`, `const isDev = DEV`, and the module-scope foldable
ternary, all of which §9.4 asserts are non-matches.

### 9.3 The rule

```json
{
  "id": "inline-dev-build-gate",
  "goldenPath": "docs/concepts/golden-paths/dev-only-diagnostics.md",
  "title": "A build-flag decision is taken inline at a JSX render site instead of being declared on the surface's catalog entry and resolved by the one gate resolver, so the set of surfaces hidden in production cannot be enumerated",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "\\{\\s*import\\.meta\\.env\\.DEV\\s*(?:&&|\\?)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An `import.meta.env.DEV` gate opened inside a JSX brace — `{DEV && …}` or `{DEV ? … : …}` — i.e. a build-flag decision taken at the point of rendering. PROXY FOR the stack-free condition: 'the decision to hide a diagnostic is taken where it renders rather than declared on the artifact that describes the surface, so the set of things a production build hides cannot be enumerated, tested or reviewed.' THE DESTINATION EXISTS AND IS USED: `NavGates.devOnly` resolved by the single total function `passesGates(gates, {isDev, isTierVisible})` at src/lib/navigation/registry.ts:154 (tested at registry.test.ts:142-154), plus per-catalog `devOnly?: boolean` fields at sidebarData.ts:27 (8 entries, one filter at :326), PluginsSidebarNav.tsx:44 (3 entries, one `gate<T>` helper at :115-117), EditorTabBar.tsx:15 and CredentialTypePicker.tsx:25 — so this is a ratchet toward a mechanism this repo already built, not an aspiration. MEASURED 2026-08-17 at 6c97502d3: 15 files / 18 matches, REPRODUCED BYTE-IDENTICAL at c7c153b57 after a concurrent session deleted 21 .tsx files (walked 2104 -> 2083, matches unchanged), ALL EIGHTEEN HAND-READ AND TABULATED in the golden path's section 7 D2. PRECISION 18/18 ON THE STATED CONDITION — the rule asserts COVERAGE, not harm, and the title says so. Severity varies and is a human judgement the pattern cannot make: TWO of the eighteen gate a CAPABILITY rather than a readout (FleetSettingsPage.tsx:213 hides FleetPairDevice and, inside it, the only call site of revokeCompanionDevice in src/, so a production user who paired in a dev build cannot revoke — see cross-device-pairing.md; and TemplateSearchFilterRow.tsx:120 hides AdminToolsDropdown's duplicate-cleanup and two backfills). TWO are deliberate WEIGHT decisions with correct comments (App.tsx:390 FleetGridLayer, DesktopFooter.tsx:572) and are still matches, because a weight decision belongs in the foldable module-scope form at App.tsx:46-50, not in a render brace. SIX are one copy-pasted 'seed a mock row' button repeated across CronAgentsPage/EventLogList/KnowledgeGraphDashboard/ManualReviewList/MessageList and schedules, whose labels cost 12 i18n keys x 14 locales = 168 translated strings shipped in every production bundle (counted, 0 missing). THE CONTROL PARTITIONS THE ANCHOR rather than reporting a ratio: raw `import.meta.env.DEV` occurrences in .tsx split into 18 in a JSX brace (this rule), 8 `devOnly` declarations (the positive control, the destination), and the remainder in control-flow positions this rule deliberately does not claim. 19 HAND-WRITTEN FAULT INJECTIONS were run against this exact pattern and all pass: it matches `{DEV && <X/>}`, `{ DEV && (`, `{DEV ? <A/> : <B/>}`, a compound `{DEV && cond && (`, and a newline before `&&`; it does NOT match `!td.devOnly || DEV` (the compliant resolver, x3 real sites), `devOnly: true`, `if (item.devOnly && !isDev)`, `passesGates(...)`, `if (DEV) {`, `if (!DEV) return;`, `const isDev = DEV;`, the module-scope foldable `const X = DEV ? lazy(...) : null`, the spread `...(DEV ? [{...}] : [])`, `{DEV && ...}` on PROD/MODE, or `{ dev: DEV }` in an object literal. WHY NOT GATE THE OBVIOUS THING INSTEAD: a rule on `DEV ||` (a build flag widened by a runtime value, which is this leaf's most severe defect, App.tsx:226) scores 1/5 = 20% PRECISION, because three of its four false positives are `!x.devOnly || DEV` — the exact compliant form this path prescribes. The syntactic shape of the resolver and the defect are identical and the discriminator is semantic. That defect is filed as a TYPE fix instead (delete the unconditional `window.__PERSONAS_TEST_MODE__` injection at src-tauri/src/lib.rs:589-601 so it carries the same cfg as the port decision at :1556-1583), which removes the class rather than counting it. WHAT THIS RULE CANNOT SEE, stated so nobody trusts it further: it cannot see the gate's REASON, so it cannot separate a capability gate from a readout gate — that judgement is the golden path's section 4 step 6 and needs a human. It cannot see the 8 declarative sites in .ts files (sidebarData.ts, registry.ts) because the extension list is .tsx only; that is deliberate, since the condition is about render position. It cannot see Rust `#[cfg(debug_assertions)]` (20 files) — feature-flagged-compilation.md owns that half. It CANNOT see whether a foldable form actually removed a chunk from the production bundle; that is an absence and needs the bundle checker specified in the golden path's Gaps 2. IT DOES NOT REACH ZERO: some render-position gates will always be right for a surface with no catalog entry to hang a flag on (Gaps 1), so do NOT delete this rule at zero — re-baseline it after each migration wave. DO NOT silence a match by hoisting the flag to `const isDev = import.meta.env.DEV` and writing `{isDev && ...}`: that is personas-web's error.tsx:28,86 exactly, it centralises the READ and leaves the DECISION at the render site, and it preserves the defect while defeating the pattern. PORTABILITY WARNING, earned from the convergence sweep: 0 of 3 independent siblings has a declarative dev-gate mechanism and 2 of the 3 have no in-app diagnostics at all, so this pattern would score ZERO in brainiac and personas-cloud while the condition is absent, and would also score zero in a repo that spells the gate as a `<DevOnly>` component, a Vue `v-if`, or a template conditional. Re-derive the signal per repo; only the condition travels."
  },
  "exclude": [],
  "baseline": { "files": 15, "matches": 18 },
  "floor": 1500
}
```

```json
{
  "id": "inline-dev-build-gate-positive-control",
  "goldenPath": "docs/concepts/golden-paths/dev-only-diagnostics.md",
  "title": "CONTROL: the compliant form — a dev gate DECLARED as a field on the surface's catalog entry, for the resolver to apply",
  "roots": ["src"],
  "extensions": [".tsx"],
  "signal": {
    "pattern": "\\bdevOnly\\s*(?:\\?\\s*)?:",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A `devOnly` field declared on a catalog/registry entry or on its type — the compliant form the violating rule ratchets toward. Measured 2026-08-17 at 6c97502d3 and reproduced at c7c153b57: 3 files / 8 matches in .tsx (PluginsSidebarNav.tsx:44,95,101,102,115; CredentialTypePicker.tsx:25,61; EditorTabBar.tsx:15), plus 8 more entries in .ts (sidebarData.ts) and the `NavGates.devOnly` declaration that `passesGates` resolves, which this .tsx-scoped control deliberately does not count. A control returning ~0 would mean the declarative mechanism does not exist in this repo and the violating rule is prescribing a destination nobody has built; it returns 8, so the destination is real and in use. NO BASELINE BY DESIGN — the merger skips controls and validateRule rejects one that carries a baseline."
  },
  "floor": 1500
}
```

### 9.4 Fault injections, run against the published pattern

Nineteen cases, all passing (`gp-msurf-faults.mjs`, scratch):

| must MATCH | must NOT match |
| --- | --- |
| `{import.meta.env.DEV && <FleetPairDevice />}` | `(!td.devOnly \|\| import.meta.env.DEV)` |
| `{ import.meta.env.DEV && (` | `.filter((p) => … && (!p.devOnly \|\| import.meta.env.DEV))` |
| `{import.meta.env.DEV ? <CopyLogButton/> : <div/>}` | `{ id: 'certification', …, devOnly: true },` |
| `{import.meta.env.DEV && state.x !== 'idle' && (` | `if (item.devOnly && !isDev) return false;` |
| `{import.meta.env.DEV\n && <X />}` | `return !passesGates(navSection(dest.section).gates, ctx);` |
| | `if (import.meta.env.DEV) { void import(…) }` |
| | `if (!import.meta.env.DEV) return;` |
| | `const isDev = import.meta.env.DEV;` |
| | `const devSystemCheck = import.meta.env.DEV;` |
| | `const DevInspector = import.meta.env.DEV ? lazy(…) : null;` |
| | `...(import.meta.env.DEV ? [{ id: "system-check" }] : []),` |
| | `{import.meta.env.PROD && <X />}` |
| | `environment: import.meta.env.MODE,` |
| | `const o = { dev: import.meta.env.DEV };` |

The last one is the case that shaped the pattern: an object literal opens a brace
immediately before the flag, so a naive `\{[^}]*DEV` would have matched it. The
`\s*` — and only `\s*` — between `{` and `import` is what keeps the rule to
render positions.

### 9.5 A second gate this path names but does not build

**`scripts/check-prod-bundle.mjs`** — assert that named dev-only chunks are
**absent** from `dist/` after `npm run build`. This is Gaps 2 and it is the
instrument that would have caught D1, which the census cannot: the census
ratchets a count of something present, and "this chunk is not in the artifact" is
an absence. It would fail loudly on its own precondition by exiting 2 if `dist/`
contains fewer than N chunks, so a build that produced nothing cannot pass it.

---

## 12. Corrections to the brief

**1. "`bench.rs` holds four correct performance gates that execute in zero
places" is over-stated, and the true statement is worse.** They are `#[cfg(test)]`
in `app_lib`, so they execute wherever `cargo test --lib` for that crate runs —
and `npm run test:rust` (`scripts/build/run-rust-tests.mjs:194`) runs exactly
that, with the manifest fixup that defeats the 0xC0000139 loader failure the
module's own header still cites as the reason they cannot run locally. What is
true: the most recent completed CI run failed `rust-tests` on **all three** OSes
inside `personas-db` (`triggers.rs:2488`), and neither `ci.yml` nor
`run-rust-tests.mjs` passes `--no-fail-fast`, so `app_lib`'s tests did not run in
it. **The finding is not "dead code" but "a gate whose own documentation is wrong
in both directions"** — it disclaims the place that runs it and points at the
place that currently does not. Nothing verifies either claim, which is the
contract's fail-loud requirement applied to prose.

**2. "`import.meta.env.DEV` gates the pairing panel and the revoke button with
it" is correct and is already published — by
[`cross-device-pairing`](./cross-device-pairing.md) §7, which found it, named the
stale comment, and named the silent `silentCatch` on revoke.** Re-deriving it
would have been duplicate work. What was left for this leaf was the
generalisation: of 18 inline gates, **2** hide a capability rather than a
readout, and the five-second discriminator is *"does this subtree contain the only
control that reverses a state the product can already be in?"* (§7 D3). A brief
that leads with a neighbour's finding is a brief whose leaf boundary needs
restating, which §1 now does.

**3. Same for `.tauri-scraper-dev.conf.json`** — fully owned by
[`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md), including the
five-config inventory and the three-file hardcoded list in
`check-tauri-configs.mjs`. Cited in §7 D7 with the one thing that path did not
need to say: the feature it enables is the arm `lib.rs:1556` treats as
unconditional.

**4. "`feedback/LoadingSpinner` renders null" is true and is not this leaf's
finding.** It is repo-wide loading doctrine, already in `.claude/CLAUDE.md` and in
two published paths. It appears here only in §3 as a thing not to reach for.

**5. What the brief did not point at, and it is the headline.** The
`window.__PERSONAS_TEST_MODE__` disjunct at `App.tsx:226` and its uncfg'd
injection at `lib.rs:589-601`. The backend's three-arm gate exists *because a
security audit demanded it* (`lib.rs:1567-1570` names it, 2026-07-02), and the
frontend's one-line copy reintroduces the surface the audit removed — a
120-method `window.__TEST__` with a generic `invokeCommand`, inside the
authenticated page context, in a release installer. That is the one item in this
document a human should look at first.

**6. The spine's `convergence: converged` fails, in the "converged on the
disease" mode.** 0 of 3 independent siblings has a declarative dev-gate
mechanism, and 2 of the 3 have no in-app diagnostic surfaces at all — so their
agreement is agreement about not having the problem, which an oracle that counts
agreement reads as the strongest possible confirmation. Personas is **ahead** of
the fleet here (`passesGates` + `NavGates.devOnly` is the only real resolver
anywhere in it, and the only sibling with anything similar is our own port,
`personas-web`); the finding is that it does not use its own mechanism at 18 of
26 sites. Fourteenth label tested, fourteenth that measurement did not support.

**7. The spine's `sides: "client"` is upheld, with one qualification that
matters.** All 18 census sites, D2, D3, D4, D5 and D6's frontend half are
client-side. But **the headline defect is two-sided and its severe half is
server-side**: `lib.rs:589-601` is Rust, and the fix (Q5, withhold the flag) is a
Rust `#[cfg]` attribute. A brief scoped by `sides: "client"` would have found the
`App.tsx` disjunct and stopped one file short of the thing that makes it
reachable. Reported as an **incomplete** label rather than an inverted one — the
client half is real and is most of the document — and it is the fourth
qualification the corpus has recorded on that field's majority value.
