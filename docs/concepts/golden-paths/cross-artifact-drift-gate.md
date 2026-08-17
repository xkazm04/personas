# Golden path — Cross-artifact drift gate

> Situation node: `platform-delivery/gates-and-conventions/cross-artifact-drift-gate` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **medium** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **code-quality · resilience** · `twoSided: true`.
> Composed 2026-08-17 against `master` @ `afb295187`.
> **Short form** (Mode 2 tiering): spine header, §0, §2 compact, §7, §9, §12.
> The measurement core is unreduced — two implementations of every count, a
> positive control, hand verification, and re-extraction.
>
> **Sweep size.** Every gate in this repository that proves two artifacts still
> agree: **3** regenerate-then-diff sites, **13** `check-*`/`gen-*` comparison
> scripts, the 5 `ci.yml` jobs, `.gitlab-ci.yml`'s 7 stages, the 2 Claude Stop
> hooks, and the golden-path index's own cross-artifact inventory. **1,033**
> binding files in `src/lib/bindings/` reconciled against
> `shared-facts.json#rust.files` = **963** `.rs` files by two independent
> implementations. All five sibling checkouts swept for the same three gate
> shapes. `cargo` was not run; the full census registry was not run.

---

## 0. The headline: the drift gate that was fixed exists twice, and only one copy got the fix

`.github/workflows/ci.yml:419-437` is the repository's best cross-artifact
gate. On 2026-08-14 it was repaired for a defect the corpus has since promoted
to doctrine — *a diff-shaped gate cannot see an absence* — and the repair is
exemplary: it checks `git ls-files --others --exclude-standard src/lib/bindings/`
**before** `git diff --quiet`, with a comment naming the date it was verified
by creating a new binding.

`.gitlab-ci.yml:159-173` is the same job. It has **none of the three fixes**,
and each one is independently sufficient to make it green forever:

```yaml
check-bindings:
  script:
    - cargo test --manifest-path $CARGO_MANIFEST export_bindings 2>/dev/null || true
    - |
      if ! git diff --quiet src/lib/bindings/; then
```

1. **No `--workspace`, no `--features desktop`.** `ci.yml:405-416` documents,
   at length, that without them *"zero bindings regenerate"* — `--manifest-path`
   alone selects only `personas-desktop`, and the crate split moved ~200
   `#[ts(export)]` types into `personas-core`.
2. **`2>/dev/null || true`.** `ci.yml:398-404` documents removing exactly this
   wrapper because it *"silently masked Rust-side breakage"*.
3. **No untracked check.** `git diff` sees tracked files only, so a brand-new
   binding — the case the gate exists for — is invisible.

So the GitLab copy regenerates nothing, discards the failure of regenerating
nothing, and then diffs an unchanged tree. Three independent reasons to be
green, stacked. It is also on a pipeline with **no remote** (`git remote -v` →
GitHub only; `.gitlab-ci.yml` has one commit in its entire history), so it has
never actually run — which is the only reason this is a latent hazard rather
than a live one.

**This is the generalisable finding, and it is why the leaf exists:** a
cross-artifact gate is itself an artifact, and it drifts from its own copy. The
2026-08-14 repair was written as a fix to *the* binding-drift gate. There were
two.

### Three shapes, and what each is structurally blind to

| shape | instances here | what it cannot see |
| --- | ---: | --- |
| **regenerate → `git diff`** | 3 (`ci.yml:336`, `ci.yml:432`, `.gitlab-ci.yml:167`) | a file the generator no longer emits (an **orphan**), and — without a companion `ls-files --others` — a file it newly emits. 1 of the 3 has the companion. |
| **set comparison** (both directions) | `check-coverage.mjs:93-95`, `check-command-contract.mjs:247-262` | nothing structural — this is the shape that works. It costs an explicit inventory of both sides. |
| **transcript / event shaped** | `check-doc-sync.mjs`, `check-golden-path-touch.mjs` | anything that happened in a turn it did not observe, and anything in a file its map does not name. |

**And the shape that works is not the shape most gates here use.** Of 13
comparison scripts, the two named above compute a genuine two-way difference.
The rest assert containment in one direction, `--check` a regeneration, or read
one artifact and validate it in isolation.

### The measured cost: 32 orphan bindings, 29 of them still referenced

