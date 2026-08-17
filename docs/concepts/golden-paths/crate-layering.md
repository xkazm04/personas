# Crate layering

> Situation node: `platform-delivery/build-profiles/crate-layering` · situation spine
> `sides: server` · `twoSided: false` · recurrence 5 · risk medium · spine label
> `convergence: converged`. Dimensions: code-quality · performance.
> Spine's own framing: *"Which workspace crate a new module belongs in so the graph stays
> acyclic."*
>
> **Short form** (the batched tier: header, §0, §2, §7, §9, §12). The measurement core is
> unchanged — two implementations of every count, hand verification, and the disagreements
> reported rather than reconciled away.
>
> Composed 2026-08-17 against `master @ f81e2c1df`. Sweep: all five workspace manifests
> (`src-tauri/Cargo.toml`, `core/`, `db/`, `engine/`, `macros/`), `src-tauri/src/lib.rs`,
> `src-tauri/src/engine/mod.rs`, `src-tauri/engine/src/lib.rs`,
> `scripts/build/crate-split-deps.mjs` (419 lines),
> `scripts/build/run-rust-tests.mjs`, `.github/workflows/ci.yml`'s `rust-tests` matrix,
> and a file-level census of all **951 `.rs` files / 524,584 lines** under `src-tauri/`.
> `cargo` was unavailable; nothing was compiled.

---

## §0 — The headline

**The acyclic property is not a convention here. Cargo enforces it, for free, and it
cannot be violated.** A path dependency cycle is a hard resolution error before a single
crate compiles, and the declared graph — `macros` and `core` with no internal deps, `db →
core`, `engine → core + db`, `personas-desktop → all four` — is the reason: every edge
that would break the layering (`core → db`, `db → engine`) is exactly an edge that would
close a cycle. Verified at source level too: **`core` names `personas_db`/`personas_engine`
0 times in 114 files; `db` names `personas_engine` 0 times in 143 files.**

**What is unenforced is the thing the leaf actually asks about — placement — and the
repository has deliberately made it invisible.** `src-tauri/src/engine/mod.rs` re-exports
`personas_core::{cron, crypto, lifecycle, trace, types, url_safety}`,
`personas_core::{healing, limits, redact, run_budget, scheduler, topology_graph}`,
`personas_core::error_taxonomy`, `crate::db::{audit_incidents_promoter, byom, chain,
memory_recall, model_routing, quality_gate}` **and `pub use personas_engine::*`** — so
`crate::engine::X` is a single namespace spanning **four crates**, and a call site cannot
tell which one it reached. That was the right call at extraction time: it moved ~84k LOC of
`db` and ~56k of `engine` out of `app_lib` while touching a handful of files instead of
849. Its standing cost is that **`personas_engine::` appears exactly once in all 564 files
of `app_lib`** — in the shim itself — so no author is ever confronted with the boundary
they are about to place a module on.

Two consequences, both measured:

1. **There are two `engine`s and neither name distinguishes them.** `src-tauri/src/engine/`
   is **115 files / 96,185 lines** inside `app_lib`; `src-tauri/engine/src/` is
   **129 files / 61,184 lines** in `personas-engine`. Their top-level module names **do not
   collide at all — 78 and 102 names, intersection 0** — which is what makes the wildcard
   re-export sound, and is also why the split is invisible. `.claude/CLAUDE.md`'s
   architecture block lists `src/engine/` as *the* execution engine and separately says
   engine is an extracted crate; both sentences are true and together they describe
   nothing.
2. **The layer everything depends on is the layer that gates everyone else's
   verification.** On the Windows leg of CI run `32025966929` (2026-08-17),
   `cargo test --workspace --features desktop` ran `personas_core` (760/760 ok) and
   `personas_db` (**808 passed, 10 failed**) and stopped; `cargo clippy` on the same commit
   died at `personas-db` with **3 `clippy::sort_by_key` errors**. `personas-desktop (lib
   test)` compiled and never ran. **A defect in the bottom layer makes the top 331,560
   lines unverifiable**, and that is a property of the layering, not of CI.

And the discipline the manifests warn about three times is currently **holding**:
**701 `#[cfg(feature = "…")]` mentions across all five crates, 0 of them naming a feature
the containing crate does not declare.**

---

## §2 — The one way (compact)

**Place a module by the lowest layer that can hold it, decide that by what it reaches
rather than by what it is named, and never let a re-export shim be the thing that tells you
it compiled.** In order:

