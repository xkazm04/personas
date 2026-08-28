# Golden path — Codegen task registration

> Situation node: `platform-delivery/build-profiles/codegen-task-registration` · [situation spine](../situation-spine.md)
> `sides: server` · recurrence **20** · risk **medium** · spine label `convergence: mixed`.
> Dimensions: **function · code-quality · resilience**.
> Spine's own framing: *a generator that writes a committed artifact, and the registration that makes it run.*
>
> Composed 2026-08-17 against `master` @ `f432a4ef3`.
>
> **The sweep was EXECUTED, not read.** Every one of the repo's **19** generators was run under a
> filesystem harness that intercepts `writeFileSync` / `fs.promises.writeFile` / `mkdirSync` /
> `rmSync` / `cpSync`, captures the *intended* bytes in memory, and diffs them against the committed
> artifact. **`git status --porcelain` was checked after every run and never showed anything but the
> one pre-existing modification the tree already carried.** That produced a fresh-or-stale verdict for
> **1,829 of the 1,861** committed generated artifacts. The partial-write question was answered by
> replicating `run-codegen.mjs:86-102`'s `spawn` + `SIGKILL` against a **scratch copy** of the
> 793-file locale tree and sweeping the kill offset.
>
> Static sweep: all **150** `.mjs`/`.js`/`.cjs` under `scripts/`, all **1,032** files in
> `src/lib/bindings/`, all **963** `.rs` under `src-tauri/`, `run-codegen.mjs`, `vite.config.ts`, all
> **four** `tauri.*.conf.json`, `package.json`'s 84 scripts, `lefthook.yml`, `.github/workflows/ci.yml`.
> Convergence: five sibling checkouts, all present, all opened.
>
> **`cargo` was NOT run and no build of any kind was started** — the operator uses this app daily.
> Every claim about `src/lib/bindings/` is static or comes from the working tree's own live drift.
>
> The **Deviations** section is a fix backlog. **Nothing in it was applied.**

---

## Scope — what this leaf owns, against two neighbours written yesterday

Two adjacent paths, both composed 2026-08-16, land on this leaf and are extended here rather than
re-derived.

| Question | Owner |
|---|---|
| Can the artifact, once built, say what it was built from? Is a value frozen with its provenance? | [compile-time-env-embedding](./compile-time-env-embedding.md) (rec. 9) |
| One decision implemented twice in two languages — what holds the two copies together? | [client-rule-mirroring](./client-rule-mirroring.md) (rec. 11) |
| **Which generators run, on which hook, and what notices when the committed artifact stops matching its source?** | **this path** |
| Whether the *contents* of a generated union are re-listed by hand downstream | [bridge-type-contract](./bridge-type-contract.md) |

`compile-time-env-embedding` treats a generated file as *a frozen value that happens to be spelled as
source*, and asks what it remembers. `client-rule-mirroring` established that **a generator only holds
the line if something runs it** (its P3). This path is that clause taken as the subject: the
registration *is* the mechanism, and everything below is a measurement of what happens where the
registration is missing, partial, or points at a hook that no longer exists.

---

## 0. The headline

**Nineteen generators. Fourteen registered. Five wired into nothing. And the committed artifacts of
the fourteen are byte-fresh — every single one — while four of the five unregistered ones are stale
right now.**

Every generator in the repo was executed into memory and diffed against what is committed:

| | generators | committed artifacts | **stale today** |
|---|---:|---:|---:|
| registered in `scripts/run-codegen.mjs`'s `TASKS` | **14** | 1,617 (incl. 793 section-locale JSONs) | **0** |
| registered only in `package.json` (`check:catalog-boundary`) | 1 | 1 | **1** |
| registered in **nothing** | **4** | 6 | **3** |
| ts-rs, via `cargo test … export_bindings` | — | 1,032 | unmeasurable without cargo (29 orphans, §7 B) |
| a skill tool, run by hand | 1 | 13 | unmeasurable (source assets are not in the repo) |

**Registration is the entire variable.** Not the header, not the language, not the drift check — the
14 registered generators and the 5 unregistered ones write the same kind of file, carry the same
`AUTO-GENERATED … DO NOT EDIT` banner, and have the same absence of a freshness assertion. The only
thing that separates a fresh artifact from a stale one is whether a name appears in a flat object
literal at `scripts/run-codegen.mjs:22-68`.

### The three findings that reframe the rest

**(a) Codegen guarantees the mirrors agree with each other. Measured, both directions.**
`scripts/docs/gen-tour-anchors.mjs` emits a JSON manifest and a Rust allow-list *"both generated from
the same scan so they never drift."* Dry-run diff:

| | committed | fresh from the tree | delta |
|---|---:|---:|---|
| `testids` | 945 | 1,044 | **101 in the tree, absent from the allow-list**; **2 dead** |
| `dynamicPrefixes` | 269 | 293 | **26 in the tree, absent**; **2 dead** |
| `sidebarSections` | 11 | 11 | — |
| `subTabSetters` | 7 | 7 | — |
| **cross-artifact consistency** (JSON ↔ `.rs`, as committed) | | | **json-only 0 · rust-only 0** |

**127 anchors behind reality, 4 dead — and 0 disagreements between the two artifacts.** The
consistency the header promises is real and worthless. And the cost is not one rejection but two:
`companion/tours.rs:98` refuses any anchor outside `TOUR_TESTIDS`, *and* `tours.rs:331` splices the
same stale list into the **prompt** that asks a model to compose the tour. The composer is told the
127 anchors do not exist, then punished for not using them.

**(b) A killed generator does not leave a stale file, or a zero-byte file. It can leave no file at
all — and 792 of its siblings gone with it.** `compile-time-env-embedding` §7 E1 executed the
`writeFileSync` case and found a **0-byte** destination, and §7 E2 predicted that
`split-locales.mjs`'s 793-file loop *"leaves a mixture of new and stale sections."* **It does not.**
`split-locales.mjs:56` calls `removeDir(sectionDir)` — `fs.rmSync(recursive, force)` — **before** the
write loop. Replicating the runner's `spawn` + `SIGKILL` against a scratch copy:

| kill offset from the child's READY signal | files surviving of 793 |
|---|---:|
| uninterrupted (**2,760 ms** end to end) | 793 |
| +0 ms | 789 |
| +20 ms | 740 |
| +80 ms | 568 |
| +160 ms | 439 |
| **+320 ms** | **the directory does not exist** |
| +640 ms | 95 (rewriting) |

So the third state of an interrupted generator is **absence**, it is reachable in a third of a
second, and it is the only state in which the artifact's own `DO NOT EDIT` header cannot warn anyone —
because there is no file left to hold it. Neither `tsc` nor `cargo` can see it: those 793 are loaded
at run time by `useTranslation.ts:27`'s `import.meta.glob`.

**(c) The one generator that compares before writing does so for the wrong reason, and its guard is
dead.** `generate-connector-seed.mjs:95-102` reads the committed artifact, compares it to the fresh
bytes, and skips the write — *"to avoid unnecessary Rust rebuilds"*. It is two lines from being a
drift check and is not one. `split-locales.mjs:16-22`'s `writeIfChanged` is worse: it tests
`fs.existsSync(file)` **after line 56 deleted the whole directory**, so for **793 of its 794** call
sites the guard can never fire. The repo has the mechanism, deployed twice, aimed at build latency.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path or count.
Each clause names its warrant.

> **P1 — physics. A generated artifact is only as fresh as its weakest trigger, and the trigger is
> the whole design.** Choosing to generate is choosing to own a schedule. Write the registration in
> the same change as the generator, in one declared place, and make the declaration reviewable.
> *Warrant: measured here as a clean split — every artifact produced by a registered generator is
> byte-fresh, and most artifacts of unregistered generators are stale, with no other property
> distinguishing them; independently reinvented as a defect in a sibling repo whose single committed
> generated file is produced by a generator named in exactly two places, itself and its own output.*
>
> **P2 — physics. Prefer not committing the artifact at all.** If the artifact can be regenerated
> into a location the version-control system does not track, on a step that cannot be skipped, the
> whole class of staleness stops existing. Commit it only when something must read it without running
> the generator.
> *Warrant: two of six repos already do exactly this for their largest generated surface and have
> zero staleness to detect; this repo does it too, for one artifact, and that artifact is the only
> one whose freshness is guaranteed by construction rather than by discipline.*
>
> **P3 — physics. A `DO NOT EDIT` header is a promise, not a mechanism.** It tells every reader the
> file is a projection and gives them no way to find out whether it still is. It is worth writing —
> but count it as documentation, and never as the thing that holds the line.
> *Warrant: the header is present on essentially every committed generated file in this repo, is
> equally present on the fresh ones and the ones a hundred entries behind, and the fleet's one
> genuinely-verified generated artifact carries no header at all.*
>
> **P4 — physics. The assertion that holds a generated artifact is "the committed copy equals what
> the code produces right now", and it belongs in the test suite, not in CI configuration.** A test
> runs locally, in every fork, on every branch, and cannot be skipped by an unrelated infrastructure
> failure.
> *Warrant: independently built in a sibling repo as a unit test with the regeneration command in its
> failure message; the equivalent here is two CI jobs, one of which is documented in its own file as
> green 5 times in 20.*
>
> **P5 — physics. A generator must never be able to leave less than it found.** Build the whole output
> in memory, then replace atomically; never delete first, and never truncate first. An interrupted
> build is not a rare event — it is a keystroke.
> *Warrant: executed here — an interrupt a third of a second into one generator removes 793 committed
> files, and an interrupt at any point during another leaves its destination at zero bytes, because
> the write mode truncates before the first byte lands.*
>
> **P6 — ergonomics. Every build entry point must reach the same generation step, and every config
> that names a build command is an entry point.** The bypass is never taken deliberately; it is
> inherited from a config file written for a different platform.
> *Warrant: this repo deleted a redundant bundler hook, wrote down in the config exactly which command
> would skip codegen if used directly — and then a second build profile in the same directory names
> precisely that command.*
>
> **P7 — ergonomics. A generator whose input is another generator's output inherits its schedule, not
> your intent.** Chained projections must be registered as a chain or they will disagree about which
> generation they belong to.
> *Warrant: one artifact here regenerates to seven times its committed size because its input file is
> now written by a different tool on a different trigger; a sibling repo verifies the first hop of its
> two-hop pipeline with a good test and leaves the second hop to a sentence in the failure message.*
>
> **Scale condition.** P1, P5, P6 are correctness on day one. P2 is a design choice available only
> before the first commit of the artifact. P3, P4 bite the first time someone changes the source and
> not the artifact. P7 bites only once a second generator consumes the first one's output.

---

## 1. Trigger

