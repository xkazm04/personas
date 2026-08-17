# Golden path — Bundle size budget

> Situation node: `platform-delivery/gates-and-conventions/bundle-size-budget` ·
> [situation spine](../situation-spine.md) · recurrence 4 · risk **low** ·
> sides **server** (**contradicted — §12.4**) · convergence **converged**
> (**failed, split by clause — §12.3**) · dimensions: **performance · cost** ·
> `twoSided: true` · spine's own framing: *"A declared ceiling the shipped
> artifact must stay under."*
> Composed 2026-08-17 against `master` @ `cc27be561`. **Short form** per the
> Mode-2 tiering (spine header, §0, §2 compact, §7, §9, §12). The quality core —
> two independent implementations of every count, hand-verified precision,
> re-extraction — is unchanged.
>
> **Sweep.** `scripts/check-bundle-budget.mjs`, `scripts/bundle-size-report.mjs`,
> `scripts/lib/bundle-budget.mjs`, `scripts/bundle-baseline.json`,
> `scripts/binary-size-report.mjs`, `scripts/bundle-comment.mjs`,
> `scripts/optimize-assets.mjs`; `vite.config.ts`; the four
> `src-tauri/tauri.*.conf.json`; `ci.yml:153-182` and `release.yml:320-378`;
> `package.json`'s 84 scripts and `lefthook.yml`'s 10 jobs; the **3,133 files /
> 111,489.1 KB** of a `dist/` built today at 17:29; the **144,254,976-byte**
> release binary at `src-tauri/target/release/`; and
> `tauri-codegen-2.6.2/src/embedded_assets.rs` from the local cargo registry.
> Oracle: all five siblings (§12.3).
>
> **Measured by executing, not reading.** `node scripts/check-bundle-budget.mjs`
> was **run**, directly, and its exit code read **without a pipe** — the first
> attempt piped it through `tail` and got the pipe's `0` back, which is the
> failure mode the runbook names. Real exit code: **1**.

---

## §0 — Headline

**Two budgets exist. Neither has ever rendered a verdict. And the JS one is
failing right now, at 6.33× its own total ceiling.**

Run at HEAD against a `dist/` built today:

```
Bundle Budget Report (max chunk: 850 KB, max total: 5000 KB)
  1008.7 KB  vendor-three-B6IKUTvM.js ** OVER BUDGET **
   913.9 KB  index-BdAr4lY8.js        ** OVER BUDGET **
   896.6 KB  en-jmL1ToOK.js           ** OVER BUDGET **
  Total JS: 31642.1 KB across 1400 chunks
  FAIL: 3 chunk(s) exceed 850 KB budget
  FAIL: Total JS bundle (31642.1 KB) exceeds 5000 KB budget
                                                     REAL EXIT = 1
```

| budget | declared at | ratchets | lifetime verdicts |
|---|---|---|---|
| **850 KB/chunk, 5,000 KB total** (JS) | `scripts/lib/bundle-budget.mjs:11-12`, run at `ci.yml:169-174` | `scripts/bundle-baseline.json` — **timestamped 2026-03-14**, `totalKB: 4720` | **0.** `ci.yml` is 327 runs, 0 successes; the step's input `dist/` never exists because `npm ci` fails four steps earlier |
| **100 MB per installer** (binary) | `release.yml:335`, `binary-size-report.mjs --budget 100` | `.baseline/binary-sizes.json` — **the directory does not exist** | **0.** `release.yml` is 30 runs, 0 successes; and the step is `if: matrix.label == 'windows-x64'`, so three of four platforms are unbudgeted by design |

The baseline is **five months and 6.7× behind** the artifact it describes, so
even the delta column of the PR comment is a comparison against a bundle that no
longer exists.

**But the more useful finding is that the number the gate sums is not a quantity
any user experiences, in either direction.**