1. **Ask what the module reaches, not what it does.** Run
   `node scripts/build/crate-split-deps.mjs --closure <module> --exclude <what you intend
   to leave behind>`. The `--exclude` is not optional: without it a single
   `crate::engine::SOME_CONST` in a 1.5k-line module drags all 157k lines of `engine` into
   the answer, and the tool says so at `:27-31`. The list of edges it reports as
   "must be broken" **is** the work item.
2. **Then place it at the lowest layer that closes.** `core` if it reaches no other
   Personas crate; `db` if it reaches only `core` and SQLite; `engine` if it reaches
   `core` + `db`; `app_lib` if it reaches `AppState`, `notifications`, `tray`, `cloud` or a
   `#[tauri::command]`. That last criterion is the honest one and `engine/src/lib.rs:7`
   states it: *"everything that reaches `AppState`, `notifications`, `tray` …"* stays in
   `app_lib`. A module that pokes at `AppState` is application wiring, not library code.
3. **Declare, in the receiving crate's `[features]`, every feature the moved code names in
   a `#[cfg(feature = …)]`.** This is the one placement mistake that produces no error at
   all: a `cfg` naming a feature the crate does not declare is *silently always-false*, so
   the code disappears instead of failing. The manifests record three separate occurrences
   (`core`'s `desktop` gating the OS-keychain master-key path, `db`'s `scraper` gating a
   seed, `engine/Cargo.toml:15-18` warning generically) and each one silently disabled a real
   behaviour. Since Rust 1.80, cargo emits `--check-cfg` and rustc's `unexpected_cfgs` lint
   reports this — see §9 for why that lint does not currently reach the crate where 561 of
   the 701 mentions live.
4. **Copy the dependency spec verbatim from the crate you are moving out of**, and mean it.
   `core/Cargo.toml:36-40` states the rule and the reason: *"if they drift, cargo stops
   unifying the dependency and compiles it twice, which costs exactly the build time this
   crate split exists to reclaim."* §7.B measures where that has already happened.
5. **Add a re-export shim only to avoid a mass rename, and treat it as debt with a
   number.** The shims here are correct and load-bearing; what is missing is that nothing
   records how many call sites still depend on the old name, so the split has no
   completion criterion.
6. **And then stop.** Do not re-verify placement by compiling `app_lib` — the cycle check
   already ran when cargo resolved the manifests, and everything after that is about
   features and build time, not about the graph.

---

## §7 — Deviations

### 7.A — P1: `cargo test`/`clippy` fail-fast at `personas-db` leaves 63% of the Rust unverified

Measured from CI run `32025966929`, both the Windows and Linux legs, and consistent across
every `rust-tests` run sampled. LOC by crate, counted over `.rs` files:

| Crate | files | lines | share | tested in CI on 2026-08-17 | linted |
|---|---:|---:|---:|---|---|
| `personas-desktop` (`app_lib`) | 564 | 331,560 | 63.2% | **binary built, never executed** | **no** — clippy stopped upstream |
| `personas-db` | 143 | 102,255 | 19.5% | yes — 808/818, 10 failed | reached; 3 errors |
| `personas-engine` | 129 | 61,184 | 11.7% | **not reached** | **not reached** |
| `personas-core` | 114 | 29,465 | 5.6% | yes — 760/760 | reached, clean |
| `personas-macros` | 1 | 120 | 0.02% | not reached | not reached |

The 818-test `personas_db` binary takes **1,571 seconds** on the runner, so the wall the
other three crates sit behind is also the longest one. Splitting the workspace made this
*worse* in one specific way worth naming: before the split there was one test binary and it
either ran or it did not; now there are five, they run in dependency order, and the one
that fails is at the bottom.

*Not a fix to apply here* — the 10 failing tests and 3 clippy errors are real code, and
`--no-fail-fast` changes exit semantics for every consumer. Registered.

### 7.B — P2: three dependency specs have drifted, and the manifest contradicts itself about whether that is allowed

Two implementations over the five manifests: **94 distinct dependency keys, 61 shared by
more than one crate, 3 with differing specs.** Hand-verified, **2 of 3 are real** (2/3
precision; the third is a TOML shorthand my matcher did not normalize):