- "I'll write a script to generate this instead of maintaining it by hand."
- "Where do I add a codegen step?" / "does this run on `npm run dev`?"
- "Why is this generated file out of date?" / "did the codegen run?"
- "It says DO NOT EDIT — so it can't be stale, right?"
- "This allow-list is rejecting something that exists." / "the model keeps picking anchors that fail validation"
- "Just run `vite build` directly, it's faster."
- "Add `--force` so it overwrites." / "delete the folder first, then rewrite it clean."

**If you are about to type** a new `writeFileSync` whose destination is a path under `src/` or
`src-tauri/`, a template string containing `AUTO-GENERATED` or `DO NOT EDIT`, an `fs.rmSync` on a
directory you are about to repopulate, a new key in `scripts/run-codegen.mjs`'s `TASKS`, or a
`beforeBuildCommand` in a `tauri.*.conf.json` — **you are in this situation.**

You are **not** in this situation when the question is what the frozen value *is*
([compile-time-env-embedding](./compile-time-env-embedding.md)), when two hand-written copies of one
rule must agree ([client-rule-mirroring](./client-rule-mirroring.md)), or when the artifact is a
developer convenience nothing reads.

---

## 2. The one way

**Do not commit the artifact if you can avoid it; if you must, register the generator in
`scripts/run-codegen.mjs`'s `TASKS` and in both `PRESETS` in the same commit as the generator, make
the generator answer `--check` by comparing its in-memory output against the committed file, and pin
that comparison in a test rather than a CI step.** Reach in that order. **Prefer generating into a
gitignored destination** — `sync-system-skills.mjs` writes `src-tauri/resources/skills` and is the one
artifact in this repo that cannot be stale, because there is nothing committed to be stale against.
When the artifact must be committed (the compiler reads it, or a fresh clone must build without
running your script), **the registration is the deliverable, not the generator**: add the task to
`TASKS`, add it to `predev` *and* `prebuild` unless you can write down why not, and verify by running
it and confirming `git diff` is empty. **Build the entire output in memory and replace the destination
atomically** — `writeFileSync(dest, …)` opens `'w'` and truncates before the first byte, so an
interrupted build leaves an empty committed file, and an `fs.rmSync` of the output directory before
the write loop leaves *no* file and takes every sibling with it. **Give the generator a `--check`
mode in the same change**: it already holds both sides in memory, so the comparison is three lines,
and it is the only instrument that can distinguish "committed copy is current" from "committed copy
looks plausible". **Then assert that comparison from the test suite**, not from a workflow step — a
test runs on the developer's machine, in every fork, and survives an unrelated CI outage. Write the
`AUTO-GENERATED by <path> — DO NOT EDIT. Re-run: <command>` header too, and name the input with a
count the way `commandNames.generated.ts:1-4` does, but **count it as documentation**: it is present
on the artifact that is 127 entries behind and on the one that is byte-fresh, and it has never once
been the thing that noticed. **Then stop**: do not add a second entry point that reaches the artifact
by a different route, do not let a `beforeBuildCommand` name a command that skips the hook, and do not
chain a second generator onto the first's output without registering the chain.

If you must get one right first: **register it**. Everything else in this path is a way of surviving
a generator that ran late; nothing survives a generator that never ran.

---

## 3. Mandated primitives

**Exist today — use them.**

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`scripts/run-codegen.mjs:19-73` — `TASKS` + `PRESETS`** | **The registry, and the reason it is flat.** A single object literal mapping task name → script path, two preset arrays, and a written rule against auto-discovery: *"Keep this mapping flat and explicit — no glob/auto-discovery, so the set of codegen tasks is reviewable in one place."* Every task carries a comment saying what put it there. **This is the fleet's only such artifact** (§ Convergence) and it is the primitive this leaf is named after. | **14** tasks · 13 in `predev` · 13 in `prebuild` |
| **`scripts/run-codegen.mjs:97-102, :129-150`** | **A watchdog that actually fails the build.** `SIGKILL` at `CODEGEN_TIMEOUT_MS` (default 60 s), `Promise.allSettled` so one failure does not mask the others, and `process.exit(failed === 0 ? 0 : 1)` — which makes npm abort `dev`/`build`. Confirmed: the build *does* notice a timeout. | 1 |
| **`scripts/docs/gen-shared-catalog.mjs:183-193` — the `--check` mode** | **The only generator in the repo that can be asked whether the committed copy is current.** Same code path builds the markdown; `--check` compares and exits 1 with the regen command. Run today: `shared catalog up to date (128 components)`, exit 0. Copy this shape. | **1 of 19** |
| **`scripts/generate-connector-seed.mjs:95-102` — compare-before-write** | The three lines that turn a generator into a drift detector, present and aimed elsewhere: it skips the write when `existing === output` *"to avoid unnecessary Rust rebuilds"*. The comparison is already there. | 1 |
| **`scripts/check-command-contract.mjs:231-250`** | **The repo's one drift check that runs locally.** Extracts the union from `commandNames.generated.ts`, extracts the handler list from `src-tauri/src/lib.rs`, and reports `missing from generated` / `stale in generated` per name. It is inside `npm run check:contracts`, which is inside `npm run check`. Green today: `Command contract OK (1585 registered, 18 intentional overrides)`. | 1 artifact |
| **`scripts/generate-guidance-anchors.mjs:43-46` — the generator precondition** | *"Parsed 0 anchors … refusing to write an empty allow-list."* A generator that fails loudly rather than emitting an empty projection. Verified fresh (739 bytes, identical). Copy this into every generator that projects a set. | 1 |
| **`scripts/sync-system-skills.mjs` → `src-tauri/resources/skills`** | **The structural answer, already in the repo — with one qualification measured a day later.** The destination is **gitignored**, so there is no committed copy to drift; the task is registered in both presets *and* re-run by `npm run build` itself. **But [catalog-browse-and-apply](./catalog-browse-and-apply.md) then measured 22 stale directories sitting in that destination right now**, retired 2026-08-04, already copied into `target/debug/skills` and mapped into the installer by `tauri.conf.json:130`. An untracked destination deletes the *drift* condition and **deletes the visibility with it** — which is strictly worse than a stale tracked file `git status` would have shown. The clause should read *“generate into an untracked destination **and reconcile it on every run**”*: a generator only holds the line if something runs it, and **a mirror only holds the line if something prunes it.** | 1 of 19 |
| **`scripts/i18n/gen-types.mjs:44-49` — the self-documenting header** | The header that names its own registration: *"Regenerate with: node scripts/i18n/gen-types.mjs / Runs automatically in prebuild (see package.json scripts)."* A reader can check the claim. | 1 of ~20 headers |
| **`src/lib/commandNames.generated.ts:1-4`** | The best generated header in the repo — generator, re-run command, source file, **and the derived count** (`1585 commands`), which a reader can falsify without running anything. | 1 |

**Do not exist — and this is the leaf's structural finding.**

- **There is no `--check` on 18 of 19 generators**, so for 18 of them there is no way to ask the
  question this path is about without a harness like the one written for this document.
- **There is no freshness assertion in the test suite.** `npm run test` (Vitest) and `npm run test:rust`
  contain nothing that compares a committed artifact to what its generator produces. The three that
  exist are `check-command-contract.mjs` (local, 1 artifact), `ci.yml:334-341` (CI, 1 artifact),
  `ci.yml:419-437` (CI, 1,032 artifacts, **documented at `ci.yml:355` as "5/20 green"**).
- **There is no atomic write anywhere in the build tooling.** `renameSync` appears **0 times** in the
  150 `.mjs`/`.js`/`.cjs` files under `scripts/` — re-verified independently for this document.
- **There is no registry entry for a generator's *output*.** `TASKS` maps a name to a script path and
  says nothing about what the script writes, so nothing can join a task to its artifact, and nothing
  can notice that five generators write committed files and appear in no preset at all.

---

## 4. Steps

1. **First ask whether the artifact has to be committed.** If every consumer runs after `npm install`
   or after a build step you control, generate into a gitignored path and register the generator on
   that step. `sync-system-skills.mjs` is the worked example. This deletes the leaf for that artifact.
2. **If it must be committed, write the registration before the generator.** Add the key to
   `TASKS` and to **both** `PRESETS` at `run-codegen.mjs:70-73`. Appearing in only one preset is a
   real choice (`checksums` is prebuild-only, `host-check` predev-only) and needs a comment saying so —
   the file's existing per-task comments are the standard.
3. **Build the whole output in memory, then replace it atomically.** `writeFileSync(<dest>.tmp, body)`
   then `renameSync(<dest>.tmp, <dest>)`. **Never `rmSync` an output directory before repopulating it** —
   that is not a stronger version of overwriting, it is a window in which the artifact does not exist
   (§0 (b), executed). If the output is a *set* of files, stage the whole set into a temp directory
   and rename the directory.
4. **Add `--check` in the same change.** The generator already holds the fresh bytes; compare them to
   the committed file, print the regeneration command, exit 1. Copy `gen-shared-catalog.mjs:183-193`.
   Make the comparison EOL-insensitive — on this repo's platform `git` will smudge working copies to
   CRLF and a byte comparison will fail for a reason that has nothing to do with drift.
5. **Assert `--check` from a test, not from a workflow step.** A Vitest case that spawns the generator
   with `--check` and asserts exit 0 runs on `npm run test`, in every fork, on every branch, and cannot
   be taken offline by an unrelated CI failure. The precedent is `brainiac`'s
   `crates/brainiac-server/src/openapi.rs:425` `committed_document_is_current` (§ Convergence).
6. **Write the header, and know what it is worth.** `AUTO-GENERATED by <script> — DO NOT EDIT.
   Re-run: <command>`, plus the input and a count. It is genuinely useful to a reader and it has
   never caught a stale file. Step 5 is the mechanism; this is the label.
7. **Check every build entry point reaches the step.** Grep every `beforeDevCommand` /
   `beforeBuildCommand` in `src-tauri/tauri.*.conf.json`, every `package.json` script, and every CI
   workflow for a command that reaches the bundler without going through `predev`/`prebuild`. There is
   one today and it is committed (§7 A3).
8. **If your generator's input is another generator's output, register the chain.** Order the tasks or
   fold them into one task. An artifact whose input changed under it regenerates to something nobody
   asked for (§7 D2, measured at 7× the committed size).
9. **Then stop.** Do not add a second path to the artifact. Do not add `--force`-only regeneration
   (§7 C3). Do not rely on the header.

### Can the primitive's signature make the wrong call impossible? — asked before §9

Held against the corpus's seven qualifications, the answer is **yes for one of the two conditions and
a flat no for the other**, and the split is the useful part.

