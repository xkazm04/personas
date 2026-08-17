# Golden path — Cross-artifact drift gate

> Situation node: `platform-delivery/gates-and-conventions/cross-artifact-drift-gate` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **medium** ·
> sides **server** · convergence **mixed** (**partially upheld** — §12.1) ·
> dimensions: **code-quality · resilience** · `twoSided: true` ·
> spine's own framing: *"Machine-proving two artifacts that must agree still
> agree."*
> Composed 2026-08-17 against `master` @ `afb295187`. **Short form** per the
> Mode-2 tiering (spine header, §0, §2 compact, §7, §9, §12). The quality core
> — two implementations of every count, a positive control, private-registry
> validation, re-extraction from the finished document, hand-verified precision
> — is unchanged.
>
> **Sweep.** Every regenerate-and-compare gate in the repository: `ci.yml`'s
> `command-name-drift` (`:320-341`) and `binding-drift` (`:344-437`),
> `.gitlab-ci.yml`'s `check-bindings` (`:159-173`), all **10** `lefthook.yml`
> jobs, the **9** constituents of `npm run check`, `scripts/run-codegen.mjs`'s
> task registry, and all **165** tracked `.mjs`/`.js`/`.cjs` files under
> `scripts/`. Artifact pairs: **1,032** files in `src/lib/bindings/` against all
> **963** tracked `.rs` files; `commandNames.overrides.ts`'s 18 entries against
> the same; `en.json` against the 13 sibling locales (**19,112** keys each);
> `CATALOG.md`; the three `tauri.*.conf.json`; the corpus's own `index.json` /
> `router.json` / `rules.json`.
>
> **Measured by executing, not reading.**
> 1. `check-coverage.mjs --strict` was **run against a locales directory
>    containing only `en.json`**. It printed an empty table and **exited 0**.
> 2. `build-golden-path-index.mjs --check` and `check-corpus-integrity.mjs` were
>    run **directly, never through a pipe** — a pipe replaces the exit code with
>    the pipe's, which is how a red corpus-integrity run was pushed past once
>    already.
> 3. The census rule in §9 was validated in a **private scratch registry**
>    (unique filename — sibling composers share the scratchpad) and then
>    **re-extracted from this finished document and re-run**; the numbers are
>    identical.
> 4. Orphan bindings were re-measured with an instrument that **self-tests its
>    own word-boundary matcher before trusting it** — see §12.3, where the first
>    attempt reported `0` and the true answer is `28`.

---

## 0. One gate in this repository actually regenerates and compares. Its exit code is discarded.

A cross-artifact gate has exactly one job: take two things that are supposed to
agree, and prove they still do. There are many pairs here. There is essentially
one gate.

**165** tracked scripts under `scripts/`. **16** stamp an `AUTO-GENERATED` /
`DO NOT EDIT` banner into a committed artifact. **5** of those 16 carry any
affordance for asking *"is the committed copy current?"* — a `--check` mode, a
`writeIfChanged`, or a compare-before-write. The other **11** — including
`generate-command-names.mjs`, `i18n/gen-types.mjs`, `docs/gen-tour-anchors.mjs`,
`generate-template-checksums.mjs`, `events/generate-connector-events.mjs` —
can only overwrite. You cannot ask them a question; you can only run them and
diff afterwards, which is a different and weaker thing.

And of those 5, the one that does the strongest form — regenerate in memory,
byte-compare against the committed file, exit non-zero on a difference — is
`scripts/census/build-golden-path-index.mjs --check`. Here is what consumes it:

```js
// scripts/census/check-corpus-integrity.mjs:227-237
const gen = spawnSync(process.execPath,
  [path.join(ROOT, 'scripts/census/build-golden-path-index.mjs'), '--check'], …);
// <-- PROMOTION POINT: `if (gen.status !== 0) fail(...)` instead of logging.
if (gen.status !== 0) {
  console.log('  advisory: golden-path index is STALE (corpus integrity is unaffected).');
  …
}
```

