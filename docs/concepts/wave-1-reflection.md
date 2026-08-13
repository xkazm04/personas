# Wave 1 — reflection

> Written 2026-08-13 at the close of the first golden-path wave. 53 commits,
> 81 source files, 41 knowledge files. The question this answers: **was it net
> positive, and does any of it transfer?**

## Verdict

**Net positive for this codebase, with one real debt taken on deliberately.**
The debt is that we increased the amount of confident-sounding documentation
faster than we increased enforcement, and we switched on a large body of tests
that has never run. Both were the right trade, but neither is free, and the
second will look like a regression before it looks like an improvement.

**Portability is argued, not demonstrated.** No sibling repo has consumed a
golden path yet. Everything in the "transfers" section below is a hypothesis
with a good mechanism behind it, not a measured result.

## What actually shipped

**Three live defects that had shipped to users:**

1. **Arbitrary file read/write** in the Obsidian bridge. `vault.join(path).starts_with(vault)` — `Path::starts_with` compares components literally and never resolves `..`, so the guard returned `true` while printing "Path traversal detected". Verified by compiling and running the Rust, not by reading it. Closed, with a regression triad plus symlink-ancestor rejection.
2. **A feature that had never once worked.** `mcp_gateway_members` declared a foreign key to `credentials`; no such table exists (`persona_credentials` does). `CREATE TABLE` succeeded, every `INSERT` failed under `foreign_keys=ON`, and the table held zero rows. Repaired with a row-preserving rebuild.
3. **Three columns that were never added** and two live-update events that never fired, from `ALTER TABLE`/CDC statements naming tables that do not exist, swallowed by `let _ =`.

**Enforcement that did not previously exist:**

- **28 commands moved from zero enforcement to real enforcement.** Each already
  carried `#[requires(privileged|cloud)]` while sitting outside the list that
  enforces it — which for an async command is not a missing signal, it is no
  check at all.
- **`--workspace` added to CI's `cargo test`**, turning on ~770 `personas-db`
  tests that had never run, and to clippy, which additionally lacked
  `--features desktop` and so could not lint the Rust tree at all.
- **`if: always()` on 15 CI steps**, so the first red step stops hiding the rest.
- **Release now depends on CI** via a job that queries the API for this SHA's
  conclusion and hard-fails a publish.
- **An async auth-drift guard** with a shrink-only baseline of 21, which caught
  8 commands a hand-written scan had missed.
- **A concurrent-cargo guard**, after two agents' test runs made the machine
  unusable (5,629 CPU-seconds in one binary).

**Costs removed:**

- Test fixture rebuilt the full migration chain per call at ~576 sites. Now
  built once and copied: one suite went **89.2s → 2.94s**.
- The `CATALOG.md` line describing `LoadingSpinner` as canonical — for a
  component that renders `null` — corrected at its real source. That single
  line is the most plausible cause of 184 hand-rolled `animate-spin` sites.

## What we learned about this codebase

Four findings recurred across ten independent scouts and nine composers, which
is why they are worth more than any individual fix.

**1. The documentation manufactures the drift it warns about.** `CLAUDE.md`
recommended a component that does not exist at that path. The catalog described
a no-op as canonical. `overview-loading.md` told authors to hand-roll ghost rows
two weeks after the primitive absorbed them — and two call sites cite that
section *by name* while passing the prop that closes the gap.

**2. The primitives' defaults are the unsafe ones.** The shared skeletons
defaulted to the banned pulse and required an opt-in to behave.
`BaseModal.staggerChildren` defaults to the value that silently breaks the
commonest composition. `panelClassName` replaces rather than merges, so every
override discards the height ceiling.

**3. The better answer usually already exists, unused.** `usePolling` at 18%
adoption with dead backoff. `FormField` at 4 adopters against 289 raw inputs.
`DecisionRow`, `lazyRetry`, `AriaLiveProvider`, `safeJsonParse`, `run_lanes`
(marked dead code while four DAG drivers disagree), `useRovingTabIndex` at
**zero**. This repo does not lack good primitives; it lacks anything routing
people to them.

**4. Gates that run green while checking nothing.** CI passed 1 of its last 30
runs. `custom/no-unmanaged-effect-resources` measures precision 0/3, recall 0/3.
A parity test duplicates its fixtures instead of comparing two files. An FK
assertion runs against an empty database. The secret scan exits 0 when the
scanner is absent — it did so on every commit of this session.

## What transfers to other apps

**The method transfers; the content mostly does not.**

Portable:

- **Situations, not concerns, as the primary spine.** Filing by concern
  (concurrency, errors, data) scatters a procedure's parts across branches and
  makes it unassemblable. The cold-load doctrine survived here as six correct
  items in four different branches.
- **The nine-section contract**, especially §9 (the missing gate) and its
  requirement that a gate must fail loudly when its own precondition is absent.
- **Ground truth over memory.** Every composer that verified its brief found it
  wrong somewhere — my counts were out by 3.7×, 5×, and in one case backwards.
- **Disprove your own findings.** The most trustworthy outputs were the ones
  that cleared something: 121 alarming `.unwrap()` calls that turned out to be
  test-only, a "secrets in localStorage" claim that was zero.
- **Discovery by slice, then semantic merge.** Ten scouts over disjoint
  territories produced 527 candidates; mechanical dedup then judgment collapsed
  them to 247.

Not portable as written: the paths' **manifestation** layers are Tauri/React/
SQLite-specific. Their **principle** heads are deliberately stack-free — that is
what the P1 three-layer schema exists for — but no other repo has adopted one
yet, so the cross-project claim remains untested.

## Honest risks we are carrying

- **CI will get redder before greener.** Hundreds of assertions just switched
  on for the first time. Expect failures that are real and pre-existing.
- **28 newly fail-closed commands.** The token is attached universally and none
  opens a native dialog, but the Windows WebView2 batched-invoke race that
  justified three documented exclusions is a class we can only partly detect.
- **`execute_persona` changed tier** — the hottest path in the app. One-line
  revert if it misbehaves.
- **Four surfaces now delegate their loading contract to `UnifiedTable`, which
  has no test file.** Ghost rows also dropped 10 → 8 with uniform silhouettes.
- **18 of 247 leaves are written (≈7%)**, and the review rated 5 of 18 as
  needing revision. An incomplete corpus that sounds authoritative is its own
  hazard.
- **~20 gates were specified; 2 were built.** The gap between specified and
  enforced is exactly the gap this whole exercise exists to close, and it is
  currently at its widest.

## What would make wave 2 better

1. **Build the gates in the same wave as the path.** A specified gate is a
   promise; the corpus is now carrying twenty of them.
2. **One shared census runner** rather than ~460 bespoke scripts — 247 leaves ×
   ~2 gates is unmaintainable, and three paths already specified near-identical
   mechanisms independently.
3. **Re-measure shared facts once, centrally.** Four composers each counted the
   command total and produced four different numbers, three of which seeded
   floor assertions.
4. **Prove portability on one sibling repo** before authoring 229 more leaves.
   The cross-project premise is the largest untested assumption in the design.