**T1 — make the destination unrepresentable as a committed path.** The strongest available type here
is not a TypeScript type; it is the **destination**. A generator whose output lives where git does not
look cannot be stale, cannot be hand-edited, cannot be emptied by an interrupt in a way that survives,
and needs no gate. That is `sync-system-skills.mjs` here and `prisma generate` in `ascent`.

- **Q3 — a type nobody constructs constrains nothing; this decides the scope.** Measured: of the
  **1,861** committed generated artifacts, the ones that genuinely *must* be committed are the ones
  read without running the generator — the **1,032** ts-rs bindings (`tsc` reads them), the **793**
  section locales (Vite's `import.meta.glob` resolves them at build time), the Rust seeds. The ones
  that need not be are the ones read only by humans or by a checker: `CATALOG.md`,
  `catalog-curation.md`, `.claude/codebase-context.md`, `shared-facts.json`,
  `connector-docs.manifest.json`. **Five of the six stale artifacts measured today are in that second
  group.** The population where T1 reaches is small, and it is exactly the population that is broken.
- **Q5/Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is *a committed
  copy that can disagree with its source*, not the generation. Withholding the commit keeps the
  artifact and removes the disagreement.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.** Nothing
  forces `gen-tour-anchors.mjs` to write into the source tree; its author chose it because the Rust
  half must compile. For `generated_tour_anchors.rs` that reason is real and T1 does not reach.

**T2 — the registration itself cannot be a type, and this is the doctrine's fifth unreachable place
in a new costume.** [compile-time-env-embedding](./compile-time-env-embedding.md) established that a
type cannot reach **across a build boundary** because *"by the time the question is asked, the other
side of the boundary is gone"*. Registration is the same wall approached from before the build rather
than after it: **the fact that a generator has not run leaves no artifact anywhere for a type to
constrain.** `run-codegen.mjs`'s `TASKS` is a plain object in a `.mjs` file — no type system in this
repo can require that a script writing to `src/` appears in it, because the two facts live in
different files, different languages, and one of them is an absence. **The honest answer for the
registration half is: no type reaches it, which is exactly where the doctrine says a census rule
earns its place** — and §9 ships one for the *promise* while refusing to gate the *registration*.

**A third finding, and it is the one that generalises.** `src/lib/bindings/` is 1,032 files produced
by a generator with a real drift check, and it still carries **29 orphans** — bindings whose Rust
source no longer exists anywhere in 963 `.rs` files, **26 of which are still imported and 22 of which
are the declared return type of a live `invoke`** (§7 B1). The drift check is `git diff --quiet`, and
an orphan produces **no diff**. So: **a generated artifact can be stale in a way that is structurally
invisible to a comparison against the generator's output, because the generator no longer knows the
artifact exists.** No type and no diff reaches a file the projection has stopped projecting. Only an
inventory of what *should* exist does — which is the doctrine's *"fixing every instance of a defect is
not the same as covering every place that needs the behaviour"*, arriving in the codegen lane.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Shipping a generator without registering it** | The artifact is correct on the day it is written and drifts forever after. Measured: 4 of the repo's 5 unregistered generators, 3 stale, the worst 127 entries behind. §7 A1, A2, D1, D2. Reinvented in a sibling at 1 of 1. |
| **Treating the `DO NOT EDIT` header as the mechanism** | It is present on the fresh artifacts and on the ones a hundred entries behind, identically. The fleet's only verified generated artifact has no header at all. |
| **`rmSync` the output directory, then repopulate** | Not a stronger overwrite — a window with no artifact. Executed: an interrupt 320 ms in leaves the directory *gone*, 793 tracked files with it. It also kills the `writeIfChanged` guard on the very next line. §0 (b), §7 C1. |
| **`writeFileSync` straight onto the committed destination** | `'w'` truncates before the first byte. An interrupt leaves a **0-byte** committed artifact that no header can warn about. Executed by [compile-time-env-embedding §7 E1](./compile-time-env-embedding.md); re-confirmed here — `renameSync` is still 0 across 150 tooling files. |
| **A `beforeBuildCommand` that reaches the bundler directly** | `src-tauri/tauri.android.conf.json:beforeBuildCommand` is `npx vite build` — the exact command `vite.config.ts:46-49` warns skips codegen. Zero of 14 tasks run on that profile. §7 A3. |
| **Putting the freshness assertion only in CI** | `ci.yml:355` records its own binding-drift job as **"5/20 green"**. A gate that passes a quarter of the time is a gate nobody reads. A test in the suite runs everywhere. |
| **A `--check` flag that checks something else** | `classify-shared.mjs --check` sounds like a staleness check for `catalog-curation.md`, the file it writes. It is a boundary lint on a different set of files, it exits **1** today, and the artifact it writes is stale by 11 KB. The flag points at a different destination than the artifact. §7 D3. |
| **Compare-before-write used for build latency** | Two generators here already read the committed file and compare it to fresh output — and both use the answer to skip a rebuild, not to report drift. The instrument exists and is pointed at the cheaper problem. §0 (c). |
| **Generating from another generated file without registering the chain** | `.claude/codebase-context.md` is a deterministic projection of `context-map.json` — which is now written by a *different tool on a different trigger*. Re-rendering produces **448,823 bytes against 64,787 committed**. §7 D2. |
| **`existsSync(file) && !force` as the update policy** | `scan-agents-to-skills.mjs:403-405` skips any output that already exists unless `--force`. The generator refuses to update its own artifact, so staleness is not merely undetected — it is structurally unreachable. §7 C3. |
| **Trusting `git diff` to see a stale generated file** | It sees tracked files that changed. It cannot see an **orphan** — an artifact whose source is gone, which produces no diff and no untracked file. 29 here, 26 still imported. §7 B1. |
| **Adding a drift check without asking what its population is** | `check-unused-bindings.sh` guards the opposite direction (a binding nobody imports), exits **1** today with **98** findings, and *protects* 26 of the 29 orphans, because they are imported. |

---

## 6. Evidence

**Adoption, measured by execution.** 19 generators · **14** registered in `TASKS` · 13 per preset ·
**5** registered in nothing (4 of them writing committed artifacts) · **1,861** committed generated
artifacts · **1** generator with a working `--check` · **2** with compare-before-write (one of them
dead) · **3** freshness assertions covering **1,034** of 1,861 artifacts, of which **1** runs locally ·
**0** atomic writes across 150 tooling files · **0** freshness assertions in the test suite ·
**6** artifacts measurably stale today.

**The ONE site to copy: `scripts/docs/gen-shared-catalog.mjs` together with its `package.json`
registration.** It is the only generator in the repo that is registered, that can be asked whether the
committed copy is current, and that is fresh:

```js
// gen-shared-catalog.mjs — the check and the write share one code path
const md = render(components);                    // built entirely in memory
if (process.argv.includes('--check')) {           // :183
  // compare against the committed file, print the regen command, exit 1
}
writeFileSync(OUT, md);                           // :192
```
```jsonc
// package.json
"gen:catalog":   "node scripts/docs/gen-shared-catalog.mjs",
"check:catalog": "node scripts/docs/gen-shared-catalog.mjs --check",
// run-codegen.mjs TASKS: catalog: "scripts/docs/gen-shared-catalog.mjs"  -> both presets
```

Four things to copy: (1) the fresh bytes are built once and used by both modes, so `--check` cannot
drift from the write; (2) the task is in `TASKS` *and* both `PRESETS`, so `predev`/`prebuild` always
run it; (3) the failure message names the command; (4) the header on the artifact names the generator.
**The one thing NOT to copy is where the assertion lives** — `check:catalog` is not in `npm run check`
and nothing runs it automatically, which is why the shape is right and the wiring is only half done.
Put it in the test suite (step 5).

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `scripts/run-codegen.mjs:19-21, :39-49, :61-67` | **The registry and its comments.** *"Keep this mapping flat and explicit — no glob/auto-discovery, so the set of codegen tasks is reviewable in one place."* Each task's comment names the incident that put it there: `sprites` *"Previously orphaned in vite buildStart only (asymmetric: `npm run dev` regenerated, plain `npm run predev` did not)"*; `system-skills` *"a fresh clone that only ever ran `tauri dev` failed with 'resource path resources\skills doesn't exist'"*. **This file is the fleet's only codegen registry and it is honestly maintained.** |
| `scripts/generate-guidance-anchors.mjs:43-46` | **The precondition that makes the generator fail loudly**: *"Parsed 0 anchors … refusing to write an empty allow-list."* Its sibling `gen-tour-anchors.mjs` has no such guard and no registration; this one has both and is byte-fresh. Two generators, same author's idiom, one line and one registry entry apart. |
| `scripts/sync-system-skills.mjs` + `run-codegen.mjs:61-67` + `package.json:build` | **The gitignored destination.** Registered in both presets *and* re-run by `npm run build` itself. Belt and braces on the one artifact that needed neither, because the destination is not committed. |
| `scripts/check-command-contract.mjs:231-250` | **A drift check that lives in `npm run check`.** It does not regenerate; it extracts both sides and diffs the *names*, so it needs no cargo and no build. Under 250 ms. This is the shape for any artifact whose source can be parsed cheaply. |
| `scripts/i18n/gen-types.mjs:44-49` | **A header that states its own registration**, so the claim is falsifiable by reading `package.json`. |
| `vite.config.ts:39-49` | **A deleted hook, with the deletion reasoned in place** — why `buildStart` codegen was removed (*"silently diverging when a script was added to buildStart only"*), what replaced it, and what happens if you bypass it. Then read `src-tauri/tauri.android.conf.json` and see the bypass committed six directories away (§7 A3). |
| `.github/workflows/ci.yml:419-431` | **The gate that was fixed after it was proven blind.** `git diff --quiet` exits 0 for an untracked file, so a *new* binding — the exact case a drift check exists for — was invisible. `git ls-files --others --exclude-standard src/lib/bindings/` was added 2026-08-14 with the verification in the comment. **This is the correction this leaf's brief had not caught up with (§12.2).** |

---

## 7. Deviations found

**Four categories, 12 individually-addressable items.** All ship green under `npm run check`
(`check:contracts` · `check:tiers` · `check:tauri-configs` · `check:csp-hosts` · `check:corpus` ·
`check:doc-map` · `census:check` · `tsc --noEmit` · `eslint src/`) and under the pre-commit and
pre-push hooks. **Per the campaign's no-destructive-applies rule, nothing here was applied.**

### A. Generators registered in nothing, and a build profile that skips all of them — 3

**A1 — `scripts/docs/gen-tour-anchors.mjs` is registered in nothing, and both its artifacts are
stale. Executed.** The generator is named in **no** `package.json` script, **not** in
`run-codegen.mjs`'s 14 `TASKS`, **not** in `.github/workflows/ci.yml`, **not** in `lefthook.yml`,
**not** in `vite.config.ts`. Its two artifacts are `src/features/onboarding/anchors/tourAnchorManifest.json`
(33,854 bytes committed → 37,321 fresh) and `src-tauri/src/companion/generated_tour_anchors.rs`
(34,425 → 37,893). Decomposed in §0 (a): **127 anchors in the tree absent from the allow-list, 4 dead
(`daily-goals-create`, `studio-chat-input`, `companion-strip-`, `mm-category-`), and 0 disagreements
between the two committed artifacts.** Consumers: `src/stores/slices/system/dynamicTours.ts:20`
imports the JSON and validates Athena-composed tours against it; `src-tauri/src/companion/tours.rs:98`
rejects any `highlightTestId` outside `TOUR_TESTIDS` before persisting; and `tours.rs:325-333`
splices the same stale list into the composition **prompt** under *"every highlightTestId MUST be from
this list"*. **Fix (note): one line in `TASKS` and one in each preset.**

**A2 — four more generators write committed artifacts and appear in no registry.**

| generator | committed artifact(s) | registered in | verdict today |
|---|---|---|---|
| `scripts/docs/gen-tour-anchors.mjs` | 2 (above) | **nothing** | **STALE** |
| `scripts/docs/measure-shared-facts.mjs` | `docs/concepts/shared-facts.json` | **nothing** | **STALE** |
| `scripts/context/render-codebase-context.mjs` | `.claude/codebase-context.md` | **nothing** | **STALE** |
| `scripts/refactor/classify-shared.mjs` | `docs/refactor/catalog-curation.md` | `package.json` only (`check:catalog-boundary`, not in `npm run check`) | **STALE** |
| `scripts/skills/scan-agents-to-skills.mjs` | `.claude/skills/scan-sweep/{SKILL.md,references/lenses.md,scripts/coverage.mjs}` | **nothing** | unmeasurable — refuses to rewrite (§7 C3) |
| `scripts/generate-cli-bridge.mjs` | none yet (`--out <path>`, operator-supplied) | **nothing** | n/a |

**A3 — a committed build profile names the one command that skips every codegen task.**
`src-tauri/tauri.android.conf.json` sets `"beforeBuildCommand": "npx vite build"`.
`vite.config.ts:46-49` says in as many words: *"if you bypass `npm run dev` / `npm run build` (e.g.,
by running `vite build` directly), regenerate codegen first via `node scripts/run-codegen.mjs
prebuild`."* `npx vite build` fires no `prebuild`, so **0 of 14 tasks run** on that profile. The base
`tauri.conf.json` is correct (`npm run dev` / `npm run build`) and `tauri.lite.conf.json` /
`tauri.stable.conf.json` inherit it — the Android overlay is the only one that overrides the command,
and it overrides it to the documented bypass. `scripts/check-tauri-configs.mjs` validates
`build.features` and CSP across the four configs and does not look at `beforeBuildCommand`.
*This is the sharper form of [compile-time-env-embedding §7 E4](./compile-time-env-embedding.md),
which found the bypass documented in prose; here it is wired into a config a build system executes.*
**Fix (note): `npm run build`.**