The exit code is read, tested, and **printed**. The one gate in the repository
that performs a true byte-comparison between a generator and its committed
output has its verdict routed to `console.log`. The choice is deliberate and
documented — a freshness failure inside the composition wave's own loop would
redden that loop over a bookkeeping artifact — and it is still the case that the
strongest instrument here is the one whose answer nothing acts on.

Everything else in the repository is a **diff-shaped** gate, and a diff cannot
see three of the four things that go wrong:

| what can go wrong | can `git diff` see it? | gates in this repo that can |
|---|---|---|
| the committed artifact is **stale** | yes, after you regenerate | `binding-drift`, `command-name-drift`, `gen-shared-catalog --check`, `gp-index --check` |
| the artifact is **new and untracked** | **no** — `git diff --quiet` exits 0 for an untracked file | **exactly one**: `ci.yml:426-431` |
| the artifact is an **orphan** — its generator no longer emits it | **no** — no diff, no untracked file, nothing | **two**, and neither is a gate: `check-command-contract.mjs`, `build-golden-path-index.mjs:636-662` |
| the two artifacts **agree with each other and not with reality** | **no, by construction** | none |

Row 2 was closed for bindings on 2026-08-14 by adding
`git ls-files --others --exclude-standard src/lib/bindings/` beside the diff.
**That fix did not travel.** `.gitlab-ci.yml:159-173` is the same gate, in the
same repository, still carrying all four of the defects `ci.yml` documents
fixing:

```yaml
# .gitlab-ci.yml:165-173
- cargo test --manifest-path $CARGO_MANIFEST export_bindings 2>/dev/null || true
- |
  if ! git diff --quiet src/lib/bindings/; then
    …
    exit 1
  fi
  echo "Bindings are up to date."
```

No `--workspace` (so ~200 `#[ts(export)]` types in `personas-core` never
regenerate). No `--features desktop` (so the tauri build script aborts on
`Permission updater:default not found` before compiling anything). `2>/dev/null
|| true` (the exact wrapper `ci.yml:398-403` documents removing because it
"silently masked Rust-side breakage"). And `git diff --quiet` alone. Each of
those four is separately sufficient to make the job print
`Bindings are up to date.` while checking nothing.

**A drift gate that drifted from its own mirror** is the leaf in one sentence.

Row 3 is where the real damage is, because nothing anywhere looks. Measured at
`afb295187` with an instrument that self-tests its matcher (§12.3):

> **31 of 1,032 files in `src/lib/bindings/` have no Rust definition site.
> 28 are still referenced from `src/`. 23 are still the declared return type of
> a live `invoke<>`.**

ts-rs never deletes. A type whose Rust source is removed leaves its `.ts` file
behind forever, and that file produces **no diff and no untracked file** — so
`binding-drift`, even fully repaired, is blind to it by construction. The
repo's own `scripts/check-unused-bindings.sh` exits 1 with 98 findings and
*protects* 26 of these, because they are imported. Among them:
`invoke<VaultStatus>("vault_status")` against a Rust function returning
`serde_json::Value`, with no `VaultStatus` type in any of 963 `.rs` files.

The same shape one layer over: **`src/lib/commandNames.overrides.ts` declares 18
"planned or dead" commands, and 18 of 18 name a Rust function that does not
exist.** Measured by indexing `fn <name>` over all 963 tracked `.rs` files. The
file's own header says *"when a command is implemented … remove it from this
list"*, which describes a maintenance ritual for a list that has drifted to
100% dead. `command-name-drift` (`ci.yml:320-341`) diffs this very file and
passes, because the file is not *stale* — it is *wrong*, and a diff cannot tell
those apart.

Row 4 is the deepest one and the corpus has already named it: **codegen
guarantees that the two mirrors agree with each other, not that either agrees
with reality.** The tour-anchor generator emits a JSON file and a `.rs` file
that are byte-consistent and 127 anchors behind the tree, because it is wired
into nothing. Both halves pass every check you could write over the pair.

---

## 2. The one way (compact)