*It counts bytes nobody can download.* **793 of the 1,400 chunks — 16,869.5 KB,
53.3% of the measured total — are per-locale translation catalogs**, 13 locales ×
61 sections, of which a given user loads **at most one** (~1,297.7 KB average).
About **15,571.8 KB (49.2%)** of the budgeted total is bytes no single user can
ever fetch. The May 2026 section-locale split — an unambiguous *improvement*
to load time, replacing monolithic 500 KB locale bundles with lazy per-section
chunks — is most of what pushed this gate over its ceiling. **A sum-of-all-chunks
budget punishes the technique that fixes the problem it is measuring.**

*And it cannot see most of what ships.* The gate reads `dist/assets/*.js` and
nothing else:

| in `dist/` | files | KB | counted by the budget |
|---|---:|---:|:--:|
| `assets/*.js` | 1,400 | 31,642.1 | ✅ |
| `assets/*.map` | 1,395 | **60,623.3** | ✗ |
| `assets/*.png` | 21 | 1,944.0 | ✗ |
| `assets/*.css` | 3 | 865.6 | ✗ |
| everything else under `dist/` | 314 | 16,414.0 | ✗ |
| **whole `dist/`** | **3,133** | **111,489.1** | **28.4% observed** |

Those 60,623.3 KB of source maps are not build detritus. `vite.config.ts:84`
sets `sourcemap: "hidden"`, `tauri.conf.json` sets `frontendDist: "../dist"`,
there is no `.taurignore` anywhere in the tree, and
`tauri-codegen-2.6.2/src/embedded_assets.rs:127-140` walks `frontendDist` with
`WalkDir`, filters **directories only**, and comments *"compress all files
encountered"*. Every `.map` is embedded in every installer — and each one carries
`sourcesContent`: the `index` map alone holds **302 sources / 302
sourcesContent / 2,268,612 bytes of original TypeScript**. `release.yml:365-370`
uploads them to Sentry and never deletes them. **The sibling repo does delete
them, with the reason in the comment — §12.3.**

---

## §2 — The one way (compact)

**Budget the two numbers a human can act on — what a user downloads on first
paint, and what the shipped artifact weighs — and derive both from an inventory
of the destination rather than a filter over it.** Concretely:

1. **Never budget a sum over lazily-loaded chunks.** It is the arithmetic of a
   quantity nobody experiences, and it moves the wrong way when you code-split.
   Budget the **entry graph** (the initial chunk plus everything it statically
   imports), and budget the **largest single lazy route**. If you also want a
   total, denominate it per-locale/per-tier — one user's worst case — not as the
   sum of all variants.

2. **Enumerate the destination; do not filter it.** `readdirSync(dir).filter(f
   => f.endsWith('.js'))` measures your assumption about the directory, not the
   directory. Sum everything, then *classify* — and report the residue as its
   own line. This is [`bundling-native-assets`](./bundling-native-assets.md)'s
   law applied to size: *never let a build system's declaration of what it ships
   be the only account of what it ships.* A budget that observes 28.4% of its own
   output directory will pass while the artifact triples.

3. **The ceiling and the baseline must be re-derived together, and dated.** A
   ratchet whose baseline is five months old is not a limit; it is a number the
   build has already walked past. Refresh both in the same commit, and make the
   refresh visible in the diff (this repo's `--save-baseline` does write to the
   file the delta reads from — nothing calls it).

4. **Ship no debugging artifact you would not hand to a stranger.** With
   `sourcemap: "hidden"` you have already decided the browser must not find them;
   the build system has not been told. Either delete them after uploading to your
   error tracker, or emit them outside the frontend-dist directory. Both answers
   exist in this fleet; this repo has neither (§12.3).

5. **Declare ONE ceiling per artifact.** Three exist here —
   `chunkSizeWarningLimit: 500` (warns), `MAX_CHUNK_KB = 850` (fails),
   `--budget 100` MB (fails, installers only) — and the first two disagree by
   70%. When two numbers describe the same thing, the smaller one becomes noise
   people learn to scroll past.