| Dependency | Divergence | Real? |
|---|---|---|
| `rusqlite` | `desktop` + `core` + `db` → `features = ["bundled", "hooks", "preupdate_hook"]`; **`engine` → `["bundled", "hooks"]`** | **yes.** Undocumented — no comment anywhere explains the omission. `rusqlite` with `bundled` is the single most expensive C compile in the tree. |
| `windows` (`cfg(windows)`) | `desktop` + `engine` → 6 `Win32_*` features; **`core` → 3** | **yes**, and *deliberate*: `core/Cargo.toml:96-97` says *"Feature list is the desktop crate's, **trimmed to what core uses**."* |
| `which` | `desktop` → `{ version = "8.0.1" }`; `engine` → `"8.0.1"` | **no** — TOML shorthand for the same spec. A false positive of the matcher, kept in the count so the precision is honest. |

The `windows` case is the interesting one, because **`core/Cargo.toml` states both rules,
~60 lines apart, and they are opposites**: `:35-40` says *"EVERY version/feature set below is
copied verbatim … Keep them identical: if they drift, cargo stops unifying the dependency
and compiles it twice"*, and `:96-97` trims a feature list on purpose. Both are defensible
— feature unification means the workspace build gets the union anyway, so the trim costs
nothing *when the whole workspace is built together* and costs a second compilation of
`windows` when it is not (`cargo build -p personas-core`,
`cargo test -p personas-core --lib`, and `npm run test:rust`'s default lane, which is
`--features desktop --lib` **without `--workspace`**). What is not defensible is that the
file gives a future author two contradictory instructions and no way to tell which applies.

### 7.C — P2: the crate boundary has no representation at any call site

`app_lib` contains **exactly one** occurrence of `personas_engine` in 564 files — the
wildcard re-export at `src-tauri/src/engine/mod.rs:26`. Every other reference to the 61,184
lines in `personas-engine` is spelled `crate::engine::…`, identically to a reference to the
96,185 lines that never left. The same holds for `db` (`pub use personas_db as db;`,
`lib.rs:12`) and for the seven `personas_core` re-exports at `lib.rs:18,39,46,49,53` and
`engine/mod.rs:20,34`.

The consequence is specific and it is the leaf's own question: **an author adding a module
to `src-tauri/src/engine/` gets no signal that `src-tauri/engine/src/` exists and might be
the right home.** `crate-split-deps.mjs` exists to answer that question and has to be
invoked deliberately; nothing prompts it. The tool even has to compensate for the shims —
`CORE_ALREADY` (`:212-216`) and `EXTRACTED_CRATES` (`:224`) read the extracted crates off
the filesystem specifically because, without them, *"they look like crate-root items and
get folded into `lib`, and since `lib` transitively depends on everything, the answer
becomes 'the whole crate' no matter what you ask."*

### 7.D — P2: the split has no completion criterion, and its stated goal is unmeasured

`src-tauri/Cargo.toml:8-14` states the target shape and the reason for the split: *"The
single 431k-LOC crate meant one rustc process and an 8.9 GB peak on test builds; splitting
is the only way to parallelize codegen."* Measured today: `app_lib` is **331,560 lines** —
so ~193k lines have moved out into `core` + `db` + `engine`, and `app_lib` is still 63% of
the Rust and still the largest crate by a factor of 3.2. **No artifact records the peak
rustc RSS after the split**, so the 8.9 GB figure has no successor and the split's own
success metric is untested. (`docs/development/build-memory.md` and
`scripts/build/sample-build-memory.ps1` exist; nothing wires them to a threshold.)