### B. The one artifact family with a real drift check, and the hole in it — 2

**B1 — 29 orphan bindings: generated files whose Rust source no longer exists, 26 still imported, 22
still the declared return type of a live `invoke`. Three independent implementations.** Walking all
963 `.rs` files: implementation A (a `#[derive(…TS…)]` scan that walks forward to the item name)
found 48 candidates; implementation B (any `struct`/`enum`/`type` declaration of that name, regardless
of derive) found 31; implementation C (the identifier appears **nowhere** in any `.rs` file) found
**29**. The A→B gap is macro-generated types — `ExecutionState` comes from `declare_lifecycle!` and
has no literal `enum ExecutionState` line — which is why the strictest implementation is the honest
one and the loosest was wrong by 19.

Hand-verified sample:

```
src/api/vault/credentials.ts:100   invoke<VaultStatus>("vault_status")
src-tauri/src/commands/credentials/crud.rs:427
    pub fn vault_status(state: …) -> Result<serde_json::Value, AppError>
```

**There is no Rust type named `VaultStatus`.** The frontend types a live IPC response against a
generated binding that is a fossil: ts-rs wrote it once, the source was renamed or inlined, and ts-rs
**never deletes**. The same shape holds for `McpPingResult`, `ZapierZap`, `OAuthStatusResult`,
`SchemaValidationResult` and 17 others. `git diff --quiet src/lib/bindings/` cannot see any of it —
an orphan produces no diff and no untracked file, so the gate is green precisely because the artifact
has stopped being generated. *(The related gate points the other way: `check-unused-bindings.sh` fails
when a binding is **not** imported. It exits **1** today with **98** findings, and it exempts 26 of
these 29 because they are imported.)*

**B2 — the binding drift gate is documented in its own file as green 5 times in 20, and it is the only
check covering 1,032 of the 1,861 artifacts.** `ci.yml:355`: *"binding-drift is 5/20 green."* The job
needs a 45-minute `cargo test --workspace --features desktop` on Linux with 12 apt packages, and the
same keychain wall that gates `rust-tests`. The comments at `:398-417` are excellent and explain
exactly why `--workspace` and `--features desktop` are load-bearing. **The mechanism is right and the
host is wrong** — this is P4's warrant, in the repo's own words.

**B3 — a live formatting drift in the working tree, and it is the specimen for what a formatter does
to a generated file.** `src/lib/bindings/SkillEntry.ts` is modified on `master` right now: the
committed copy has trailing whitespace stripped; the working copy — freshly emitted by ts-rs — has it.
Measuring the emitted style across all 1,032 bindings: **165** are multi-line object emissions, of
which **161** carry ts-rs's `= { ` (trailing space) and **4** do not (`EnclavePolicy.ts`,
`EnclaveSealResult.ts`, `EnclaveVerifyResult.ts`, `KbSearchResponse.ts`) — plus `SkillEntry.ts` at
HEAD, making **5**. Each is a guaranteed future diff in the binding-drift job for a reason that has
nothing to do with a type changing.

> *A measurement correction, kept because it is the doctrine's hand-verify rule paying for itself in
> one step.* My first implementation counted "a binding containing a doc comment and no trailing
> whitespace" and reported **253** stripped files. Opening two of them showed the absence is
> **structural**: `AlertSeverity.ts` is a one-line union and `AdoptedTeamPresetMember.ts` is a
> one-line object — ts-rs emits no trailing space in either shape. Restricting the population to
> multi-line object emissions gives **4**, and two implementations then agree exactly (A\B = 0,
> B\A = 0). **The first number was wrong by 63×, and the two implementations that would have "agreed"
> were the same wrong idea twice.**

### C. What a killed or half-run generator leaves — 3