6. **Put the budget where a developer meets it.** A CI-only size gate in a
   repository whose CI has never gone green is a gate nobody has ever seen fail.
   `check:budget` exists as an npm script; adding it to `npm run check` or
   pre-push costs one line and converts an unobserved number into a felt one.

7. **Budget the artifact, not the exempt part of it.** A per-installer ceiling
   that explicitly skips the raw executable measures the compression of the thing
   rather than the thing. State what the budget covers, and make sure the union
   of covered artifacts is the union of shipped artifacts.

---

## §7 — Deviations

### 7.A — P0. The JS budget fails at HEAD by 6.33×, and nothing has ever reported it

`node scripts/check-bundle-budget.mjs` → **exit 1**. Total **31,642.1 KB**
against **5,000 KB**; three chunks over the 850 KB per-chunk ceiling
(`vendor-three` 1,008.7, `index` 913.9, `en` 896.6).

Two independent implementations of the measurement — Node `fs.statSync` over
`readdirSync`, and PowerShell `Get-ChildItem -Recurse | Measure-Object Length` —
**agree to the tenth of a kilobyte on all five figures**: 1,400 js /
31,642.1 KB, 1,395 map / 60,623.3 KB, 3 css / 865.6 KB, 3,133 files /
111,489.1 KB, and 3 chunks over 850 KB.

Why nobody knows: `ci.yml`'s `frontend-checks` job is **0 for 327**, and the
budget step's failure there is not a budget failure — with `npm ci` and `Build`
both red, `dist/assets/` does not exist and the script exits 1 on
*"dist/assets/ not found — run `npm run build` first."* **The gate's red and the
budget's red are the same colour and different facts.** (Credit where due: that
`try/catch` → `exit 1` at `:39-44` is the correct fail-loud shape for a missing
input; the problem is that it is indistinguishable from the verdict at job
granularity.)

**Not applied.** Bringing the bundle under 5,000 KB is a build-configuration
change, and re-baselining is a decision about what the ceiling should mean.
Registered as deferred fix **#107**.

### 7.B — P0. 60,623.3 KB of source maps, carrying full original TypeScript, ship inside every installer

The chain, each link verified in the tree:

1. `vite.config.ts:84` — `sourcemap: "hidden"` → maps are **emitted** to
   `dist/assets/`, only the `//# sourceMappingURL` comment is suppressed.
2. `src-tauri/tauri.conf.json` — `build.frontendDist: "../dist"`.
3. No `.taurignore` at the repo root or under `src-tauri/`; `bundle.resources`
   declares only `{"resources/skills": "skills"}`.
4. `tauri-codegen-2.6.2/src/embedded_assets.rs:105-150` — `WalkDir::new(&path)`,
   `.filter_map(...)` discarding **directories only**, with the comment
   *"compress all files encountered"*. No extension filter, no ignore list.

Content, verified by parsing one: `dist/assets/index-*.js.map` declares
`sources: 302`, `sourcesContent: 302`, and **2,268,612 bytes** of original
TypeScript inside that single file — including `src/lib/idlePrefetch.ts`,
`src/hooks/utility/**`, and everything else the entry chunk touched.

`release.yml:365-370` runs `@sentry/cli releases … upload-sourcemaps ./dist` and
then nothing: no delete, no move, no exclusion. So the maps are uploaded *and*
shipped. This is a size finding (54.4% of `dist/`) and a source-disclosure
finding at once. **Not applied** — changing what the installer contains is a
release-shape change; it is part of #107.

### 7.C — P1. The budget's own metric is 53.3% bytes no user can download

Two implementations, and the disagreement between them was the useful part:

| implementation | locale chunks | KB |
|---|---:|---:|
| basename ∈ `en.json`'s 61 top-level sections | 795 | 16,871.4 |
| the same, **and** the chunk contains no `import` (a pure data module) | **793** | **16,869.5** |
| on-disk ground truth: `src/i18n/section-locales/*/*.json`, 13 locales × 61 | **793** | — |