`crate-split-deps.mjs` is the right instrument and carries the right caveat at `:33-35`
(*"a textual approximation, not rustc … treat a clean closure as 'worth attempting', never
as proof"*). What is missing is a *number*: which units of `app_lib` are portable today,
recomputed on demand.

### 7.E — P3: `personas-db`, the "data layer", depends on `tauri`

`db/Cargo.toml:67-68` — *"`cdc` emits change events to the frontend, so it takes a
`tauri::AppHandle`."* `personas-engine` does too (`engine/Cargo.toml:90`). So the two
middle layers of a graph designed to isolate portable logic from the desktop shell both
link the desktop shell. `run-rust-tests.mjs:46-51` already records the consequence in
writing — *"`--crates` is a NARROWER lane, not a quick one … personas-db and
personas-engine both depend on tauri … expect a cold build to be minutes, not seconds. Do
not present it to anyone as a full-suite substitute."*

This is a genuine design tension, not sloppiness: change-data-capture has to reach the
window. The clean shape is an outbound trait the data layer owns and `app_lib` implements
(`async_trait` is already a dependency of `engine`), which would take `tauri` out of two
manifests and make the `--crates` lane actually fast. Registered as a note, not applied.

### 7.F — P3: the layering is documented in a file that has been wrong about it twice

`.claude/CLAUDE.md`'s architecture block carries an in-place correction dated 2026-08-14
about `src-tauri/src/db/` — which indeed **does not exist** (verified) — and then lists
`src/engine/` as *"Execution engine, scheduler, healing, crypto"*. Of those four:
`scheduler`, `healing` and `crypto` are all in **`personas-core`** today
(`engine/mod.rs:20,34`), re-exported under their old paths. The line is a description of
the pre-split tree that still reads as current because the shims make it true at the call
site. Two of the four names it gives are in the wrong crate.

---

## §9 — The gate: declined, with the numbers and a specification

**No census rule is proposed.** Two candidates were built and measured; both fail for
structural reasons the doctrine already names, and the reasons are worth more than the
rules would have been.

### Candidate 1 — `#[cfg(feature = "X")]` naming an undeclared feature. **Rejected: the condition is extinct, and a type already reaches it.**

This is the trap the manifests warn about three times, and it is the highest-consequence
placement mistake in this leaf (the gate silently evaluates false and the behaviour
vanishes). Measured over all five crates, comparing each `feature = "…"` string in that
crate's `.rs` files against its `[features]` table **plus its implicit optional-dependency
features** (which cargo also declares — omitting them was the difference between a wrong
answer and a right one):

| Crate | `feature = "…"` mentions | declared features | implicit (optional deps) | **undeclared** |
|---|---:|---|---:|---:|
| `personas-desktop` | 561 | default, desktop, desktop-full, ml, p2p, mobile, test-automation, ollama, scraper, daemon | 21 | **0** |
| `personas-engine` | 82 | desktop, ml, p2p, scraper, ollama | 14 | **0** |
| `personas-db` | 44 | ml, p2p, scraper, desktop, test-support | 2 | **0** |
| `personas-core` | 14 | ml, p2p, desktop | 1 | **0** |
| `personas-macros` | 0 | — | 0 | **0** |
| **total** | **701** | | | **0** |

**A census rule with zero matches fails structurally by design** (`scripts/census/` treats
a rule that matches nothing as a broken matcher), so this cannot be baselined at 0 even if
it were desirable. And it should not be: **a type already reaches this condition.** Since
Rust 1.80 — `rust-version = "1.80.0"` in every manifest here, and `rustc 1.96.1` in
practice — cargo passes `--check-cfg` and rustc's `unexpected_cfgs` lint fires on exactly
this. Per the contract's own ordering, *prefer a type over a gate*; a duplicate census rule
would be a second, weaker copy of a compiler diagnostic.

**With one qualification that is itself a finding.** `unexpected_cfgs` is a **warning**, and
the invocation that would promote it — `cargo clippy --workspace --features desktop --
-D warnings` (`ci.yml:306`) — **stops at `personas-db` before linting `personas-engine` or
`personas-desktop`** (§7.A). So the compiler reaches this condition on a developer's
machine and CI currently does not reach it for **643 of the 701** mentions. The fix is not
a new rule; it is 7.A.

### Candidate 2 — a dependency spec that differs between workspace manifests. **Rejected: not expressible.**

Real condition, real population, measured (§7.B): 61 shared keys, 3 divergent, 2 genuine.
It fails for a mechanical reason: **the census matches a regex against one file's content
at a time, and this condition is a comparison *between* files.** No pattern over
`core/Cargo.toml` can know what `engine/Cargo.toml` says. This is the same shape as the
corpus's recorded absences — an inventory question, not an occurrence question.

**The instrument that would work, specified.** `scripts/check-crate-dep-parity.mjs`, in
`npm run check`'s chain:

1. Parse `[dependencies]` and every `[target.'…'.dependencies]` of all workspace members
   with a **line-based** sectioner. (Not a regex over the whole file — my first pass used
   `(?=^\[|$)` under the `m` flag, `$` matched an end-of-line, and it reported
   `declared=[]` for all five crates, which would have turned all 701 cfg mentions into
   findings.)
2. Normalize each spec: drop `optional`, drop `path`, and **normalize the bare-string
   shorthand `"8.0.1"` to `{ version = "8.0.1" }`** — that one normalization is the
   difference between 3 findings and 2.
3. Fail on any dependency whose normalized spec differs across members, unless the
   divergence carries a `# parity-exempt: <reason>` comment on the line above. The
   `windows` trim in `core` gets one; `rusqlite` in `engine` does not, which is the point.
4. **Fail loudly on empty input** — exit 2 if fewer than 5 manifests or fewer than 40
   shared keys are found. Today: 5 and 61.

Assert-the-instrument note, because it applies to step 4: this check's negative case is
"the specs agree", and **an unread manifest also produces agreement**. Every parser bug in
this class silently improves the result.

### Existing rules checked for overlap

`build-gated-ipc-entrypoint` (`feature-flagged-compilation`) — same `#[cfg(feature)]`
vocabulary, different predicate (it keys on a cfg wrapping a `#[tauri::command]`
registration, all sites in `app_lib`); candidate 1's site set would have been a strict
superset with a disjoint intent, and it is moot at 0 matches. `unverifiable-generated-artifact`
(`codegen-task-registration`), `machine-specific-path-in-tooling` (`adding-a-ci-gate`),
`gate-without-empty-input-guard` (`cross-artifact-drift-gate`) — no shared anchors.

---

## §10 — Convergence (brief)

Cohort at measurement time: `../brainiac` is the only sibling with a Rust workspace; the
other four are Node/TypeScript, where the analogous question is package boundaries in a
monorepo and the enforcement story is entirely different. **So the effective cohort for
this leaf is 1, not 5**, and one repo agreeing is not a vote.

The one comparison worth stating, as self-comparison: **`brainiac` is a 7-crate workspace
designed as layers from the start; Personas is a 431k-line crate being disassembled into
layers while in daily use.** Those are different problems and the second one is harder —
which is why `crate-split-deps.mjs` exists here and has no counterpart there. The spine's
`convergence: converged` label does not survive: there is no fleet to converge with.

`sides: server` **holds**, and the mechanism is worth naming: a crate boundary has no
runtime representation at all. It is a property of the build graph, which the renderer
cannot observe and the wire format cannot carry.

---

## §12 — Corrections

**12.1 — To my brief: *"The real question is whether the layering is enforced or merely
observed: does anything prevent `core` from depending on `db`, or is the acyclic shape
maintained by hand? A layering nothing checks is a convention, and conventions in this repo
have measured badly."*** **Refuted on the specific claim, upheld on the general one.**
Nothing needs to prevent `core → db`, because `db → core` already exists and cargo rejects
a package-dependency cycle at manifest resolution, before compiling anything. The acyclic
shape is **machine-enforced by construction** and is one of the few invariants in this
repository that cannot drift. What *is* a bare convention is everything the brief did not
ask about: placement (7.C), feature declaration in the receiving crate (§9 candidate 1),
and dependency-spec parity (7.B). The brief pointed at the one thing that is safe.

**12.2 — To my brief: *"`engine/src/limits.rs` moved to `core/src/limits.rs` in
`262246e14`."*** Confirmed and generalized — it is not one module. `engine/mod.rs`
re-exports **six** modules from core at `:20` (`cron`, `crypto`, `lifecycle`, `trace`,
`types`, `url_safety`), **six more** at `:34` (`healing`, `limits`, `redact`, `run_budget`,
`scheduler`, `topology_graph`), `error_taxonomy` at `:60`, and **six** from `db` at
`:36-39`. Nineteen modules whose published path still says `engine`. Citing any of them as
`engine/src/<name>.rs` is wrong today, and the shim guarantees no compiler will say so.

**12.3 — To `.claude/CLAUDE.md`'s architecture block.** Its 2026-08-14 correction about
`src-tauri/src/db/` is right (the directory does not exist). The adjacent line describing
`src/engine/` as *"Execution engine, scheduler, healing, crypto"* names three modules that
now live in `personas-core` (7.F). Owed correction: name the four crates and where the
boundary falls, rather than a directory.

**12.4 — A count I had to discard and re-run.** My first implementation of the
undeclared-feature census reported **all 701 mentions as undeclared**, because its
`[features]` sectioner used `(?=^\[|$)` with the `m` flag and `$` matched an end-of-line,
so the section body matched empty. The shipped code I was cross-checking against
(`scripts/check-tauri-configs.mjs:54`) uses `(?=^\[|\Z)`, where `\Z` is a JS identity escape
for the literal character `Z` — which *looks* like the same defect and is not, because the
`^\[` alternative fires first on every manifest in this tree. **Two implementations
disagreed, the bespoke one was wrong, and the wrong one's answer (701 findings) was the
exciting one.** Replaying the shipped regex directly is what settled it.