**Prove freshness by regenerating and comparing — never by diffing — and pair
every comparison with an inventory of what should exist, because a diff is
blind to an absence.** Concretely: give the generator a `--check` mode that
builds its output in memory and byte-compares it against the committed file,
make the artifact deterministic (sorted keys, no timestamps, no commit hashes,
LF) so that comparison is a byte test rather than a heuristic, and **register
that `--check` in more than one place** — registration, not a
compare-before-write guard, is what predicts whether a generated artifact is
fresh (14/14 versus 1/4). Then act on its exit code: an advisory that only
prints is a measurement, not a gate, and the difference is the whole of §0.
When you must fall back to `git diff`, always write
`git ls-files --others --exclude-standard <dir>` beside it — a diff exits 0 for
a brand-new file, which is exactly the case a drift gate exists for — and know
that even the pair cannot see an orphan: for that you need the *inventory*
direction, walking the committed artifacts and asking which no longer have a
source, which is the only way the 31 orphan bindings and the 18 dead command
overrides are findable at all. And before you trust any of it, **give the
instrument a precondition that fails loudly when it finds nothing to compare** —
because a parity checker handed an empty set reports perfect agreement, which is
the failure mode §7-A demonstrates by execution and §9 ratchets.

Two things this does **not** buy you, and you must say so rather than imply
otherwise. A gate over two artifacts generated from **one** source can only
prove the copy is current; it says nothing about whether the source is right —
the tour-anchor pair is byte-consistent and 127 anchors stale. And a parity test
that ships its fixtures beside the artifact it tests is a **third copy, not a
check**: edit the ladder and its fixtures together and both suites stay green.
Ask of every drift instrument, *what edit would this fail on?* — and if the
answer is "an edit to only one side", verify that something in the world
actually edits only one side.

---

## 7. Deviations found

### A. A parity gate that reports perfect agreement over an empty set — proven by execution

`scripts/i18n/check-coverage.mjs` is the repository's most-wired cross-artifact
gate: `en.json` against 13 sibling locales, run at **pre-commit** (`lefthook.yml:37-39`,
`--strict`), at **pre-push** (`:77-78`), and in **CI** (`ci.yml:120-126`). It is
the gate behind the operator's non-negotiable *"no English mixed into a
non-English UI"* rule.

It resolves its inputs with `readdirSync(LOCALES_DIR)` (`:71`) and guards
exactly one thing (`:75-78`): that `en.json` is present.

Copy `en.json` alone into an empty `src/i18n/locales/`, run the strictest form,
and:

```
$ node scripts/i18n/check-coverage.mjs --strict
i18n coverage check — 19112 keys in en.json

Lang  | Keys   | Missing | Extra
------|--------|---------|------
$ echo $?
0
```