**C1 — `split-locales.mjs` deletes 793 committed files before writing, and an interrupt a third of a
second in leaves none of them. Executed.** Full sweep in §0 (b). Mechanism: `split-locales.mjs:56`
`removeDir(sectionDir)` → `fs.rmSync(dir, { recursive: true, force: true })`, then the write loop at
`:58-66`. The uninterrupted run takes **2,760 ms**, so `run-codegen.mjs`'s 60-second `SIGKILL` is
**not** the realistic trigger — a Ctrl-C on `npm run dev` is, and this repo's own `.claude/CLAUDE.md`
documents that exact event recurring (*"a previous `tauri dev` failed mid-startup and orphaned
Vite"*). The 793 files are the only committed generated artifacts neither `tsc` nor `cargo` can see:
`src/i18n/useTranslation.ts:27` resolves them through `import.meta.glob`. **Fix (note): stage the set
into a temp directory and rename it, or drop the `removeDir` and reconcile deletions explicitly.**

**C2 — the `writeIfChanged` guard on those 793 files is dead by construction.**
`split-locales.mjs:16-22` short-circuits when `fs.existsSync(file)` and the content matches. Line 56
has already deleted the directory, so `existsSync` is **false for all 793**. Only the 794th call —
`enSectionStrings.ts`, which lives in a directory `removeDir` does not touch — can ever take the fast
path. Confirmed by execution: hiding the destination tree from the harness makes the generator emit
all **794** writes, and all **794** are byte-identical to what is committed.

**C3 — a generator that refuses to update its own artifact.** `scripts/skills/scan-agents-to-skills.mjs:403-405`:
`if (existsSync(file) && !force) { console.log('skip …'); skipped++; }`. Run today it reports
`wrote 0, skipped 1`. Its three outputs under `.claude/skills/scan-sweep/` are git-tracked and
projected from `src-tauri/src/commands/infrastructure/scan_agents.toml`; a change to the TOML updates
nothing, and no amount of registration would help, because the default mode is "leave it alone".
**Staleness here is not undetected — it is structurally unreachable.**

### D. Chained and consumed artifacts — 3

**D1 — `docs/concepts/shared-facts.json`, the corpus's own shared-facts file, is stale.** Committed
`measuredAt: 2026-08-15 / commit 1e714f817`; re-running `measure-shared-facts.mjs` gives
`2026-08-16 / f432a4ef3` and **`tsFiles` / `filesLinted` 4828 → 4829**. Its own note reads:
*"Golden-path composers MUST cite these rather than re-deriving: wave 1 produced four different
command counts, three of which seeded floor assertions."* Several published paths already cite
**4,829** — the fresh number — so the file the corpus was told to trust is behind the documents that
trust it. The generator is registered in nothing.

**D2 — `.claude/codebase-context.md` regenerates to 7× its committed size, because its input changed
tools.** `render-codebase-context.mjs` is a deterministic projection of `context-map.json`, written to
end a drift between two generators of the same data (*"at one point the JSON reported 8 groups and the
markdown 9"*). It succeeded at that and inherited a worse problem: `.claude/CLAUDE.md` records that
`context-map.json` is currently **Vibeman's** 236-context artifact while the app writes its own
49-context file to the same path on every scan. Re-rendering today produces **448,823 bytes against
64,787 committed**. The projection is correct; its input belongs to a different tool on a different
trigger. **This is P7's warrant and the reason step 8 exists.**

**D3 — `docs/refactor/catalog-curation.md` is stale by 11 KB, and the `--check` flag on its own
generator checks something else.** Committed 13,006 bytes; fresh **1,972** — the Phase-1 relocation
happened and the move-manifest is now nearly empty, so the committed file describes work that is
done. `npm run check:catalog-boundary` runs `classify-shared.mjs --check`, which is a **boundary lint
over `shared/components/`** (it exits **1** today with 3 offenders under
`modals/ExecutionDetailModal/`) and never compares the artifact to fresh output. A flag named
`--check` on the generator, pointing at a different condition than the file the generator writes, is
[the contract's fifth failure mode](../golden-path-contract.md) — the gate that points at a broken
destination — one layer further out.

### E. Cleared claims — recorded because a cleared claim is worth as much as a confirmed one

- **"Registered generators drift too."** They do not, here. **All 1,617 artifacts of the 14 registered
  generators are byte-fresh**, including the 793 section locales, the 292 KB `builtin_connectors.rs`,
  the 168 KB `builtin_shared_events.rs`, both template-checksum manifests, and both i18n generated
  files. `predev`/`prebuild` running on every `npm run dev` is doing the entire job.
- **"12 of 12 generators write in place."** The direction is right and the denominator was low: **19**
  generators, **15** of which stamp a provenance header into their own output, and `renameSync` is
  still **0** across 150 tooling files. Two now compare before writing (one of them uselessly), which
  the earlier count did not distinguish.
- **"`run-codegen.mjs:150` exits 1 on a task timeout and npm aborts."** Confirmed verbatim —
  `SIGKILL` at `:98`, `Promise.allSettled` at `:129`, `process.exit(failed === 0 ? 0 : 1)` at `:150`.
  The build does notice.
- **"`git diff --quiet` exits 0 for an untracked file, so a NEW binding is the case the gate cannot
  see."** **Fixed on 2026-08-14**, before this composition. `ci.yml:426-431` adds
  `git ls-files --others --exclude-standard src/lib/bindings/` with the verification written into the
  comment. The blind spot that survives is the *opposite* one — the orphan (§7 B1) — and it is
  unfixable by any diff.
- **A hypothesis I tested and could not support.** I expected the presence of a
  `writeIfChanged`-style compare to predict freshness. It does not: of the four generators that carry
  one, one (`split-locales`) has a dead guard and is fresh, one (`generate-connector-seed`) has a live
  guard and is fresh, one (`gen-shared-catalog`) has `--check` and is fresh, and one
  (`classify-shared`) has `--check` and is **stale**. **Registration predicts freshness at 14/14 vs
  1/4; the guard predicts nothing**, which is why §0's finding is about the registry and not about the
  generator's internals.

---

## 8. Gaps in the primitive

1. **`TASKS` maps a name to a script and nothing to an artifact.** No consumer of the registry can
   answer "what does this task write", so nothing can join a task to a drift check, and nothing can
   notice a generator that writes a committed file and appears in no preset. Every relational gate in
   §9 dies here. Adding an `outputs: [...]` field per task is a one-line-per-task change that would
   make the whole §9 refusal unnecessary.
2. **The census engine cannot join a generator to its output, or a task to a hook.** `scanRule`
   matches one regex against one file's content with no cross-file state — the same wall
   [compile-time-env-embedding §9.3](./compile-time-env-embedding.md) hit and
   [client-rule-mirroring Gap 5](./client-rule-mirroring.md) hit. Registration is a *relation*, and
   its absence is an *absence*, which the census cannot assert in either direction (doctrine §4).
3. **`git diff` cannot see an orphan.** The only mechanism in the repo for asserting the bindings tree
   is a diff, and an artifact whose source has been deleted produces no diff. Detecting it needs an
   *inventory* of what should exist, derived from the Rust side — a different program.
4. **Node's `fs` has no atomic directory replace on Windows.** `renameSync` over an existing
   *directory* fails with `EPERM`/`ENOTEMPTY`; the correct sequence is rename-old-aside,
   rename-new-in, delete-old, which is three syscalls and a recovery path. That is why C1 is a real
   engineering task and not a three-line fix, and it is the reason `split-locales.mjs` already carries
   a six-attempt EBUSY retry loop at `:31-46`.
5. **`ci.yml` cannot host the assertion.** The one job that regenerates a large artifact family needs
   45 minutes, a full cargo build, 12 apt packages and a keychain hatch, and is 5/20 green by its own
   comment. Any freshness assertion cheap enough to be trusted must not require a build — which is
   exactly what a `--check` mode plus a Vitest case gives you.
6. **A `--check` mode cannot detect a *deleted* output.** It compares what the generator would write
   against what is committed; an artifact the generator no longer produces is outside its domain, and
   so is a directory the last run emptied. Only a manifest of expected outputs closes that.

---

## 9. The missing gate

### The semantic conditions, stated first

Two, both stack-free:

> **(A)** A committed artifact declares itself a machine projection, and the repository provides no
> way to ask whether it still is.
> **(B)** A generator that writes a committed artifact is not reachable from any step the build is
> obliged to run.

What follows is **one repo's proxy for (A)**, an explicit **refusal for (B)** with the numbers that
force it, and the instrument (B) actually needs. Per the
[portability test](../research/portability-test.md) a proxy does not travel: an adopting repo
inherits the two sentences and re-derives its own signal.

### Rules checked first, and why none of the 146 covers this

`scripts/census/rules.json` holds **146** rules. Only **three** touch `scripts/` at all, and I ran my
candidate against **every baselined rule in the registry**:

| neighbour rule | roots | shared files with my 10 | % of mine |
|---|---|---:|---:|
| `machine-specific-path-in-tooling` | `scripts`, `.ai` | **0** | **0 %** |
| `pinned-harness-endpoint` | `tools`, `tests`, `scripts`, `uat` | **0** | **0 %** |
| `env-default-conflates-unset-with-empty` | `src`, `scripts` | **0** | **0 %** |
| `config-value-frozen-at-compile-time` ([compile-time-env-embedding](./compile-time-env-embedding.md)) | `src-tauri` | **0** | 0 % — different lane entirely |
| `comment-kept-cross-language-mirror` ([client-rule-mirroring](./client-rule-mirroring.md)) | `src` | **0** | 0 % — it owns a hand-kept copy that *admits* it; I own a machine-written one |
| **every other baselined rule (141)** | — | **0** | **0 %** |

**Zero overlap with all 146.** This is the registry's first rule in the codegen lane.

### 1. Census rule — `unverifiable-generated-artifact`

Published as fenced JSON for the orchestrator to merge; **`scripts/census/rules.json` was not
edited**, per the contract's concurrent-writer warning.

```json
{"rules":[
  {
    "id": "unverifiable-generated-artifact",
    "goldenPath": "docs/concepts/golden-paths/codegen-task-registration.md",
    "title": "A generator stamps DO-NOT-EDIT provenance into a committed artifact but offers no way to ask whether the committed copy still matches, so the promise in the header is the only thing holding it",
    "roots": ["scripts"],
    "extensions": [".mjs", ".js", ".cjs"],
    "signal": {
      "pattern": "^(?![\\s\\S]*(?:['\"]--check['\"]|writeIfChanged|===\\s*output|existing\\s*===|--check\\b))[\\s\\S]*?(?:AUTO-GENERATED|Auto-generated|GENERATED by|GENERATED FILE|DO NOT EDIT|Do not edit|do not edit)",
      "flags": "g",
      "ignoreCommentLines": false,
      "description": "A build-tooling script that WRITES a DO-NOT-EDIT provenance banner into a file it generates, and that contains no way to ask whether the committed copy of that file is still current -- no `--check` mode, no compare-before-write. PROXY FOR the stack-free condition: 'a committed artifact declares itself a machine projection, and the repository provides no way to ask whether it still is.' THE DISCRIMINATOR IS IN THE PATTERN, NOT IN THE EXCLUDE LIST: a file-anchored negative lookahead for a verification affordance, followed by the header emission. It PARTITIONS the anchor exactly -- 15 scripts under scripts/ emit such a header, 11 have no verification affordance (this rule, minus one exclusion) and 4 do (the positive control), 11 + 4 = 15 with no remainder. MEASURED BY EXECUTION 2026-08-17, not by reading: all 19 generators in this repo were run under a filesystem harness that captures every writeFileSync/writeFile/mkdirSync/rmSync in memory and diffs the intended bytes against the committed artifact (git status confirmed the repo was never written to). Result: all 1,617 committed artifacts of the 14 generators registered in scripts/run-codegen.mjs's TASKS are BYTE-FRESH, and 4 of the 5 generators registered in nothing produce artifacts that are STALE RIGHT NOW -- scripts/docs/gen-tour-anchors.mjs is 127 anchors behind the React tree (945 committed testids vs 1,044 in the tree, 269 dynamic prefixes vs 293, 4 dead entries) while its TWO artifacts remain perfectly consistent WITH EACH OTHER (json-only 0, rust-only 0), which is the trap: codegen guarantees the mirrors agree with each other, not that either agrees with reality. The stale allow-list is enforced at src-tauri/src/companion/tours.rs:98 AND spliced into the tour-composition prompt at tours.rs:331, so a model is told the 127 newer anchors do not exist and then rejected for not using them. Also stale today: docs/concepts/shared-facts.json (the golden-path corpus's own shared-facts file), .claude/codebase-context.md (regenerates to 448,823 bytes against 64,787 committed, because its input context-map.json is now written by a different tool on a different trigger), and docs/refactor/catalog-curation.md. LEGAL FIXES, all present in this repo: give the generator a --check mode that compares its in-memory output against the committed file and exits 1 with the regen command (scripts/docs/gen-shared-catalog.mjs:183-193, the ONE generator that has one, and it is fresh); compare before writing (scripts/generate-connector-seed.mjs:95-102, which already does the comparison and spends the answer on skipping a Rust rebuild); or generate into a destination git does not track, which deletes the whole condition (scripts/sync-system-skills.mjs writes the gitignored src-tauri/resources/skills). Then pin the comparison in the TEST SUITE rather than a workflow step -- the working precedent is brainiac's crates/brainiac-server/src/openapi.rs:425 fn committed_document_is_current, an EOL-insensitive unit test asserting the committed openapi.json equals what the handlers declare, with the regeneration command in the assertion message; this repo's equivalent is .github/workflows/ci.yml:419-437, which its own comment at :355 records as 'binding-drift is 5/20 green'. NOTE ignoreCommentLines is deliberately false: the match is file-anchored so it starts at offset 0, and none of the 10 matching files currently has a comment-only first line -- flipping the flag changes nothing TODAY (executed: exit 0, counts unchanged) but would silently drop any future generator whose first line is a `//` comment. PRECONDITION (must be re-derived per repo): this proxy keys on the generator EMITTING a provenance banner, which is a property of the author's habit, not of the pipeline. A repo whose generated artifacts carry no banner scores ZERO while the condition is present -- measured across five sibling repos on 2026-08-17: personas-web has exactly one committed generated artifact whose generator is named in only two git-tracked files (itself and its own output's header) and is run by nothing, and brainiac's openapi.json is the fleet's ONLY correctly-verified generated artifact and carries NO banner at all, so it would score zero here while being the thing to copy."
    },
    "exclude": [
      {
        "path": "scripts/generate-command-names.mjs",
        "reason": "the ONE generator in this repo whose artifact is verified, and firing on the exemplar is worse than not firing: scripts/check-command-contract.mjs:231-250 extracts the union from commandNames.generated.ts and the handler list from src-tauri/src/lib.rs and reports missing/stale per name, inside `npm run check:contracts` which is inside `npm run check`; .github/workflows/ci.yml:334-341 additionally regenerates then `git diff --quiet`s it. The verification lives OUTSIDE the generator, which is precisely why an in-file signal cannot see it -- stated here so the exemption is understood as a limit of the proxy and not as an exemption on the merits"
      }
    ],
    "baseline": { "files": 10, "matches": 10 },
    "floor": 120
  },
  {
    "id": "verifiable-generated-artifact-positive-control",
    "goldenPath": "docs/concepts/golden-paths/codegen-task-registration.md",
    "title": "POSITIVE CONTROL - not a rule; the SAME anchor (a generator emitting DO-NOT-EDIT provenance into its own output) pointed at the COMPLIANT form, where the same file can also be asked whether the committed copy is current",
    "roots": ["scripts"],
    "extensions": [".mjs", ".js", ".cjs"],
    "signal": {
      "pattern": "^(?=[\\s\\S]*(?:['\"]--check['\"]|writeIfChanged|===\\s*output|existing\\s*===|--check\\b))[\\s\\S]*?(?:AUTO-GENERATED|Auto-generated|GENERATED by|GENERATED FILE|DO NOT EDIT|Do not edit|do not edit)",
      "flags": "g",
      "ignoreCommentLines": false,
      "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Byte-for-byte the same machinery as unverifiable-generated-artifact -- the same file-anchored lookahead over the same verification-affordance alternation, the same lazy gap, the same header alternation -- with the lookahead INVERTED from negative to positive. The two differ in exactly one character, and that character is the whole discriminator: whether the script that stamps DO-NOT-EDIT into a file can also be asked whether the committed copy is current. It PARTITIONS the anchor rather than reporting a ratio: over the same 150-file walk, 15 scripts emit such a header, this control claims 4 (scripts/docs/gen-shared-catalog.mjs and scripts/refactor/classify-shared.mjs via --check, scripts/generate-connector-seed.mjs via `existing === output`, scripts/i18n/split-locales.mjs via writeIfChanged) and the rule claims the other 11, one of which is excluded. A matcher that drifted into counting every script would show up here as the two populations converging on 150; an anchor that rotted would show up here as zero over the same walk. TWO HONEST LIMITS, stated rather than tuned away. (1) Two of these four are compliant only in shape: split-locales.mjs's writeIfChanged is DEAD BY CONSTRUCTION because line 56 rmSync's the output directory before the loop, so existsSync is false for all 793 of its writes; and classify-shared.mjs's --check is a BOUNDARY LINT over shared/components/ (exit 1 today, 3 offenders) that never compares the artifact it writes, which is stale by 11 KB. The control measures the affordance, not its correctness -- which is the same limit every positive control has and the reason a control is a liveness probe and not a verdict. (2) The control cannot detect a collapsed partition: replacing its pattern with the rule's leaves it at exit 0 with 21 files (executed). A baseline-free control fails only structurally, so the exhaustiveness of the partition (11 + 4 = 15, no remainder) is asserted in the golden path and cannot be re-asserted by the runner. It must never be given a baseline."
    },
    "floor": 120
  }
]}
```

**Counts verified through two independent implementations, and hand-verified anyway.**
Implementation A is the content regex the engine runs. Implementation B is a separate walk that
classifies each `scripts/` file by (i) whether it contains a `writeFileSync`/`writeFile` at all, (ii)
whether it emits a provenance header, (iii) whether it contains a verification affordance — assembled
independently, not sharing the regex. **They agree: 15 header-emitting generators, 11 without a
verification affordance, 4 with one.** All 15 were then opened at the matching line: every single one
is a header being written **into the generator's own output** — `gen-tour-anchors.mjs:116` (the JSON
`$comment`) and `:128` (the Rust banner), `generate-template-checksums.mjs:158` and `:179-180` (the
TS and Rust manifests), `i18n/gen-types.mjs:46`, `generate-agent-icon-sprites.mjs:58`,
`context/render-codebase-context.mjs:77`, `generate-cli-bridge.mjs:238`, and the rest. **Precision
15/15 on the anchor, 10/10 on the rule after the one exclusion.**

**The false negative I chose to keep.** `scripts/skills/scan-agents-to-skills.mjs` writes three
git-tracked files and does **not** stamp a header, so it scores zero here while being §7 C3 — a
generator that refuses to update its own artifact at all. Widening the anchor to "writes into
`.claude/` or `src/`" costs the precision that makes this rule worth having. It stays a ticket.

**Validation — standalone in a private scratch registry, then re-extracted from this document and
re-run.** Filename unique to this composition per the shared-scratchpad collision incident:
`census-ctr-9b2e.json`. **The full registry was NOT run**, per the doctrine.

```
node scripts/census/run-census.mjs --rules <scratch>/census-ctr-9b2e.json --check

  rule                                              files  base  matches  base  walked  floor
  OK  unverifiable-generated-artifact                  10    10       10    10     150    120
  OK  verifiable-generated-artifact-positive-control    4     —        4     —     150    120

  census OK — 2 rule(s), 300 file-visits, 14 surviving violation(s) across 14 file(s).