`src/lib/bindings/` holds **1,033** `.ts` files (excluding `index.ts`) against
**963** `.rs` files. Two independent implementations of *"is this binding's
Rust source still present?"*:

| implementation | orphans |
| --- | ---: |
| 1 — the exported name must appear as a Rust `struct` / `enum` / `type` declaration | **32** |
| 2 — build a `#[derive(… TS …)]` inventory (989 types), set-difference | **49** |
| **agreed by both** | **32** |
| implementation-1-only | **0** |

The sound answer is **32**. Implementation 2's extra 17 are its own false
positives: its `#[derive(...)]`-to-declaration window misses types with
intervening `#[ts(...)]` attributes. Spot-verified by hand: `VaultStatus`,
`OAuthProvider`, `RotationPolicy` and `StartPhase` each have **0** Rust
declarations in 963 files.

**29 of the 32 are still referenced from `src/` outside the bindings
directory** — `VaultStatus` alone at 17 sites. One of the 32 (`serde_json/JsonValue.ts`)
is a legitimate ts-rs emission for `serde_json::Value` with no Rust struct of
that name, so the true defect count is **31**.

ts-rs never deletes. So an orphan produces **no diff and no untracked file**,
which makes it invisible to a diff-shaped gate by construction — and the repo's
own `check-unused-bindings.sh` *protects* the ones that are imported, because
being imported is its definition of used. **Only an inventory of what should
exist finds these.**

---

## 2. The one way (compact)

**A gate that proves two artifacts agree must compare two inventories, not two
revisions — because a diff can only see what one side still declares.**
Concretely: (a) build the **complete set** on each side and compute the
difference in **both directions**, the way `scripts/i18n/check-coverage.mjs:93-95`
computes `missing` *and* `extra` and makes extras always fatal; (b) if you must
use `git diff`, pair it with `git ls-files --others --exclude-standard` for the
new-file direction **and** an explicit inventory for the orphan direction —
`ci.yml:426-431` does the first and nothing here does the second; (c) generate
the comparison's inputs from the source of truth rather than from a hand-written
list, because a list is a third artifact that drifts with the other two
([`client-rule-mirroring`](./client-rule-mirroring.md)); (d) **assert the
instrument**: fail loudly when either inventory is empty or below a floor, since
a comparison of two empty sets passes forever
(`check-corpus-integrity.mjs:62,78,84`); (e) put the gate where a verdict is
produced — this repository's binding-drift job lives in a workflow that is
**0-for-320** and its copy lives in a pipeline with no remote, so both correct
gates have produced zero verdicts; and (f) **if the gate itself has a second
copy, the copies are now a cross-artifact pair too** — either delete one or
gate their agreement.

If you can only do one thing: **enumerate what should exist.** Every other
clause is an optimisation on a comparison that can, in principle, see an
absence. A diff cannot, at any level of care.

---

## 7. Deviations

### D1 — The binding-drift gate exists twice and one copy has none of its fixes · read, 3 defects

§0. `.gitlab-ci.yml:165-172` versus `.github/workflows/ci.yml:398-437`. The
GitHub copy is the exemplar; the GitLab copy is what the exemplar looked like
before 2026-08-14, preserved in a file that has been edited **zero** times
since it was created (`git log --oneline -- .gitlab-ci.yml` → one commit,
`6f34676f9`). Not applied: whether the answer is deleting `.gitlab-ci.yml`,
mirroring to GitLab, or porting its unique jobs to Actions is a hosting
decision, and the file also carries this repository's only secret-detection
engine ([`secret-leak-scanning` §7 D3](./secret-leak-scanning.md)).

### D2 — 32 orphan bindings, 29 still referenced, and no gate can see them · measured two ways

§0. The corrected numbers are **32 / 29** where the campaign's prior record
says 29 / 26 (§12.1). `git diff --quiet src/lib/bindings/` exits 0 for every
one of them, forever, because the file is tracked and unchanged. The
`git ls-files --others` companion added at `ci.yml:426-431` closes the
*new-file* direction and cannot touch this one — the two directions need
different instruments, and only one has been built.

### D3 — The two instruments that decide what "this repository" means disagree · read, one directory apart