The two differ by exactly **2 chunks / 2.0 KB** — `settings-BJgUTJge.js` (0.5 KB)
and `triggers-IALH_Q_0.js` (1.5 KB), real code chunks that happen to share a name
with an `en.json` section. Grouping by basename shows 59 of the 61 section names
at exactly 13 chunks and those two at 14, with no name below 13 — which is what a
13-locale projection looks like, and is why the second implementation is the
right one. **A name-based classifier over a namespace someone else also uses will
always be off by the collisions; the collisions are findable by counting the
expected multiplicity.**

The English catalog is separate and is itself over the per-chunk ceiling:
`en-jmL1ToOK.js`, **896.6 KB**, emitted from `src/i18n/generated/enSectionStrings.ts`.

### 7.D — P1. Three declared ceilings, and the ones that fight are 70% apart

| ceiling | where | severity | scope |
|---|---|---|---|
| 500 KB/chunk | `vite.config.ts:85` `chunkSizeWarningLimit` | warns during build | every chunk |
| 850 KB/chunk, 5,000 KB total | `scripts/lib/bundle-budget.mjs:11-12` | **fails** | `dist/assets/*.js` |
| 100 MB/installer | `release.yml:335` | **fails** | installers only — `binary-size-report.mjs:121` is `budgetMB && !name.endsWith(".exe")` |