```

Exit 0, byte-identical on repeat, and identical again when the JSON block above was extracted from
this document and re-run. Whole run **≈ 0.2 s** for both rules. The `^` anchor without the `m` flag
matches at most once per file, and the lookahead is therefore evaluated exactly once per file, so
neither pattern can backtrack across a file; no lookbehind is used.

**Fault injection against the real tree.** A gate that cannot fail is not a gate.

| Induced fault | Exit | Reported as |
|---|:---:|---|
| unmutated | **0** | surviving counts printed |
| rule matcher matches nothing | **1** | `[structural] matched zero files anywhere` |
| floor above the walk (`9000`) | **1** | `walked 150 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| renamed root (`scripts-x`) | **1** | `walked 0 files but floor is 120` |
| `extensions` → `.svelte` | **1** | `walked 0 files but floor is 120` |
| count rises (baseline files 7) | **1** | `[drift] files rose 7 -> 10 (+3)` |
| silent drop (baseline matches 40) | **1** | `matches dropped 40 -> 10 (-30) without the baseline moving` |
| stale `exclude` | **1** | `exclude "…" matched no file. The exemption is stale` |
| unexplained `exclude` (3-char reason) | **1** | shape validation |
| missing `goldenPath` | **1** | shape validation |
| invalid regex | **1** | shape validation |
| `ignoreCommentLines` turned ON | **0** | *unchanged — see below* |
| **control** given a `baseline` | **1** | `a positive control must NOT carry a baseline` |
| **control** anchor rots | **1** | `matched zero files anywhere` |
| **control** root renamed | **1** | `walked 0 files but floor is 120` |
| **control** given the rule's own pattern | **0** | *unchanged — see below* |

**Sixteen mutations, thirteen failures, and the two that do NOT fail are reported rather than hidden.**
(i) Flipping `ignoreCommentLines` is inert **today** because the match begins at offset 0 and none of
the 10 matching files has a comment-only first line — unlike
[`comment-kept-cross-language-mirror`](./client-rule-mirroring.md), where the same flip zeroes the
rule. It is pinned to `false` for the future case, not for the present one. (ii) A baseline-free
control fails only structurally, so swapping the rule's pattern into it produces a green 21-file run;
the exhaustiveness of the partition (11 + 4 = 15, no remainder) is a claim this document makes and the
runner cannot re-check. No `exclude` beyond the one named: there is no other file that must
legitimately contain this shape.

**What this rule does and does not buy.** It is a ratchet that stops a 12th generator shipping a
committed artifact nobody can verify. It does **not** detect staleness, it does **not** detect a
missing registration, and it would **not** have found `gen-tour-anchors.mjs` any faster than reading
`run-codegen.mjs` would. Its value is that it makes the *next* one visible at authoring time. When
`--check` lands on all 11, the honest move is to **delete this rule** rather than baseline it at 0 —
the census cannot express "must be zero" and says so itself.

### 2. REFUSED as a census rule — condition (B), the unregistered generator. The numbers that force it.

This is the condition the leaf is named after and the one I most wanted to gate. It is refused on
three independent grounds, any one of which is sufficient:

- **It is a relation.** It joins a file under `scripts/` to a key in an object literal in
  `scripts/run-codegen.mjs` to an array in the same file. `scanRule` matches one regex against one
  file's content with no cross-file state (Gap 2).
- **It is an absence.** "Nothing runs this" cannot be counted; the census ratchets things that are
  present (doctrine §4).
- **The candidate signal fails on precision anyway.** The nearest single-file proxy is "a `scripts/`
  file declaring an output constant that resolves under `src/` or `src-tauri/`" — measured at **26
  files / 48 matches**, of which **12 of 26 are checkers that only READ those paths**
  (`check-command-contract.mjs`, `check-event-registry.mjs`, `check-csp-hosts.mjs`,
  `i18n/check-coverage.mjs`, `i18n/check-route-sections.mjs`, `i18n/find-unused-i18n-keys.mjs`,
  `i18n/check-error-registry-parity.mjs`, …) and one is a version bumper. **~54 % precision.** A gate
  that fires on correct content is worse than no gate.

**Specify instead `scripts/check-codegen-registration.mjs` (~70 lines), wired into `npm run check:contracts`**
so it needs no cargo and no vite build. It is smaller than the checker
[compile-time-env-embedding §9.3](./compile-time-env-embedding.md) specified because **Gap 1's fix
makes it trivial**: add an `outputs: [...]` array beside each task in `TASKS`, then

- **Read the registry as structure.** Parse `TASKS` and both `PRESETS` (static literals by deliberate
  design — the file says so at `:19-21`).
- **Assert four things.** (a) Every `scripts/**` file that writes to a **git-tracked** path under
  `src/`, `src-tauri/`, `docs/` or `.claude/` is a value in `TASKS` **or** carries an allowlist entry
  with a `reason`. (b) Every task appears in **both** presets or carries a reason (`checksums` is
  prebuild-only, `host-check` predev-only — both deliberate). (c) Every `beforeDevCommand` /
  `beforeBuildCommand` in the four `tauri.*.conf.json` files resolves to an npm script with a
  `pre`-hook that reaches `run-codegen.mjs` — **this alone catches §7 A3.** (d) Every declared
  `outputs` path exists and is git-tracked, so a renamed destination is a loud failure rather than a
  silently orphaned artifact.