**Thirteen locale files gone, `--strict`, exit 0, empty table.** Nothing in the
output distinguishes that from the real tree, which also exits 0 (19,112 keys ×
13 locales, 0 missing / 0 extra — CLAUDE.md's figure, re-verified here).

This is the contract's fail-loud requirement stated as a live instance:
*"a gate that no-ops is worse than no gate, because it manufactures
confidence."* And it is not one script's oversight — §9 measures **17 of 28**
enumerate-and-can-fail scripts in this repository with the same hole.

**A cleared claim, recorded because a cleared claim is worth as much.** The
directory walk is *also* this gate's best property: because it enumerates rather
than reading a hardcoded list, a brand-new untracked `pt.json` **is** picked up
and shape-checked. That is the inventory shape §2 asks for, arrived at
independently, and the sibling sweep found the same design in `personas-web`'s
`check-i18n-coverage.mjs:41-47`. The defect is the missing floor, not the walk.

### B. The untracked-file fix did not travel to the second copy of the same gate

Detail in §0. `ci.yml:426-431` is the only gate in the repository that pairs
`git diff` with `git ls-files --others`. `.gitlab-ci.yml:159-173` is the same
gate with none of the four repairs. Nothing compares the two CI definitions, and
they are themselves a cross-artifact pair that must agree.

### C. 31 orphan bindings, 28 imported, 23 the return type of a live `invoke`

Full list in the instrument output; the shape is in §0. Two independent
implementations (mine and a second sweep run separately this session) agree on
**31**, and on **23** invoked. They differ by one on "still imported" — 28
against 27 — a definitional difference over type-only re-exports, not a matcher
disagreement.

The three genuinely unreferenced ones (`StartPhase`,
`TemplateAdoptConfirmResult`, `TemplateAdoptStartResult`) are the *easy* case.
The other 28 are the hard one: they are imported, so
`scripts/check-unused-bindings.sh` — the one instrument that walks this
directory — **protects** them. An orphan that is still used looks exactly like a
binding that is working.

### D. 18 of 18 `commandNames.overrides.ts` entries are dead, and the gate over that file passes

Detail in §0. Note the mechanism: `command-name-drift` regenerates
`commandNames.generated.ts` and diffs **both** it and `commandNames.overrides.ts`
(`ci.yml:336`). But `generate-command-names.mjs` does not *write* the overrides
file — it is hand-maintained. So the gate diffs a hand-written file against
itself and always passes. **A gate can only prove the property its generator
produces**, and half of what this one diffs has no generator.

### E. Eleven of sixteen generators cannot answer whether their output is current

Counts in §0. This condition already has a census rule —
`unverifiable-generated-artifact` (10 files / 10 matches, → `codegen-task-registration.md`) —
and that path owns it. Recorded here only because it is the upstream cause of
this leaf: a gate that must first run a generator that can only overwrite is
forced into the diff shape, with all of the diff shape's blindness.

### F. The corpus's own tooling is the freshest instance, and it is the well-behaved one

Run directly, never through a pipe, at `afb295187`:

```
node scripts/census/build-golden-path-index.mjs --check   ; exit=0
node scripts/census/check-corpus-integrity.mjs            ; exit=0
```

Both green **now**. Earlier in this same session, with a parallel composition
wave publishing documents, `--check` exited **1** — the index was stale against
a tree that had gained new paths minutes before. Both measurements were correct
when taken, and the pair is the argument for §0's point: the instrument works,
it detects real staleness within minutes, and its verdict is `console.log`.

`build-golden-path-index.mjs` is otherwise the model to copy and the reason §2
is written the way it is: deterministic output (sorted keys, no timestamps, no
commit hashes, LF), a real `--check` byte comparison, **three** registration
points, its own floors, and a cross-artifact inventory that exits 2. It is the
only artifact in the repository whose freshness is over-determined rather than
hoped for.

---

## 9. The missing gate

The condition §7-A demonstrates — **a gate that treats "found nothing" and
"looked at nothing" as the same success** — is countable, partitions its
population cleanly, and is the precondition every other gate in this document
silently assumes. Ratchet it.

**Overlap, measured at the SITE level against the FINAL pattern** — not at file
level and not against a draft, both of which understate (§12.8 records that I
published an estimate here before measuring it, and the estimate was wrong).
The two neighbours sharing `roots` were run in the same registry as this rule
and their match sets intersected:

| against | shared sites | of 17 |
|---|---|---|
| `unverifiable-generated-artifact` (roots `scripts`, same extensions — keys on a generated-banner emitter with no `--check`) | **0** | 0% |
| `machine-specific-path-in-tooling` (roots `scripts`, `.ai` — keys on a hardcoded home directory) | **1** (`scripts/studio-mk-live.mjs`) | 6% |
| its own positive control | **0** | 0% — a clean partition, confirmed empirically rather than assumed |

`unverifiable-generated-artifact` returning **0** shared sites is the
informative one: the two conditions looked adjacent (same roots, same
extensions, both about scripts that cannot answer a question) and are in fact
disjoint — one is about *emitting* an artifact you cannot verify, the other
about *reading* an input set you cannot distinguish from empty. Also checked and
non-overlapping by roots: `comment-kept-cross-language-mirror` (roots `src`),
`unlooking-lint-rule` (roots `eslint-rules`).

**Validated in a private scratch registry, then re-extracted from this finished
document and re-run. Identical both times: 17 files / 17 matches, positive
control 11 files / 13 matches, 167 files walked, floor 120.** The gate and the
control together partition 28 of the 167 walked files — every script that
enumerates a directory *and* can exit non-zero — into 17 that never refuse an
empty enumeration and 11 that do.

```json
{
  "id": "gate-without-empty-input-guard",
  "goldenPath": "docs/concepts/golden-paths/cross-artifact-drift-gate.md",
  "roots": ["scripts", ".ai"],
  "extensions": [".mjs", ".js", ".cjs"],
  "signal": {
    "pattern": "^(?![\\s\\S]*(?:\\.length\\s*(?:===?\\s*0|<\\s*\\d)|!\\w+\\.length|\\.size\\s*(?:===?\\s*0|<\\s*\\d))[\\s\\S]{0,220}?process\\.exit\\(\\s*[1-9])(?=[\\s\\S]*process\\.exit\\(\\s*[1-9])[\\s\\S]*?\\b(?:readdirSync|globSync)\\s*\\(",
    "flags": "g",
    "description": "A script that enumerates a directory and can exit non-zero, but never refuses an EMPTY enumeration — so 'found nothing' and 'looked at nothing' both exit 0. Proxy for the contract's fail-loud requirement; the earning case is check-coverage.mjs reporting 0 missing / 0 extra with 13 of 14 locales absent."
  },
  "baseline": { "files": 17, "matches": 17 },
  "floor": 120
}
```

```json
{
  "id": "gate-without-empty-input-guard-positive-control",
  "goldenPath": "docs/concepts/golden-paths/cross-artifact-drift-gate.md",
  "roots": ["scripts", ".ai"],
  "extensions": [".mjs", ".js", ".cjs"],
  "signal": {
    "pattern": "(?=[\\s\\S]*\\b(?:readdirSync|globSync)\\s*\\()(?=[\\s\\S]*process\\.exit\\(\\s*[1-9])[\\s\\S]*?(?:\\.length\\s*(?:===?\\s*0|<\\s*\\d)|!\\w+\\.length|\\.size\\s*(?:===?\\s*0|<\\s*\\d))[\\s\\S]{0,220}?process\\.exit\\(\\s*[1-9]",
    "flags": "g",
    "description": "POSITIVE CONTROL — the compliant form: the same enumerate-and-can-fail scripts that DO refuse an empty input set (check-csp-hosts.mjs, check-corpus-integrity.mjs, check-doc-map-paths.mjs, build-golden-path-index.mjs, …). Partitions the same 28-file population as the gate above."
  },
  "floor": 120
}
```

**Which condition the signal is a proxy for**, so an adopting repo can re-derive
its own: *a verification instrument whose input set can be empty without that
being an error.* The proxy here keys on `readdirSync`/`globSync` + a non-zero
`process.exit` + the absence of an emptiness test, which is this repository's
Node idiom. In another stack the same condition wears different clothes — a
`glob.glob()` with no `assert files`, a `WalkDir` with no `ensure!(!paths.is_empty())`,
a test suite whose collector silently matches zero tests. **Key on the semantic
condition, not on this markup**; the portability test found four §9 signals that
scored zero true positives in a sibling because they keyed on the shape a
deviation happened to wear in one repo.

**Precision, hand-verified, both arms.** All 6 of the checker-named violating
sites were opened and confirmed:

- `i18n/check-coverage.mjs:71-78` — guards only that `en.json` exists; §7-A
  executes the consequence.
- `check-bundle-budget.mjs:39-45` — catches a *missing* `dist/assets/`, but an
  **empty** one gives `files = []` and every budget passes trivially. CI runs it
  with `if: always()`, so it also runs after a failed build.
- `check-command-contract.mjs`, `check-literal-parity.mjs`,
  `verify-onnxruntime-bundling.mjs`, `.ai/doctor.mjs` — same shape.

All 3 checker-named control sites confirmed carrying the idiom:
`check-corpus-integrity.mjs:75-84` (`leaves.length < 200` → exit 2,
`pathFiles.length === 0` → exit 2), `check-csp-hosts.mjs:152-159`,
`check-doc-map-paths.mjs:45-47`.

**Two independent implementations, zero disagreement** on the guard test: a
whole-text regex, and a statement-with-consequent scan that requires a non-zero
exit within a 6-line window of the emptiness test. Both returned the same 17/11
split.

**Known recall gap, stated rather than chased.** The `process.exit(\s*[1-9]`
arm misses a script that fails via `process.exit(code)`, a ternary, or
`process.exitCode`. `.ai/doctor.mjs:122` is `process.exit(fails > 0 ? 1 : 0)` —
it is in the violating set only because it *also* has a literal exit elsewhere.
Widening the arm would add recall and cost precision (`throw new Error` appears
in every helper). The doctrine's rule applies: a vocabulary-bounded signal's
recall is bounded by its author's list, and the honest move is to publish the
bound.

**Not gateable by the census, and named as such.** The three largest findings in
this document are absences — 31 orphan bindings, 18 dead command overrides, and
`.gitlab-ci.yml`'s green-when-broken clone. The census ratchets a count of
something *present*; it cannot say "no committed binding lacks a source" or
"these two CI definitions agree". Those need the **inventory** direction, and
this repository already has two of them (`check-command-contract.mjs`,
`build-golden-path-index.mjs:636-662`) — neither wired to fail. The specified
follow-up is one line each: promote `check-corpus-integrity.mjs:232` from
`console.log` to `fail()` once the composition wave pauses (the source already
marks the spot), and add the orphan direction to
`scripts/check-unused-bindings.sh`, which today walks the same directory for the
opposite question.

---

## 12. Corrections to the brief

**§12.1 — `convergence: mixed` is *partially upheld*, which makes it the second
spine convergence label to survive.** Swept across all five siblings, and the
result splits by clause exactly as `mixed` predicts:

- **The `git diff`-exits-0-on-untracked hole does not exist anywhere else — and
  not because anyone solved it.** Zero uses of `git diff --exit-code`,
  `git diff --quiet`, `git status --porcelain` or `git ls-files --others` in any
  gate, hook, or workflow across all five repos. **No sibling built a
  codegen-drift gate at all.** The hole is absent by luck, not design, and this
  is a 5/5 silence.
- **The inventory shape was independently reinvented.** `personas-web`'s
  `check-i18n-coverage.mjs:41-47` uses `readdirSync` over the locale directory
  for the same reason this repo's does, so a new locale file is picked up by
  construction. Same mechanism, same rationale, no shared document — physics,
  with the one-author discount.
- **The strongest form is `brainiac`'s and it is better than ours.**
  `crates/brainiac-server/src/openapi.rs:425-440` — `committed_document_is_current`
  regenerates the OpenAPI document from its `utoipa` annotations and asserts
  byte-equality (EOL-normalized) against the committed `openapi.json`, as a
  **Rust unit test**, wired into `cargo test --workspace` at `ci.yml:40`. It
  needs no git, no `--check` flag, and no separate CI job, and it cannot be
  routed to `console.log`. **That is the answer this leaf should adopt**, and it
  is the reverse of the usual finding: a sibling is ahead.
- **And `brainiac` supplies the counter-evidence in the same breath.**
  `console/package.json:13` declares `gen:api` (`openapi.json` →
  `api-schema.d.ts`) and it appears in **no** CI file. Seven agent-instruction
  files ask for the regeneration; zero machines check it. **A gate on rung 1
  makes the whole chain feel covered** — the same illusion `command-name-drift`
  produces here by diffing a file half of which has no generator (§7-D).

So: physics on the inventory shape, silence on the diff hole, and a sibling
ahead on the strongest mechanism. `mixed` holds, and it holds for reasons the
label could not have contained.

**§12.2 — `sides: "server"` with `twoSided: true` is internally contradictory,
and `server` is right.** The spine object carries both. Every artifact pair,
every gate, every deviation and the census rule are server-side or
build-tooling; the frontend's only contribution is *being* one half of a pair
(`src/lib/bindings/`, the locales) and it does not participate in the checking.
`twoSided: true` describes the *artifacts*, not the *situation*, and reading it
as the latter would have scoped this brief toward a client half that does not
exist.

**§12.3 — my first orphan measurement reported `0 still imported` and the answer
is `28`, and the cause is a hazard the doctrine already records.** The
instrument was `new RegExp("\\bName\\b")` written inline in `node -e '…'` under
MSYS. A backslash level was lost, the pattern became `<BACKSPACE>Name<BACKSPACE>`,
and it matched nothing — while `String.includes` on the same string returned
`true`. **The failure was silent, produced a clean round number, and agreed with
no prior claim**, so nothing about the output looked wrong; it was caught only by
hand-checking one name (`GitLabJob`, imported at `src/api/system/gitlab.ts:9`
and the declared type of an `invoke` at `:100`). The doctrine's mechanic —
*"regex patterns go in a file, never in bash argv and never in a heredoc; MSYS
mangles backslashes; a heredoc once collapsed `\b` into a literal backspace"* —
is now earned twice, in two different shells, and the rewritten instrument
**asserts its own matcher against a known-good line before trusting it**.

**§12.4 — a second implementation reported `16 of 18` dead command overrides;
the answer is `18 of 18`, and the difference is a substring match.** The two
survivors were `dev_tools_move_context`, which matches the *different* function
`dev_tools_move_context_to_group` (`contexts.rs:194`), and
`dev_tools_cancel_task`, which matches `dev_tools_cancel_task_execution`
(`task_executor.rs:859`). Both "alive" verdicts were substring-for-structure
errors. I made the identical mistake in the same session in the other direction:
my first checker-name pattern matched `generate-template-checksums.mjs` because
`checksums` contains `check`. **Two implementations disagreeing is the finding;
which one is right still has to be settled by hand.**

**§12.5 — the brief said "the corpus's own new tooling is your freshest
evidence", and it is — but not in the direction implied.** The implication was
that fresh tooling would be the instructive *failure*. It is the instructive
*success*: `build-golden-path-index.mjs` is the only artifact in the repository
whose freshness is over-determined — deterministic bytes, a real `--check`,
three registration points, its own floors, and an inventory that exits 2. The
finding is not that it is broken; it is that **the repository's single best
drift instrument has its verdict routed to `console.log`**, and the source file
marks the exact line where that would change.

**§12.6 — two of my own measurements moved during composition and both are
reported at the commit they were taken.** `gp-index --check` exited **1**
mid-session and **0** at `afb295187`, because a parallel composition wave was
publishing paths and then regenerated the index. Neither reading is wrong; the
gate is doing its job on a minutes-scale clock. Reporting only the later one
would have understated how fast this pair drifts.

**§12.7 — this composer did not write the batch's first leaf.**
`docs/concepts/golden-paths/commit-path-gates.md` (973 lines) was found finished
on disk, written by a parallel session minutes earlier. Per the runbook —
*"always check the disk before re-dispatching"* — it was left untouched, and the
measurements this session took against that leaf are reported upward rather than
edited into another session's in-flight file. One of them **contradicts** the
published document's Gap 3; the detail is in the report, not here, because a
correction owed to a path belongs in that path.

**§12.8 — I published an overlap number before measuring it, and it was wrong.**
The first draft of §9 asserted *"site overlap with `unverifiable-generated-artifact`:
2 of 17"*. That figure was an estimate from reading the two patterns, not a
measurement. Both rules were then run in one registry and their match sets
intersected: the true answer is **0 of 17**. The doctrine's rule —
*measure overlap at the SITE level, against the FINAL pattern* — exists because
a composer once published a clean overlap table computed at file level against
an intermediate draft, and found afterwards that its finished rule matched the
same 5 declarations in the same 2 files as an existing rule. I reproduced the
*shape* of that error (an unmeasured number in a published table) and caught it
only by running the comparison the doctrine mandates. **The correction moves the
decision the same way it would have moved it wrongly** — 0% overlap is a
stronger case for the rule than 12% — which is precisely why an unmeasured
number that supports your conclusion has to be measured.

**§12.9 — the re-extraction round-trip found nothing wrong, and that is the
point of running it.** The rule was validated in a private scratch registry,
then extracted back out of this finished document with the same
`extractPublishedRules` instrument `merge-published-rules.mjs` uses, and re-run:
2 fenced blocks, 2 rules, 0 skipped, 0 unparseable, and identical counts
(17/17, 11/13, 167 walked). A lost rule looks exactly like a rule nobody wrote,
and a CRLF rewrite has silently produced that state in this corpus before.