`bundle-budget.mjs`'s header records that the three-copies problem was already
fixed once (*"these two scripts plus the ci.yml CLI flags carried three
independent copies of 850/5000"*) — and the Vite warning limit was left outside
the consolidation. Today Vite warns on **hundreds** of chunks per build while the
gate cares about three; the warning is noise by construction.

### 7.E — P1. The binary budget exempts the binary, covers one of four platforms, and has no baseline

- **`binary-size-report.mjs:121`** — `if (budgetMB && !name.endsWith(".exe") && …)`.
  The raw executable is exempt. Measured locally:
  `src-tauri/target/release/personas-desktop.exe` = **144,254,976 B (137.6 MB)**,
  built 2026-08-09 — **37.6% over the number the budget names**, in the artifact
  the budget declines to look at.
- **`release.yml:334`** — `if: matrix.label == 'windows-x64'`. The macOS
  universal, Linux and Windows-ARM64 installers are never measured.
- **`.baseline/` does not exist.** `--save-baseline` is never passed by any
  workflow or npm script, so `loadBaseline()` returns `null` and every delta
  renders as `—`. The regression-detection half of the tool has never been armed.

### 7.F — P2. Only the largest tier is budgeted, and only by accident of ordering

`ci.yml:157-163` records it plainly: `check:tiers starter team` writes to `dist/`
as a side effect and must run **before** `npm run build`, "which leaves `dist/` as
the builder bundle for the bundle-budget / baseline steps that read it." The
consequence is correct-by-luck — builder ⊇ team ⊇ starter, so budgeting the
largest is the right choice — but it is **an ordering dependency between two
steps that do not mention each other**, and the starter/team bundles are built,
measured by nothing, and overwritten. If a tier ever gains a chunk the builder
tier lacks, no gate will see it.

### 7.G — P2. `check:assets` reports ~8,982 KB of free savings and is wired to nothing

`package.json:73` — `check:assets: node scripts/optimize-assets.mjs --dry-run`.
Executed today: **12,831 KB → 3,849 KB, a 70% reduction** across the PNG assets.
It appears in **no** workflow, **no** lefthook job and **not** in `npm run check`
— `.claude/CLAUDE.md` correctly calls it "advisory, not CI-gated". Its sibling
`check:budget` (`package.json:72`) is in `ci.yml` only, and likewise absent from
`npm run check` and from all 10 `lefthook.yml` jobs. **Neither size number is
ever put in front of a developer.**

Related, and already published by
[`bundling-native-assets`](./bundling-native-assets.md) §7.A: the Tauri
`bundle.resources` payload (`src-tauri/resources/`, 40 files, **257,224 B**
today) is a **superset of its declaration** — 22 undeclared skill directories,
87,391 B, 37.5% of the bundled skills payload, invisible because the destination
is gitignored. Same law as 7.B and §2.2, at 1/700th the scale: the interesting
thing about a bundle is always what nobody enumerated.

### 7.H — P2. Cleared

- `scripts/lib/bundle-budget.mjs` is a genuine single source of truth: both
  consumers import `MAX_CHUNK_KB`/`MAX_TOTAL_KB` and `ci.yml:174` passes no
  flags. The comment's account of the earlier three-copy drift is accurate.
- `bundle-size-report.mjs:104-118` writes `--save-baseline` to
  `scripts/bundle-baseline.json` — **the same file the delta comparison reads**.
  The bug its comment describes (writing to `dist/bundle-sizes.json`) is fixed.
- `normalizeChunkName` + the `#2`/`#3` disambiguation (`:42-82`) handles the
  1,400-chunk reality without collisions.
- `check-bundle-budget.mjs`'s missing-input path exits **1**, not 0. It fails
  loudly. That is the correct half of 7.A.

---

## §9 — The missing gate: a decline, and the instrument that would work

**Declined — with numbers.** No census rule is proposed, and it is not a close
call: **every condition in §7 is a property of a build output that does not
exist in the repository.** `dist/` is gitignored (`.gitignore:8`), the installer
is not tracked, and `src-tauri/target/` is not tracked. The census walks tracked
source. It cannot count a chunk.

The three candidates that *are* in tracked files, each measured before rejection:

1. *A size threshold declared in more than one place* (7.D) — exactly **one**
   executable declaration each: `bundle-budget.mjs:11` (`850`),
   `vite.config.ts:85` (`500`), `release.yml:335` (`100`). The other four
   occurrences of `850` in the tree are prose in comments. **3 sites in 3 files,
   each legitimate in isolation**; the defect is the *relation* between them,
   which no per-file regex expresses.
2. *A directory enumeration filtered to one extension in size tooling* (§2.2) —
   the violating form is `check-bundle-budget.mjs:40` and
   `bundle-size-report.mjs:62`; the compliant form is
   `binary-size-report.mjs:52-67`, which enumerates six subdirectories and takes
   every file over 1,024 B. **2 violating / 1 compliant** is a partition and far
   too thin to ratchet. Worse, the pattern that finds them —
   `\.filter\(\s*(?:\([^)]*\)|\w+)\s*=>[^;\n]{0,120}?endsWith\(` — matches **23
   sites in 21 files** across the 155 scripts, of which **2** are this condition:
   **8.7% precision.** A gate that fires on 21 correct scripts to name 2 wrong
   ones is worse than no gate. Rejected.
3. *`sourcemap: "hidden"` without an exclusion* (7.B) — **1 site**, and the
   condition is not the token but the absence of a `.taurignore`, which is an
   absence the census cannot assert.

**Checked for overlap** across all 191 registered rules: none has this leaf as
its `goldenPath`; the nearest neighbours are
`unverifiable-generated-artifact` (also rooted at `scripts/`, also about a
build-tooling property) and `verification-that-cannot-fail`. Neither pattern
touches a `readdirSync` or a size literal. Nothing to extend.

**The instrument that would work — specified, not written.** Extend
`check-bundle-budget.mjs` rather than adding a script, because the file already
runs at the only moment the data exists:

```
walk dist/ ENTIRELY (recursive, no extension filter)
report four numbers, each with its own ceiling:
  1. entry graph      = index chunk + its static imports        <- what first paint costs
  2. largest lazy route                                          <- the worst navigation
  3. one-locale total = total - (12 of the 13 locale catalogs)   <- one user's worst case
  4. shipped bytes    = every file under dist/                   <- what the installer carries
assert  files_walked >= FLOOR         # else "the walk is broken, not the bundle small"
assert  residue == 0                  # every file is classified into exactly one bucket
exit 2 if files_walked == 0
```

The **residue assertion is the load-bearing clause**: it is what turns "we
measured the .js files" into "we measured the directory", and it is what would
have surfaced 60 MB of source maps on the first run. Today the four numbers are
approximately: entry graph ~unmeasured, largest lazy route 1,008.7 KB,
one-locale total ~16,070 KB, shipped bytes 111,489.1 KB.

**And the type that outranks it.** Two of the three §7 P0/P1 findings stop being
expressible with a build-configuration change, not a gate:

- **Emit source maps outside `frontendDist`.** `build.sourcemap` plus an output
  directory the bundler does not publish (or `deleteSourcemapsAfterUpload`, which
  the sibling already uses — §12.3) makes 7.B **unrepresentable**: there is no
  map in the directory the embedder walks, so no exclusion can be forgotten, and
  no future `.taurignore` can rot.
- **Make the budget's input the whole directory** by construction — a
  `walkDir(dist)` with a classification that must be total. Then "a file type
  nobody thought of" cannot be silently uncounted, which is the failure that
  produced this entire section.

A ratchet over the current metric would have held 31,642 KB steady and taught
everyone that the bundle is fine.

---

## §12 — Corrections

### 12.1 — Correcting my own brief, on its central premise

The dispatch brief said: *"Establish whether any size budget exists at all, and
if not, say so plainly: 'there is no budget' is a legitimate §0."*

**Two budgets exist**, both enforcing (`exit 1`), both wired into CI:
`ci.yml:169-174` (850 KB/chunk, 5,000 KB total) and `release.yml:333-335`
(100 MB/installer). The interesting fact is not their absence but their
**status**: one is failing at 6.33× and has never been observed doing so; the
other exempts the largest artifact it can see and has no baseline. The brief's
framing would have produced a document that was wrong in its first sentence.

Worth recording as a general habit rather than a one-off: **"there is no X" is
the claim most likely to be an artifact of where you looked.** The JS budget is
not in `npm run check`, not in `lefthook.yml`, and not named in `.claude/CLAUDE.md`
— the three places a composer scoping this leaf would search first. It is one
unreferenced line inside a 437-line workflow. Enumerate the *ways a thing could
be wired* before concluding it is not.

### 12.2 — The runbook's pipe warning, earned again in the first five minutes

My first run of the gate was `node scripts/check-bundle-budget.mjs 2>&1 | tail -25;
echo "EXIT=$?"`, which printed **`EXIT=0`** for a script that had just printed two
`FAIL:` lines. The exit code belonged to `tail`. Re-run without the pipe: **1**.
This is the same trap the runbook records for `census:check` and
`check-corpus-integrity.mjs`, and it took the identical form: the *output* said
FAIL, the *exit code* said PASS, and a less careful reading would have published
"the budget passes" over the top of its own contradicting output.

### 12.3 — `convergence: converged` fails, and it splits by clause

Cohort established at measurement time (2026-08-17). Two clauses, opposite
verdicts — which is a shape the doctrine already records as beyond what a single
enum field can carry.

**Clause 1 — a size budget: 5 of 5 silent.** `personas-web`, `personas-cloud`,
`vibeman`, `ascent` and `brainiac/console` have **no** size-budget script, **no**
size-tooling dependency (`size-limit`, `bundlesize`, `@next/bundle-analyzer`,
`webpack-bundle-analyzer`) and **no** npm script matching `size|budget|analyz|bundle`.
Personas is the only repo in the cohort that declares a ceiling at all. Reported
as a **silence**, per the doctrine — one author not needing it four times is not
a verdict that it is unnecessary. *"Personas is ahead of the fleet"*, stated as
self-comparison.

**Clause 2 — shipping source maps: the fleet has the answer and this repo is
behind.** Three repos, three deliberate designs, and Personas has the only unsafe
one:

| repo | source-map disposition |
|---|---|
| `../personas-web` | `next.config.ts:113-117` — **`sourcemaps: { deleteSourcemapsAfterUpload: true }`**, above the comment *"Delete source maps after upload so they don't ship to the client"* |
| `../brainiac/console` | `next.config.ts:71` — `sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN }`: don't generate them at all without an upload target |
| **personas** | `vite.config.ts:84` `sourcemap: "hidden"`, uploaded at `release.yml:365-370`, **never deleted**, embedded whole by `frontendDist` (7.B) |

The sibling did not merely avoid the problem — it **solved it, named the failure
mode in prose, and shipped a one-line fix**. Per the doctrine, that is a
cost/inversion result and shared authorship does not weaken it: the same engineer
reached the correct answer on the web target and did not carry it to the desktop
target, where the consequence is larger (an installer is downloaded once and kept,
where a web asset is at least behind a CDN and a login).

Add to the ledger as a **`converged` failure whose two clauses point opposite
ways** — silence on one, inversion on the other.

### 12.4 — `sides: "server"` is contradicted, and the correction is "both, and the client half is the whole point"

The spine marks this leaf `sides: "server"` with `twoSided: true`. The server
half is real (the build, the workflow, the installer). But **the entire reason a
bundle budget exists is a client-side cost** — bytes a WebView parses before
first paint — and the leaf's sharpest finding (7.C: 53.3% of the metric is bytes
no client can fetch) is a statement about *client* behaviour that a server-scoped
brief would never have gone looking for. The measurable content lives on both
sides: `vite.config.ts` and the chunk graph on the client, `binary-size-report`
and `embedded_assets.rs` on the server, and the defect in §0 is precisely that
the gate measures neither one correctly. Recorded as a contradiction in the
**"incomplete, not inverted"** family.