- **Fail loudly if its own precondition is absent.** Assert the parse found **≥ 12 tasks, ≥ 2 presets,
  ≥ 4 tauri configs, and ≥ 14 writing scripts** before asserting anything about them (measured today:
  14 / 2 / 4 / 19). Print the audited totals on success — `codegen registration OK (14 tasks, 13+13
  presets, 4 build profiles, 19 generators, 5 allowlisted)` — so a green log distinguishes a clean run
  from an empty one.

**Its first run fails on 5 generators and 1 build profile**, which is the correct outcome and the
reason to build it.

### 3. Specified, not refused — the freshness test, which belongs in Vitest

Condition (A) is *detectable* by the rule above and *fixable* only by an assertion. Per P4 and the
convergence result, the assertion belongs in the test suite:

```ts
// src/lib/__tests__/generatedArtifacts.test.ts — sketch
for (const [task, script] of Object.entries(TASKS_WITH_CHECK)) {
  it(`${task}: committed artifact is current`, () => {
    const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
}
```

Three properties that matter, all of them reasons to prefer this over a CI job: it runs on
`npm run test` on the developer's machine and in every fork; it needs no cargo, no vite and no apt
packages; and its precondition is self-asserting — a suite that iterates an empty `TASKS_WITH_CHECK`
should `expect(entries.length).toBeGreaterThan(9)` so a parser that stopped resolving tasks fails
instead of reporting a clean bill of health. The bindings tree is the one family this cannot cover
without a build, and it is the one that already has a CI job; everything else is cheap.

### On severity

Nothing here is proposed as an ESLint rule, so the severity question does not arise — and it must not
be argued from warning volume in either direction. The count-independent argument is the only one that
holds: `npm run check` runs `eslint src/` with **no `--max-warnings`**, and the pre-commit hook runs
`--quiet --max-warnings 99999`, where `--quiet` discards warnings before they can be counted. **A
warn-level rule enforces nothing at either gate, at any count.** The census is a different mechanism:
`census:check` exits 1 on drift, is a step of `npm run check`, **and is a pre-push job**
(`lefthook.yml`, `golden-path-census`), so it runs on the developer's machine — which per the §9
calibration is the only place that matters while `ci.yml` is red on pre-existing failures.

---

## Every committed generated artifact, with a verdict

**1,861 committed generated artifacts.** Verdicts are from executing the generator into memory and
diffing against the committed bytes, 2026-08-17 @ `f432a4ef3`.

| Artifact(s) | Generator | Registered in | Verdict |
|---|---|---|---|
| `src/lib/commandNames.generated.ts` | `generate-command-names.mjs` | `TASKS`, both presets · `ci.yml:334` · `check-command-contract.mjs` | **FRESH** |
| `src/lib/commandNames.overrides.ts` | same | same | **FRESH** (`No stale overrides found`) |
| `src/i18n/generated/types.ts` | `i18n/gen-types.mjs` | `TASKS`, both presets | **FRESH** |
| `src/i18n/generated/enSectionStrings.ts` | `i18n/split-locales.mjs` | `TASKS`, both presets | **FRESH** |
| `src/i18n/section-locales/**/*.json` — **793 files** | `i18n/split-locales.mjs` | `TASKS`, both presets | **FRESH — all 793** |
| `src-tauri/db/src/builtin_connectors.rs` (292 KB) | `generate-connector-seed.mjs` | `TASKS`, both presets | **FRESH** |
| `src-tauri/db/src/builtin_shared_events.rs` (168 KB) | `events/generate-connector-events.mjs` | `TASKS`, both presets | **FRESH** |
| `scripts/events/connector-docs.manifest.json` | same | same | **FRESH** |
| `scripts/events/connector-events.ledger.json` | same | same | **FRESH** (unchanged; ledger preserved) |
| `src/lib/personas/templates/templateChecksums.ts` | `generate-template-checksums.mjs` | `TASKS`, **prebuild only** | **FRESH** |
| `src-tauri/engine/src/template_checksums.rs` | same | same | **FRESH** |
| `src/lib/n8nLimits.generated.ts` | `generate-n8n-limits.mjs` | `TASKS`, both presets | **FRESH** |
| `src/lib/icons/agentIconSprite.generated.ts` | `generate-agent-icon-sprites.mjs` | `TASKS`, both presets | **FRESH** |
| `src/features/shared/components/CATALOG.md` | `docs/gen-shared-catalog.mjs` | `TASKS`, both presets · `check:catalog` | **FRESH** |
| `src/features/plugins/dev-tools/constants/scanMatchRules.gen.ts` | `skills/gen-scan-match-rules.mjs` | `TASKS`, both presets | **FRESH** |
| `src-tauri/src/companion/generated_anchors.rs` | `generate-guidance-anchors.mjs` | `TASKS`, both presets | **FRESH** |
| `src-tauri/resources/skills/**` | `sync-system-skills.mjs` | `TASKS`, both presets · `npm run build` | **n/a — gitignored by design** |
| **`src-tauri/src/companion/generated_tour_anchors.rs`** | `docs/gen-tour-anchors.mjs` | **nothing** | **STALE — 127 anchors behind, 4 dead** |
| **`src/features/onboarding/anchors/tourAnchorManifest.json`** | same | **nothing** | **STALE — same 127 / 4** |
| **`docs/concepts/shared-facts.json`** | `docs/measure-shared-facts.mjs` | **nothing** | **STALE — `tsFiles` 4828 vs 4829** |
| **`.claude/codebase-context.md`** | `context/render-codebase-context.mjs` | **nothing** | **STALE — 64,787 vs 448,823 bytes** |
| **`docs/refactor/catalog-curation.md`** | `refactor/classify-shared.mjs` | `package.json` only | **STALE — 13,006 vs 1,972 bytes** |
| `.claude/skills/scan-sweep/{SKILL.md, references/lenses.md, scripts/coverage.mjs}` | `skills/scan-agents-to-skills.mjs` | **nothing** | **UNMEASURABLE — generator skips existing outputs unless `--force`** |
| `src/lib/bindings/**` — **1,032 files** | ts-rs via `cargo test --workspace --features desktop export_bindings` | `ci.yml:419` (5/20 green) · `check-unused-bindings.sh` (exit **1**, 98 findings) | **UNMEASURABLE without cargo.** Measured statically: **29 orphans** (source gone; 26 still imported, 22 live IPC return types) · **5** formatter-stripped and guaranteed to re-drift · 1 live working-tree drift |
| 13 glyph modules (`archetypeGlyphData.ts`, `pulseGlyphData.ts`, `*Glyph.ts`, …) | `.claude/skills/motionize/tools/{trace-set,emit-glyph}.mjs` — a shared ai-registry skill, absent from `git ls-files` | `check:glyphs` (in `npm run check`) | **STILL UNMEASURABLE against source — but no longer unpinned.** Fixed 2026-08-28 |

**Totals: 1,829 measurable · 1,823 FRESH · 6 STALE · 32 unmeasurable (of which 1,032 have a CI-only
check that is 5/20 green).**

> **The glyph row, resolved 2026-08-28 — and it is the one case where none of this
> leaf's three legal fixes applies.** `--check` mode, compare-before-write, and
> generate-somewhere-git-does-not-track all assume the generator is reachable from the
> repo that ships the artifact. `motionize` is a *linked* registry skill: there is no
> `.claude/skills/motionize` in `git ls-files`, and the traced source art was never
> committed either, so no incantation in this checkout can re-derive a single one of
> the 13. The banner nevertheless said `AUTO-GENERATED … do not edit by hand`, which
> reads as a promise that `npm run build` maintains them — and 318KB of it sat on 12
> lines of `archetypeGlyphData.ts`, the exact geometry a reviewer's eye slides off.
>
> What was left to preserve is not freshness but *integrity*: a hand edit, a truncated
> write, or a half-finished re-trace must not be silently absorbed. `scripts/check-vendored-glyphs.mjs`
> pins a `sha256` per artifact in `scripts/vendored-glyph-manifest.json` and fails on a
> changed hash, an unpinned artifact, or a pinned artifact that has vanished. All three
> directions were fault-injected before adoption (exit 1 each); a walk that visits fewer
> than 500 `.ts` files, or that matches zero artifacts, exits **2** as a broken matcher
> rather than 0 as a clean repo — the fail-loud contract this leaf shares with
> `check-corpus-integrity.mjs`. The 13 banners were rewritten to say what is true:
> vendored, un-re-derivable, committed bytes ARE the source.
>
> Note what this does NOT buy, stated rather than papered over: the manifest can only
> tell you the bytes have not moved since someone said they were right. It cannot tell
> you they ever matched the art. That question is unanswerable from this repo and
> stays open.

---

## Convergence — one clause is physics, one is Personas alone, and one repo has the answer

Read-only sweep, 2026-08-17, of `../personas-web` (Next.js App Router), `../brainiac` (Rust workspace
+ Next.js console), `../personas-cloud` (Node orchestrator + FastAPI facade), `../vibeman` (Tauri +
Next.js), `../ascent` (Next.js on Vercel). All five exist and all five were opened. Per the doctrine's
lineage rule, `personas-cloud` contains a **port** of this repo's code and is not counted as a second
opinion — it also has **zero** committed generated artifacts and **zero** generator scripts, so it
contributes nothing to this leaf in either direction. Cohort: **4 independent siblings.**

| | **personas** | personas-web | brainiac | vibeman | ascent |
|---|---|---|---|---|---|
| committed generated artifacts | **1,861** | **1** | **2** | **0** | **0** |
| a registry declaring which generators run on which hook | **YES** — `TASKS` + `PRESETS`, 14/13/13, no auto-discovery, by policy | no | no | no | no |
| any `pre`/`post` npm hook at all | `predev`, `prebuild`, `pretauri:*`, `postinstall` | `prepare` (installs a pre-push hook) | n/a | **none** | `postinstall: prisma generate` |
| generators wired into nothing | **5 of 19** | **1 of 1** | 1 of 2 (the second hop) | n/a | **0 of 1** |
| a freshness assertion on a committed artifact | 3 (1 local, 2 CI-only, one 5/20 green) | **0** | **1 — and it is a unit test** | n/a | n/a |
| atomic write in the generator lane | **0** | 0 | n/a | n/a | n/a |
| structural answer: artifact not committed | 1 of 19 (`resources/skills`) | no | no | n/a | **yes, for its whole ORM surface** |

**Physics — reinvented independently, so these clauses travel.**