`scripts/docs/measure-shared-facts.mjs:26` skips
`['node_modules', 'target', '.git', 'worktrees', 'dist']`.
`scripts/census/lib/engine.mjs:19` skips
`['node_modules', '.git', 'dist', 'target', 'coverage']` — **no `worktrees`,
no `.claude`**.

Measured consequence, executed: a census rule rooted at `"."` walks
`.claude/worktrees/agent-*/` and `.claude/worktrees/athena-dev-*/` — **five
untracked, gitignored full copies of the repository** on this machine, **zero**
on a clean clone. A candidate rule scoped that way returned 148 matches across
59 files, of which the majority were duplicates of three real files. Two
measurement instruments in the same repository, written for the same corpus,
one directory apart, disagree about the repository's own boundary — and only
one of them is used by the 172 rules that gate every push.

**Not applied.** Adding `.claude` or `worktrees` to `ALWAYS_SKIP_DIRS` changes
what 172 live rules see, which is a runtime behaviour change; under the
campaign's no-destructive-applies rule it is written down, not shipped. It is
also the reason [`commit-path-gates` §9](./commit-path-gates.md#9-the-missing-gate--a-reasoned-decline-with-the-numbers-that-produced-it)
declines its rule and why §9 below declines this one.

### D4 — Seven census rules cannot be re-derived from the document that owns them · read, enforced allowlist

`scripts/census/build-golden-path-index.mjs:128-136` names them and why: four
publish the rule in a ` ```jsonc ` fence the merger does not read
(`raw-react-lazy`, `local-empty-state`, `deferred-read-then-write`,
`silent-row-skip`) and three publish no fence at all (`raw-web-storage`,
`hand-rolled-spinner`, `raw-select`, all wave-1).

This is the leaf's own condition applied to the corpus: `rules.json` and the
golden-path documents are two artifacts that must agree, and for seven entries
the doctrine's verification instruction — *"re-extract the fence and confirm the
rule count"* — returns **zero**, which is exactly what a lost rule reads like.

**The handling is the exemplar and should be copied.** The allowlist is
**bidirectional and fatal in both directions** (`:634-651`): an unlisted miss
fails, *and* a listed entry that starts extracting fails. Every entry carries a
prose reason. That is the shape §2 clause (a) asks for, implemented on the
corpus's own metadata. Three of the four `jsonc` blocks need one character;
`silent-row-skip`'s does not parse at all.

### D5 — Three drift gates are registered only in a gitignored file · read

`scripts/docs/check-doc-sync.mjs`, `scripts/docs/check-golden-path-touch.mjs`
and `scripts/build/guard-concurrent-cargo.mjs` are registered in
`.claude/settings.json` — two `Stop` hooks and one `PreToolUse` hook, verified
by reading it. `.gitignore:70` (`.claude/*`, with an allowlist beneath that
does not include `settings.json`) means **the registration cannot travel in a
commit**. A fresh clone has three fewer gates than the documentation describes,
and nothing reports the difference.
[`golden-path-recall.md` §3](../golden-path-recall.md) names this for its own
hook; the measurement here is that it is now true of three, and it is itself a
cross-artifact drift — between the documented gate set and the installable one.

### D6 — `check-doc-sync.mjs` exits 0 silently when its own map is unreadable · read

`scripts/docs/check-doc-sync.mjs:132-135`:

```js
try { map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')); }
catch { process.exit(0); }
```

No message, no exit code, nothing. Rename `feature-doc-map.json` and the doc-sync
gate becomes a no-op that reports success forever. Contrast
`check-golden-path-touch.mjs:126-129`, which does the same thing and **writes a
line to stderr first**, under an eight-line comment arguing why absence is not a
finding for an advisory hook. The line is the entire difference between an
outage and a decision.

### D7 — The corpus's own freshness check is advisory, and it is red right now · executed

`node scripts/census/build-golden-path-index.mjs --check` → **exit 1** (drift),
because this batch added documents the index had not seen.
`check-corpus-integrity.mjs:203-241` deliberately does **not** propagate that
exit code — the source carries a `PROMOTION POINT` marker and a written
promotion condition (`:213-214`). That is the right call for a check that runs
inside the composition wave's own loop, and it is recorded here because it is
the one place in this repository where an advisory cross-artifact check
**states its own promotion criteria in the source**. Regenerating (no `--check`)
brings it to **193 docs · 28,068 citations · 2,924 distinct files · 0 docs with
no citations**.

### D8 — Cleared claims

- **"`ci.yml:336`'s command-name drift check has the same untracked hole."**
  No. Both its targets (`commandNames.generated.ts`, `commandNames.overrides.ts`)
  are tracked files the generator overwrites; it cannot emit a third. And its
  companion, `scripts/check-command-contract.mjs:247-262`, is genuinely
  **two-directional** — `missing from generated` *and* `stale in generated`,
  plus `staleOverrides` and `unknownFrontend`, with a six-entry allowlist
  carrying a written reason. It is the second exemplar in this repository.
- **"The i18n coverage check is one-way."** No — `check-coverage.mjs:93-95`
  computes `missing` and `extra` from both key sets and makes extras always
  fatal. (Its *sibling* in `personas-web` is one-way; see §12.3.)
- **"Nothing checks that generated bindings are used."**
  `scripts/check-unused-bindings.sh` exists and runs in `ci.yml:186`. It is not
  a drift gate — it asks "is this imported?", which is why it **protects** 29 of
  the 32 orphans rather than finding them.

---

## 9. The missing gate — a reasoned decline, with the numbers

**No census rule is published for this leaf.** There is deliberately no fenced
JSON block below; there is nothing for
`scripts/census/merge-published-rules.mjs` to ingest, and that absence is the
finding.

**The condition a signal would be a proxy for**, stack-free: *a verification
that two artifacts still agree, implemented with an instrument that can only
observe one of them changing.*

**Candidate A — "a `git diff`-shaped drift check with no untracked companion."**
This is exactly the right rule for this leaf. It is not expressible.

- Rooted at `["."]`, extensions `.yml/.yaml`, walk **85** files, file-anchored
  `^(?![\s\S]*ls-files[^\n]*--others)[\s\S]*?git\s+diff\s+--(?:quiet|exit-code)`:
  **3 matches / 3 files** — `.gitlab-ci.yml` and **two copies of it inside
  `.claude/worktrees/`**. One true site, two machine-dependent duplicates. The
  baseline would be 3 here and 1 on a clean clone (D3).
- Rooted at `[".github"]`, walk **10** files: **0 matches**, because `ci.yml`
  carries the companion and the file-anchored lookahead therefore exempts the
  whole file — including its *other* diff site at `:336`. A rule that matches
  zero files fails structurally (`engine.mjs:264-274`), correctly.
- **The one true violating site is `.gitlab-ci.yml`, a repository-root file.**
  `walkFiles` (`engine.mjs:53-70`) takes directories; the only root that
  reaches the repository root is `"."`, which is the machine-dependent case
  above. There is no roots/extensions combination that sees `.gitlab-ci.yml`
  and not five untracked repository copies.

That is the same wall [`tauri-permissions-and-csp`](./tauri-permissions-and-csp.md)
hit from the other side — *when the population is not the same on two
checkouts, the answer is a different instrument, not a cleverer pattern* —
reached here for a different reason (untracked worktrees rather than generated
Android configs).

**Candidate B — "a comparison script that reports one direction only."**
Roots `["scripts"]`, extensions `.mjs/.sh/.js/.cjs`, walk **166** files.
Anchor `\bmissing\b`: **195 matches / 52 files**. File-anchored to those with no
`orphan|extra|unused|stale|unknown|obsolete|dangling`: **30 matches / 30
files**; the compliant half returns **22**. Hand-checked, and rejected: the
anchor is not selective for *comparison scripts*. `bundle-comment.mjs`,
`build/inspect-pe-imports.mjs` and `connectors/seed-supabase-catalog.mjs` are
all in the violating set and none of them compares two artifacts — they use the
word "missing" in an error string. Narrowing to `check-*`/`verify-*` filenames
is not possible: the census `exclude` list is a subtractive path glob, so
restricting a 166-file walk to 13 files needs ~150 exclusions, each requiring a
prose reason, each becoming a `stale-exclude` failure the moment a script is
added. Estimated precision well under 50 %; not shipped.

**Why both failed for the same underlying reason.** Candidate A's true site is
in a file the instrument cannot reach; candidate B's true sites cannot be
separated from lookalikes by content. Both are the census asking the wrong
question: **it counts occurrences of a thing that is present, and every finding
in §7 is an absence** — a missing untracked check, a missing Rust declaration,
a missing registration, a missing message before an exit. The doctrine states
this directly (*"the census cannot assert an ABSENCE"*), and this leaf is the
purest instance of it in the corpus so far, because absence *is* its subject.

**The instrument this leaf needs**, specified so it can be written:
`scripts/check-generated-inventory.mjs`, registered at **pre-push** (where a
verdict is actually produced — see [`commit-path-gates` §0](./commit-path-gates.md)),
which for each generated directory:

1. builds the **should-exist** set from the source of truth — for
   `src/lib/bindings/`, every Rust type carrying `#[derive(… TS …)]` with
   `#[ts(export)]`, extracted with
   `scripts/census/lib/instruments/extractRustStrings.mjs` and
   `stripCfgTest.mjs` so the two implementations that already exist do not
   become a third;
2. builds the **does-exist** set by walking the directory;
3. fails on **both** differences — a missing binding (already covered by
   `ci.yml`) and an **orphan** (covered by nothing, 32 today);
4. **exits 2 if either set is below a floor**, because a comparison of two
   empty sets passes forever — the assertion `check-csp-hosts.mjs` exists
   because of and `check-corpus-integrity.mjs:62,78,84` implements;
5. carries an allowlist that is **fatal in both directions**, entries with
   prose reasons — the shape `build-golden-path-index.mjs:634-651` already
   ships for the seven unextractable rules (D4).

Its positive control is written and CI-gated — in a sibling.
`brainiac/console/src/design/focus-contract.test.ts:140` asserts
`expect(found.map(rel).sort()).toEqual(Object.keys(ALLOWED_NATIVE).sort())` —
**set equality, not containment**, so it fails both when a new unlisted control
appears and when an allowlist entry's file is gone, and `:143-146` requires each
entry to carry a >15-character written reason. That is the shape, and it is the
only one of its kind in six repositories.

---

## 10. Convergence — `mixed` is the closest a label has come, and it still fails

Swept across all five siblings for the three shapes:

| repo | regenerate→diff | untracked companion | two-way parity | orphan/inventory |
| --- | :---: | :---: | :---: | --- |
| personas | **3** | **1 of 3** | 2 | **0** |
| personas-web | 0 | 0 | 1 gated (one-way) + 1 ungated | **2, both wired to nothing** |
| brainiac | 2 (`cargo fmt --check`, eval-vs-baseline) | 0 | 2 (CI-gated) | **1, CI-gated** |
| personas-cloud | 0 | 0 | 0 | 0 |
| vibeman | 0 | 0 | 1 (lockfile↔manifest) | 0 |
| ascent | 0 | 0 | 0 | 0 |

**`git diff --quiet` / `git diff --exit-code`: 0 occurrences in all five
siblings. `git ls-files --others --exclude-standard`: 0 in all five.** The
pattern that dominates this repository is absent from the entire fleet — so
Personas is alone on the regenerate-then-diff shape, and the "diff-shaped gate
is blind" defect is not *reachable* in four of the five, because there is no
diff-shaped gate to be blind. **brainiac is the one repo where the trap is
live**: `cargo fmt --all --check` and its eval-vs-committed-baseline compare
(`.github/workflows/ci.yml:36`, `:46-52`) both lack an untracked companion, and
its two-hop generated chain — `crates/brainiac-server/src/main.rs:441` writes
`openapi.json`, `console/package.json:13` turns that into
`src/lib/api-schema.d.ts`, **both tracked, neither regenerated-and-diffed
anywhere** — is the fleet's largest ungated cross-artifact pair.

**The label is `mixed`, and `mixed` is the closest any spine convergence label
has come to holding. It still fails**, because the mixture is the wrong way
round on every clause:

- on the **diff shape**, Personas is alone (a 5/5 silence, not a mixture);
- on the **inventory shape**, Personas has **zero** and two siblings have
  three between them — this repo is *behind*, and the label's direction is
  backwards here;
- on **wiring**, the fleet converged on the disease: `personas-web` owns two
  working orphan detectors and runs **neither**.
  `scripts/check-guide-content.mjs:93-99` is a true bidirectional three-way
  invariant whose own header (`:15`) says *"Designed to run zero-dep in CI"* —
  and it is in no CI, no hook, and is invoked by nothing but a human typing the
  path. `scripts/i18n/check-guide-translations.mjs:132,157,184` is a four-state
  classifier (`stale`/`missing`/`orphaned`/`fresh`) with hash-based staleness
  and a `--strict` release gate, with **zero call sites in the repository**.

So a single enum field carries three verdicts here — silence, behind, and
built-but-unwired — which is the same structural objection the doctrine records
against `converged`: **a label that splits by clause cannot be an enum value.**

**Lineage, applied.** No sibling shares gate configuration with this repo. The
`personas-web`/`ascent` tooling lineage (two byte-identical dev-inspector
scripts) does not touch this leaf. brainiac is a separate Rust service and its
inventory assertion is a genuine independent reinvention **with a different
mechanism** (a vitest set-equality assertion rather than a shell diff), which
the doctrine weights above simple agreement. Effective independent cohort: **5**.

---

## 12. Corrections

### 12.1 — To the campaign's own orphan-binding record

The corpus records **29 orphan bindings, 26 still imported, 22 still the
declared return type of a live `invoke`** (`.claude/CLAUDE.md`, and
[doctrine §2](../golden-path-doctrine.md#2-measurement-rules)), from three
implementations that returned 48 / 31 / 29.

Re-measured 2026-08-17 by two fresh implementations: **32 orphans** (agreed by
both; implementation-1-only = 0), of which **29 are still referenced from
`src/`** outside the bindings directory. One of the 32
(`serde_json/JsonValue.ts`) is a legitimate ts-rs emission with no Rust struct
of that name, so **31** is the defect count.

The direction of the correction matters more than the size: the number has gone
**up** by 3 while the campaign has been publishing it as a static fact. Nothing
deletes an orphan, so this count is monotone increasing until an inventory gate
exists — which is §9's whole argument. The `22 still the declared return type
of a live invoke` figure was not re-measured here and is carried forward
unverified.

### 12.2 — To the brief

- **"The CI binding-drift job `git diff --quiet` exits 0 for an untracked file
  — FIXED at `ci.yml:426-431`."** Confirmed, and **incomplete in the way that
  matters**: the gate exists twice and the fix landed in one copy.
  `.gitlab-ci.yml:165-172` still has the pre-fix form, plus two further defects
  `ci.yml` also documents having removed (§0). "Fixed" is true of the gate the
  fixer was looking at.

- **"29 orphan bindings persist that no diff-shaped gate can see."**
  **32** (§12.1), and the mechanism is confirmed exactly.

- **"`check-doc-sync.mjs` and the new `check-golden-path-touch.mjs` are the
  pattern."** They are a pattern, and it is a *third* shape, not the two-way
  comparison this path prescribes — they key on a **turn's edit set**, so what
  they cannot see is any edit outside the transcript and any file outside
  `feature-doc-map.json`. Both also carry the leaf's own defect in miniature:
  `check-doc-sync.mjs:132-135` exits 0 **silently** when its map is unreadable
  (D6), and both are registered only in a gitignored file (D5).

### 12.3 — A sibling claim re-scoped

An earlier sweep in this batch reported `personas-web/scripts/check-i18n-coverage.mjs:89`
as one-way (`Object.keys(expected)` — the English baseline only, so an extra key
in a target locale is structurally invisible). That is a finding **about
`personas-web`**, and it does not transfer: this repository's
`scripts/i18n/check-coverage.mjs:93-95` computes `missing` **and** `extra` from
both sets and makes extras fatal in default mode. Two files with nearly the same
name, opposite verdicts. Recorded because the sweep that produced the sibling
finding was keyed on the mechanism, and the doctrine's warning applies —
*search for the NAME as well as the mechanism*, then check which repo you are
in before generalising.

### 12.4 — A regeneration this composition performed

Running `node scripts/census/build-golden-path-index.mjs --check` returned
**exit 1** (expected — this batch added documents), and the subsequent
non-`--check` run **wrote `index.json` and `router.json`**. That is a
deterministic regeneration of two generated artifacts, the same one
`merge-published-rules.mjs` performs at the end of every merge, and it is
recorded rather than hidden: a composer that quietly writes a generated file is
indistinguishable from one that did not, which is the failure mode this entire
document is about.