### 12.5 — Where the two implementations disagreed, and one place they agreed too easily

- **Disagreed, usefully:** the locale-chunk classifier (7.C), 795/16,871.4 KB vs
  793/16,869.5 KB. Reconciled against an on-disk ground truth (793 section-locale
  JSON files) and the 13-per-name multiplicity, which identified the two
  collisions by name.
- **Disagreed, and my discriminator was simply wrong first:** an earlier
  classifier tested for a JSON-data module with `/^const [A-Za-z0-9_$]+=\{/` and
  returned **0 of 795**. The real emitted form is
  ``var e=JSON.parse(`{…}`)`` for large sections and ``var e=`…`,t={key:e}`` for
  one-string sections — neither matches. It reported "793 locale chunks: 0", a
  clean and completely false answer. Caught only because 0 was implausible.
  **A classifier that returns a suspiciously round number has usually failed to
  parse, not succeeded at discriminating.**
- **A delimiter that appears inside its own operator, again.** The first version
  of §9's second candidate used `\.filter\([^)]*endsWith\(` and returned **1
  site in 1 file** — and that one site is **not** either of the two the rule was
  written for. The cause is that an arrow function's parameter list puts a `)`
  inside `[^)]*`, so `.filter((f) => f.endsWith(".js"))` cannot match. Corrected
  to allow a parenthesised parameter, the same scan returns **23 sites in 21
  files**. This is the doctrine's *"enumerate the operators that contain your
  delimiters"* in a new costume: there the delimiter was `<`/`>` and the operator
  was `=>`; here the delimiter is `)` and the operator is `(f) =>`. **The wrong
  answer was 1 — plausible, small, and pointing at an unrelated file.**
- **Agreed too easily, and it needed checking anyway:** `fs.statSync` and
  PowerShell `Measure-Object` agreed to the tenth of a kilobyte on five separate
  figures. That is not independence — both ask the same filesystem the same
  question. The claim they jointly support is only "these bytes are on disk";
  the load-bearing claim (that they are *inside the installer*) rests on reading
  `tauri-codegen`'s walker, which is a different kind of evidence and is why 7.B
  cites a line number in `~/.cargo/registry` rather than a byte count.