- **"A generator writes a committed artifact and nothing runs it." 3 of 4 independent siblings have
  the condition; the one that does not has zero committed artifacts to have it with.**
  `personas-web/src/lib/review-voice-data.ts` carries
  *"AUTO-GENERATED by scripts/generate-voice-data.mjs — do not edit by hand"* and the generator's name
  appears in exactly **two git-tracked files: itself and its own output's header.** It is not in
  `package.json`, not in the pre-push hook that `scripts/install-git-hooks.mjs` writes (which runs two
  i18n checks and nothing else), and not in `.github/workflows/ci.yml`. **1 of 1 artifacts
  unregistered.** `brainiac` has the same defect on the second hop of a two-hop chain: hop 1
  (`openapi.json`) is verified by a unit test, and hop 2 (`console/src/lib/api-schema.d.ts`, generated
  by `console/package.json:gen:api` from that JSON, and **committed**) is verified by a **sentence in
  hop 1's failure message**: *"and re-run `npm run gen:api` in console/"*. **A prose instruction is
  the mechanism for the second half of the only verified pipeline in the fleet.**
- **"The `DO NOT EDIT` banner does not predict freshness." Confirmed from both directions across the
  fleet.** Here the banner is on 15 generators' outputs, on the fresh ones and the 127-stale one
  alike. In `brainiac` the **one correctly-verified artifact carries no banner at all** —
  `openapi.json` is a bare JSON spec. **The signal and the mechanism are uncorrelated, and the repo
  with the best mechanism has the worst signal.** This is P3's warrant and it is also this leaf's §9
  `PRECONDITION`: my proxy would score `brainiac` at zero.

**The one practice worth importing, and the brief was right to name it rather than have me re-find
it.** `brainiac/crates/brainiac-server/src/openapi.rs:425`:

```rust
/// The committed `openapi.json` (which the console generates its types from) must match what the
/// handlers actually declare. If this fails, someone changed a response shape without running
/// `brainiac openapi --out openapi.json` — regenerate and commit the diff.
#[test]
fn committed_document_is_current() {
    let Ok(committed) = std::fs::read_to_string(&path) else {
        panic!("openapi.json is missing — run `cargo run -p brainiac-server -- openapi`");
    };
    let current = ApiDoc::openapi().to_pretty_json().expect("serialize spec") + "\n";
    // EOL-insensitive: git autocrlf may smudge the working copy to CRLF on Windows;
    // the contract is the content, not the line endings.
    assert_eq!(committed.replace("\r\n", "\n"), current, "openapi.json is stale — regenerate with …");
}
```

Four things to steal, and I add the fourth because it is the one a Personas port would get wrong:
(1) it is a **test**, so it runs locally, in every fork, and cannot be skipped by a `continue-on-error`
or an sccache outage; (2) the failure message carries the regeneration command; (3) the missing-file
case `panic!`s with a *different* message, so "stale" and "never generated" are distinguishable;
(4) **it is EOL-insensitive on purpose** — on this repo's platform `git` will smudge working copies to
CRLF, and a naive byte comparison would fail for a reason that has nothing to do with drift. Personas
has **1,861** committed artifacts and **zero** assertions of this shape.

**The second practice worth importing, and it is the stronger one.** `ascent` has **zero committed
generated artifacts** — not because it generates nothing, but because its one generator
(`prisma generate`, its entire ORM surface) writes into `node_modules` and runs on `postinstall`. The
condition this leaf describes cannot arise there. Personas reaches the same state for exactly one
artifact (`sync-system-skills.mjs` → the gitignored `src-tauri/resources/skills`), and that artifact
is the only one in the repo whose freshness is guaranteed by construction. **Two of four independent
siblings arrive at "don't commit it" as the answer**, which is why it is P2 and step 1 rather than a
footnote.

**Personas is ahead on exactly one thing, and it is the thing this leaf is named after.**
`scripts/run-codegen.mjs`'s `TASKS` + `PRESETS` — a flat, explicit, commented, reviewable declaration
of which generators run on which hook, with a written policy against auto-discovery — **exists in no
other repo in the fleet.** `vibeman` has no `pre`/`post` npm hook of any kind. `personas-web` has one
generator and no registry. `brainiac` invokes its generator as a cargo subcommand and its second hop
as an npm script, with no place that lists either. And the measurement in §0 says the registry is
doing the entire job: **14 registered generators, 1,617 artifacts, zero drift.** The registry works.
Five generators are simply not in it.

**Local calibration — no trace anywhere else.** The two-artifact-per-generator pattern
(`gen-tour-anchors.mjs` emitting a JSON *and* a `.rs` from one scan) and the 793-file split-locale
tree are Personas-specific shapes; §9's proxy is calibrated to them and says so.

**One correction offered upward to a sibling, not applied.** `brainiac`'s
`console/src/lib/api-schema.d.ts` is committed, generated from `openapi.json` by
`console/package.json:gen:api`, and asserted by nothing — the freshest possible `openapi.json` does
not make it current. The fix is the same shape as the check that already exists one hop upstream, and
a `console/` test could run `openapi-typescript` into a temp file and diff. Per the runbook, findings
about sibling repos are reported and never edited.

---

## 12. Corrections to the brief

**12.1 — `run-codegen.mjs` has 14 tasks, not 13, and not 8. Both neighbours are off, in opposite
directions, and the reason is instructive.** `TASKS` at `:22-68` has **14** keys; each `PRESET` has
**13** (`predev` omits `checksums`, `prebuild` omits `host-check`).
[compile-time-env-embedding](./compile-time-env-embedding.md) says *"13 codegen tasks"* — that is a
preset's length read as the registry's. [client-rule-mirroring](./client-rule-mirroring.md) says
*"`scripts/run-codegen.mjs` (8 registered tasks)"* — that number was correct in May 2026 and six tasks
have been added since. **The registry and the presets are different sets and the difference is
deliberate**; a composer who reads either number as "how many generators run" will conclude the wrong
thing about which hook covers what. Both are cited in published `§9` rule descriptions.

**12.2 — "the CI drift job `git diff --quiet` exits 0 for an untracked file, so a NEW binding is
exactly the case the gate cannot see" was true and is FIXED.** `.github/workflows/ci.yml:421-431` now
runs `git ls-files --others --exclude-standard src/lib/bindings/` before the diff and fails on any
untracked output, with the verification date in the comment (*"verified 2026-08-14 by creating one"*).
The brief, `.claude/CLAUDE.md`, and `compile-time-env-embedding` all still carry the pre-fix claim.
**The blind spot that survives is the mirror image and is not fixable by any diff:** an **orphan** —
a committed binding whose Rust source has been deleted — produces no diff *and* no untracked file. I
measured **29** of them (three implementations, 48 / 31 / **29**, the strictest hand-verified), **26
still imported and 22 still the declared return type of a live `invoke`** (§7 B1). *A gate fixed for
the "new file" case is not fixed for the "deleted source" case, and the second is the one that has
been accumulating.*

**12.3 — "19 orphan bindings accumulated" is low; the measured figure is 29, and the important part
is not the count.** The brief's framing treats orphans as clutter. They are not: `VaultStatus` is the
declared payload type of `invoke<VaultStatus>("vault_status")`, and
`src-tauri/src/commands/credentials/crud.rs:427` returns `Result<serde_json::Value, AppError>`. **The
frontend is typed against a fossil.** 22 of the 29 are in that position.

**12.4 — "`split-locales.mjs` writes 793 JSON files in a loop" understates it, and
`compile-time-env-embedding` §7 E2's prediction that a kill *"leaves a mixture of new and stale
sections"* is wrong.** It calls `fs.rmSync(sectionDir, {recursive, force})` **first**
(`split-locales.mjs:56`). Executed against a scratch copy: an interrupt **320 ms** after start leaves
**no directory at all**, and 793 tracked files are gone (§0 (b)). There are no stale sections left to
mix, because deletion precedes writing. The same line kills the file's own `writeIfChanged` guard for
**793 of its 794** call sites. **Three states of an interrupted generator, not two: untouched,
truncated to zero bytes, and absent.**

**12.5 — "`npx vite build` bypasses all 13 codegen tasks, which `vite.config.ts:40-49` warns about in
a comment" is right, and the live instance is worse than a comment.**
`src-tauri/tauri.android.conf.json` sets `"beforeBuildCommand": "npx vite build"` — the documented
bypass, committed, in a build profile a build system executes, four directories from the warning.
`compile-time-env-embedding` §7 E4 found the bypass in `.claude/CLAUDE.md`'s command list, which is
prose an agent might read; this one is configuration a tool obeys. **`npm run build` itself is
correct** — it has a `prebuild`, and `tauri.conf.json` / `.lite` / `.stable` all route through it.

**12.6 — "2 drift checks for 34 committed generated artifacts" is right in spirit and wrong in both
numbers, in ways that change the conclusion.** There are **three** freshness assertions, not two, and
the third is the only one that matters day to day: `check-command-contract.mjs:231-250` compares
`commandNames.generated.ts` to `src-tauri/src/lib.rs` **inside `npm run check`**, on the developer's
machine, in under a second, with no build. And the denominator is **1,861**, not 34 — the earlier
count was of *files carrying a generated header*, which excludes the 793 section locales and,
depending on how you read it, the 1,032 bindings. **The corrected ratio is 3 assertions covering 1,034
of 1,861 artifacts, of which exactly 1 runs anywhere other than a red CI.**

**12.7 — the brief's "the hazard is not the generator — it is the wiring" is the strongest thing in
it and the measurement is unambiguous.** 14 registered generators → **1,617 artifacts, 0 stale**.
5 unregistered generators → **6 artifacts, 4 stale or unverifiable**. No other property separates
them: same header convention, same blind `writeFileSync`, same absence of a drift check, same authors.
I tested the obvious rival hypothesis — that a compare-before-write guard predicts freshness — and it
predicts nothing (§7 E). **Registration is the variable.**

**12.8 — a correction to my own work, recorded because it is the kind that hides.** My first pass at
"how many committed bindings has a formatter stripped" reported **253 of 699**, from a plausible
signal (a binding with a doc comment and no trailing whitespace). Opening two of them showed the
absence is *structural*: ts-rs emits single-line output for unions and for structs with only a
type-level doc comment, and single-line output has no trailing whitespace to strip. Restricting to
multi-line object emissions gives **4** (plus `SkillEntry.ts` at HEAD, = 5), and two independent
implementations then agree exactly. **Wrong by 63×, and the tell was not a disagreement between
implementations — it was that 36 % of a machine-generated tree being hand-formatted is not a credible
world.** The doctrine's instruction to hand-verify a sample regardless of agreement is what caught it;
I had only one implementation at that point, and it agreed with itself.

---

**Composition note.** Nothing in this document was applied. Several fixes are one line each —
registering `gen-tour-anchors.mjs` in `TASKS`, changing `tauri.android.conf.json`'s
`beforeBuildCommand` to `npm run build` — and they are still left as notes, because both touch the
build lane the operator uses daily and one of them changes what an Android build produces. Per the
[runbook](../golden-path-runbook.md), when in doubt it is a note.
