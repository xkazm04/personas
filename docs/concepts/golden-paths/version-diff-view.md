# Version diff view

> Situation node: `product-surfaces/authoring-and-catalogs/version-diff-view` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **medium** ·
> dimensions: ui · performance · function · `sides: "client"` ·
> `twoSided: false` · `convergence: "mixed"`
>
> *"Showing exactly what changed between two versions before the user commits."*
>
> **Short form** (Mode 2 tiering: `medium` risk, recurrence < 9). Prose is
> compressed; measurement is not. Composed 2026-08-17 from a sweep of `src/`
> (4,801 `.ts`/`.tsx`), `src-tauri/` (963 `.rs`), both `Cargo.toml` sets and
> `package.json`, plus **executed replays** of four diff kernels transcribed
> verbatim from source, and payload statistics from the pre-purge backup
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`.
>
> Row-derived numbers are historical as of 2026-08-17 (the purge deleted all 78
> personas) and unreproducible from the live file.

---

## §0 Headline

**The repo has four hand-written diff kernels and zero diff libraries — no
`diff`/`jsdiff`/`diff-match-patch`/`jsondiffpatch`/`microdiff` in `package.json`,
no `similar`/`diffy` in any `Cargo.toml`. One of the four is genuinely good. The
one that renders a persona's version history normalizes its two sides through a
function that reads five of the seven fields a structured prompt can hold — and
when the only change is in one of the two it drops, the surface prints "No
structural difference."**

`DiffViewer.tsx:14-16` normalizes both versions with `getSectionSummary`
(`src/lib/personas/promptMigration.ts:255`), which iterates
`STANDARD_SECTION_KEYS` — `identity, instructions, toolGuidance, examples,
errorHandling`. A `StructuredPrompt` also carries `customSections` and
`webSearch` (`createEmptyStructuredPrompt`, `promptMigration.ts:70-80`). Neither
reaches the diff. The empty state at `DiffViewer.tsx:54` then re-walks *the same
five keys* and, finding them equal, renders `t.agents.lab.no_structural_diff`.
`DraftDiffViewer.tsx:24` has the identical blind spot, reached by a different
route (it maps `STANDARD_SECTION_KEYS` directly).

**Measured honestly: this is latent, not observed.** Parsing all 73 non-null
`personas.structured_prompt` values in the backup: **0 have a non-empty
`customSections`, 0 have a non-empty `webSearch`**, 0 fail to parse. The editor
can create both; nobody on this install has. So the finding is *a normalization
that can affirmatively deny a change it cannot see* — not a user who has hit it.

The second, measured, present-today finding is the JSON side. `jsonDiff`
(`comparisonHelpers.ts:74`) compares `JSON.stringify(objA[key] ?? null)` against
`JSON.stringify(objB[key] ?? null)` — **unsorted, one level deep**. Replayed
verbatim:

| input | reported |
|---|---|
| `{"input":{"topic":"x","tone":"brief","locale":"en"},"seed":1}` vs `{"input":{"locale":"en","tone":"brief","topic":"x"},"seed":1}` | **1 change** — semantically identical, key order only |
| `{"input":{"topic":"x"}}` vs `{"input":{"topic":"y"}}` | 1 change, `path = "input"` — never `input.topic` |
| `{"a":1}` vs `{"a":1,"b":null}` | **0 changes** — `?? null` collapses "absent" and "explicitly null" |
| `"1.0"` vs `"1"` (non-object roots) | 1 change at `(root)` |

Nowhere in 4,801 files is `JSON.stringify` given a replacer that sorts keys, and
nowhere is `Object.keys(x).sort()` applied on any comparison path. Two
independent implementations agree on that.

---

## §2 The one way (compact)

**Normalize both sides through one function, compare structure before text, and
put the cost ceiling in the algorithm rather than in a comment.** Concretely:

1. **Normalize once, and name what normalization drops.** Both sides go through
   the *same* projection, and the projection is derived from the type's own key
   set — not from a hand-written constant list that can fall behind the type. If
   you must use a fixed list, the "nothing changed" branch must be computed over
   the **whole object**, never over the projection, so an unseen change can never
   render as an affirmative "no difference".
2. **Never decide equality with `JSON.stringify` on both sides.** Key order is
   insertion order in JS and survives a `JSON.parse` round trip, so a value from
   the database and an object literal built in the same shape are unequal by
   bytes and equal by meaning. Compare key-by-key, or serialize through a
   canonicalizing stringifier used by both sides.
3. **Diff at the smallest unit the user edits, one level up from where you
   render.** For a sectioned prompt that is the section, then tokens within it.
   Structural comparison first (which keys exist, which differ), text diff only
   inside the keys that actually differ — `DiffViewer.tsx:29` and
   `InlineDiffPreview.tsx:29` both do this and it is why they stay cheap.
4. **Put a cell ceiling in the kernel and degrade in tiers.**
   `labPrimitives.ts:25` — `MAX_DP_CELLS = 250_000`, then token-LCS → line-LCS →
   all-removed+all-added. A comment asserting *"typically <100 lines"* is not a
   ceiling; `PromptDiffModal.tsx:34` says exactly that and allocates an
   unbounded `(m+1)×(n+1)` matrix.
5. **Strip the shared prefix and suffix before the DP.** `diffWithStrip`
   (`labPrimitives.ts:68`) is what makes a one-word edit in a 1,000-word prompt
   cost 1.1 ms instead of degrading — replayed, see §7 D3.
6. **Memoize the kernel, and virtualize the render.** A diff produces one node
   per unit by construction; at this repo's real prompt sizes that is thousands
   of DOM nodes. If you will not virtualize, cap the units.
7. **Compute server-side when the delta is already a row.** Two surfaces here do
   it right (`get_execution_data_diff`, `dev_tools_get_competition_slot_diff`) —
   see §7 D6 for the one that then picks its answer by string length.

---

## §7 Deviations

The complete diff inventory: **4 client kernels, 2 server-computed deltas, 2
write-time persisted deltas, 7 Rust delta computations with no diff UI.** Every
one was opened.

### D1 — P0. The normalization drops two fields, and the empty state asserts their absence is equality

`DiffViewer.tsx:14-16` → `getSectionSummary` → `STANDARD_SECTION_KEYS` (5 of 7
fields). `DiffViewer.tsx:54`:

```tsx
{allKeys.every((key) => (sectionsA[key] ?? '') === (sectionsB[key] ?? '')) && (
  <p …>{t.agents.lab.no_structural_diff}</p>
)}
```

`allKeys` is the union of the *projected* keys, so a version pair differing only
in `customSections` or `webSearch` renders an affirmative denial. Same blind spot
at `DraftDiffViewer.tsx:24` (`STANDARD_SECTION_KEYS.map(...)`) and
`InlineDiffPreview.tsx:21-22` (`getSectionSummary` ×2 — its word-delta counts
silently exclude the two fields).

Live instances: **0 of 73** parsed persona prompts populate either field.
Latent by measurement, real by construction. The type-level fix is §9's decline
rationale.

### D2 — P0. Equality by unsorted `JSON.stringify`, 6 sites, one of them a diff kernel

`comparisonHelpers.ts:85-86` is the kernel behind `ComparisonDiff`'s
`JsonDiffSection` — the surface that shows what changed between two executions'
input and output payloads. The other five are dirty-state and change-detection
flags:

| site | what it decides | consequence of a key-order difference |
|---|---|---|
| `comparisonHelpers.ts:85` | the JSON half of execution comparison | a payload reported as changed when it is not |
| `matrixBuildSlice.ts:702` | `'updated'` vs `'resolved'` cell badge | a user-visible "this changed" badge; `oldItems` is from the store, `newItems` from `JSON.parse` of an event — the highest-risk pairing in the set |
| `CustomThemeCreator.tsx:114` | `isDirty` for a custom theme | `existingConfig` is parsed from storage, `draftConfig` is an object literal — different construction orders |
| `parameterEditing.tsx:101` | per-parameter `isDirty` | spurious dirty |
| `parameterEditing.tsx:102` | per-parameter `isDefault` | a value equal to its default renders as overridden |
| `test/automation/bridge.ts:936` | a harness assertion on store state | a test that can fail on serialization order |

Hand-verified 6/6. Two are user-visible today.

### D3 — P1. One kernel is guarded; the guard's real behaviour is not what the constant suggests

`diffStrings` (`labPrimitives.ts:113`) checks `tokensA.length * tokensB.length <=
250_000` **before** stripping, then re-checks the stripped middle, then falls to
`diffByLines`, which has its own ceiling and finally emits all-removed +
all-added. Replayed on a one-word mid-prompt edit:

| words/side | entries | non-`same` | ms | verdict |
|---:|---:|---:|---:|---|
| 200 | 400 | 2 | 2.0 | useful |
| 250 | 500 | 2 | 0.5 | useful |
| 500 | 1,000 | 2 | 0.7 | useful |
| 1,000 | 2,000 | 2 | 1.1 | useful |

**My own first hypothesis was wrong and the replay refuted it.** I predicted
degradation to "everything removed, everything re-added" above ~250 words for a
single-paragraph prompt, and produced a run that appeared to confirm it — with a
fixture in which the two sides shared *no* tokens at all. On a realistic edit the
prefix/suffix strip absorbs the whole cost and the guard never fires. The
degradation is real but its precondition is a *rewrite*, not an edit. Recorded
because the wrong version agreed with my thesis, which is the doctrine's stated
condition for re-running a measurement.

### D4 — P1. The other three kernels are unguarded, and one is unguarded with a comment saying it is fine

`PromptDiffModal.tsx:34` — *"Line-level LCS — small enough for prompts (typically
<100 lines)"* — then allocates `(m+1)×(n+1)`. Replayed verbatim:

| lines/side | DP cells | ms | `<pre>` elements rendered |
|---:|---:|---:|---:|
| 100 | 10,201 | 3.4 | 200 |
| 500 | 251,001 | 13.7 | 1,000 |
| 1,000 | 1,002,001 | 43.3 | 2,000 |
| 2,000 | 4,004,001 | 191.5 | 4,000 |
| 4,000 | 16,008,001 | **610.6** | **8,000** |

All on the render thread, inside a `max-h-[60vh]` scroller, two `<pre>` per line
(`:185-190`), no virtualization. `summarizePromptDiff` (`:75`) calls it once per
comparison slot in a loop. `conflictDiff.ts:19` (obsidian sync) has no ceiling
either and pushes the decision to callers in its own docstring (`:16-17`); its
one caller supplies a 6,000-character slice (`ConflictDiffView.tsx:6,32`) — a
char cut that can land mid-line, which is a truncation the LCS then reports as an
edit.

### D5 — P1. Render cost, sized against real prompts

`DiffViewer.tsx:30` calls `diffStrings` **inside the JSX map body**, not in a
`useMemo` — so every re-render (parent state, a lazily-arriving i18n section, a
tooltip) re-runs the full LCS for every changed section. `DraftDiffViewer.tsx:18`
memoizes correctly; `InlineDiffPreview.tsx:20` memoizes and then runs a full LCS
purely to `.filter().reduce()` two word counts out of it (`:36-38`), once per
timeline entry.

Real sizes, from the backup: **297 non-empty standard sections across 73
personas — p50 154 words, p90 412, max 782.** `diffStrings` splits on `/(\s+)/`
(a capturing group), so span count ≈ 2× word count: a p90 section is ~824
`<span>` elements, a max section ~1,564, unvirtualized, per changed section.
`ComparisonDiff.tsx:109-139` is worse in kind: the reduce that builds the rows
runs **inside JSX** on every render, while the streaming worker appends with
`setDiff(prev => [...prev, ...chunk])` at `chunkSize: 50` (`:67`, `:162`) —
O(n²/50) array copies.

Only one of the eight client surfaces runs off the main thread:
`ComparisonDiff` via `comparisonDiff.worker.ts`. Its client
(`comparisonDiffWorkerClient.ts:27-28`) holds two `Map` caches keyed by an FNV-1a
content hash that are **never evicted**.

### D6 — P2. The two server-computed deltas, and what each actually computes

- `get_execution_data_diff` (`commands/execution/journal.rs:23` →
  `db/src/repos/execution/change_journal.rs:255`) is **not a comparison**. It
  reads `change_journal` rows for one execution, caps them at `DIFF_ENTRY_CAP`,
  and runs an O(rows × later-writes) scan to flag `has_later_foreign_write`.
  Before-images are stored blobs, rendered as-is. Correct for its purpose, and
  the name oversells it.
- `dev_tools_get_competition_slot_diff`
  (`commands/infrastructure/dev_tools/competitions.rs:490` → `compute_slot_diff`
  `:520`) shells out to `git diff --unified=3 HEAD...<branch>`, then again for
  uncommitted work, then at `:562`:
  `let use_branch_diff = branch_diff.len() >= uncommitted_diff.len();` — **it
  picks whichever diff string is longer in bytes.** Two semantically different
  answers to "what changed", selected by length. The result is dumped into one
  `<pre>` (`CompetitionSlotRow.tsx:290-292`) with no `+`/`-` colouring at all.

### D7 — P2. A diff that is defined to report everything as changed

`memoryDiff.ts:50-55` (`computeMemoryDiff`) matches by `id`, and its own
docstring (`:47-48`) states *"memories created in different runs have different
IDs"*. Replayed: two runs whose memories are byte-identical report
`added = 2, removed = 2, unchanged = 0`. It is honest about being an
id-set-difference; it is mounted at `TeamMemoryPanel.tsx:169` and
`StreamMemoryViews.tsx:34` as a **run diff**, where the user reads "added" and
"removed" as content claims. `useRunDiffSummaries.ts:11,30` runs the same
comparison over up to **12** full memory snapshots held in the client
simultaneously.

### D8 — P2. Line normalization differs between the worker and its own fallback's siblings

`comparisonDiff.worker.ts:13-14` drops blank lines
(`.filter(line => line.trim())`) but does not trim the surviving ones, so
`"  foo"` vs `"foo"` reads as removed + added. The synchronous fallback
(`comparisonDiffWorkerClient.ts:142-143`) duplicates the same two lines — a
second copy of the normalization that nothing keeps in sync, which is exactly the
shape [`client-rule-mirroring`](./client-rule-mirroring.md) covers.
`conflictDiff.ts:20-21` and `PromptDiffModal.tsx:36-37` do a bare `split('\n')`
with no filtering at all. **Four kernels, three different whitespace policies,
none written down.**

### D9 — P2. Two surfaces named "version history" that show no diff

`RecipeVersionsTab.tsx` renders `version.changes_summary` — an LLM-authored
prose string (`commands/recipes/recipe_versioning.rs:62`) — and the full new
template; it never compares. `GitOpsVersionHistory.tsx` lists tags and commit
SHAs with a rollback button and contains no comparison code. Both are legitimate
designs; both mean the *user-facing* answer to "what changed" on those surfaces
is a model's summary and a commit hash, not a computed delta.
`VersionTimelinePanel.tsx` (skills) is a revision rail only.

---

## §9 The rule

### Declined first: a gate on unvirtualized diff rendering

The condition (§7 D5) is real and the most expensive one here, but the signal
would be *"a `.map()` over a diff result that produces one element"*, and every
list render in a 4,801-file tree wears that shape. Five true sites against a
four-figure anchor is a gate that fires on correct content. Refused.
[`long-list-rendering`](./long-list-rendering.md)'s
`unbounded-shared-table-render` owns the countable half of this concern for
tables; a diff pane is not a table and no shared primitive exists to route to
(§ Gaps, implicitly: that primitive is the real fix).

### Declined second: a gate on an unguarded DP allocation

`Array.from({length: m+1}, () => new Array(n+1))` is 3 sites. Below threshold.

### Published: `stringify-decided-equality`

**The condition the signal is a proxy for:** *two objects declared equal or
unequal by their serialized bytes, when the property the code means is semantic
equality.* In JS the proxy is `JSON.stringify` on both sides of `===`/`!==`; an
adopting repo re-derives its own (`json.dumps` without `sort_keys`,
`serde_json::to_string` compared as `String`, `Object#to_json ==`). The condition
travels; `JSON.stringify` does not.

**Why a type does not reach it.** Q1 — a required prop carries only what it
encodes: the two operands are already `string`, and `string === string` is
exactly what the author wrote and exactly what TypeScript should permit. The
defect is in the *meaning* of the strings, and no type distinguishes "a canonical
serialization" from "a serialization". A `Canonical<T>` newtype would qualify
under Q5 (withholding — hand the caller a canonicalizer instead of
`JSON.stringify`) but fails Q3: there are **zero** construction sites for such a
thing in this repo today, so the type would constrain nothing until someone wrote
the canonicalizer, and at that point the gate is what routes callers to it. Gate
now, type when the primitive exists.

**Fail-loud.** `floor: 4000` — the walk over `src/` must see at least 4,000
`.ts`/`.tsx` files (it sees 4,801). A restructure that shrinks the corpus fails
the run instead of reporting a clean zero.

**Two implementations.** (A) bespoke: a paren-balanced scan for
`JSON.stringify(…)` adjacent to a comparison operator → **5 matches / 4 files**.
(B) the census-shaped regex, which additionally matches the *paired-const* form
(`const a = JSON.stringify(x); const b = JSON.stringify(y); … a !== b`) →
**6 matches / 5 files**. **They disagreed, and the disagreement was the
finding**: implementation A misses `comparisonHelpers.ts:85` — the actual diff
kernel, the single most important site on this leaf — because it assigns the two
serializations to locals before comparing them. A rule that could not see the
headline site is a rule that reports green on the defect it was written for.
Implementation B is published.

**Hand-verified precision: 6/6.** I opened all six (table in §7 D2). Five are
production; one (`bridge.ts:936`) is the test-automation harness and is still a
true instance of the condition — a harness assertion that can fail on key order.

**Positive control** points the same anchor at serialization rather than
comparison. Anchor: **426 `JSON.stringify(` call sites in 249 files**. Violating:
**6 matches in 5 files**. Control, run from the finished document through the
census runner: **421 matches in 249 files**.

421 + 6 ≠ 426, and the residual is worth stating rather than rounding: the
violating rule's inline alternative consumes **two** call sites per match while
the control's lookahead excludes only the **left** one, so the right-hand
`JSON.stringify` of each inline pair is counted compliant. The partition is
therefore approximate by 1–5 depending on form mix, not exact. It is still doing
its job — a control at 421 against 6 confirms the violating pattern discriminates
on *comparison*, not on `JSON.stringify`.

**Site-level overlap: 0.** No rule in `rules.json` (184 rules, all read) keys on
`JSON.stringify`. The nearest neighbours key on `JSON.parse`
(`asserted-definition-blob`) and on `null`-filled update payloads
(`blank-filled-update-payload`); neither can match at any of these six offsets.

```json
{
  "id": "stringify-decided-equality",
  "goldenPath": "docs/concepts/golden-paths/version-diff-view.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "JSON\\s*\\.\\s*stringify\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\)){0,200}\\)\\s*(?:!==|===|!=|==)\\s*JSON\\s*\\.\\s*stringify\\s*\\(|(?:const|let)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*JSON\\s*\\.\\s*stringify\\s*\\((?:(?!JSON\\s*\\.\\s*stringify)[\\s\\S]){0,160}?(?:const|let)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*JSON\\s*\\.\\s*stringify\\s*\\((?:(?!JSON\\s*\\.\\s*stringify)[\\s\\S]){0,240}?(?:!==|===)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Object equality decided by JSON.stringify on both sides, in the inline form or the paired-const form. Key order is insertion order in JS and survives a JSON.parse round trip, so a value read from the database and an object literal of the same shape compare unequal. Replayed: two semantically identical payloads whose nested keys were serialized in a different order report as changed. Compare key-by-key, or serialize both sides through one canonicalizing stringifier. The paired-const alternative is load-bearing: it is the only one that sees comparisonHelpers.ts:85, the diff kernel behind execution comparison."
  },
  "baseline": { "files": 5, "matches": 6 },
  "floor": 4000
}
```

```json
{
  "id": "stringify-decided-equality-positive-control",
  "goldenPath": "docs/concepts/golden-paths/version-diff-view.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "JSON\\s*\\.\\s*stringify\\s*\\((?![^()]{0,400}\\)\\s*(?:!==|===|!=|==)\\s*JSON\\s*\\.\\s*stringify)",
    "flags": "g",
    "description": "POSITIVE CONTROL for stringify-decided-equality: the COMPLIANT form — JSON.stringify used to SERIALIZE rather than to decide equality. 420 of the 426 JSON.stringify sites in src/. Partitions the anchor: violating + compliant = every call site. A control near zero would mean the violating pattern is keying on JSON.stringify rather than on comparison."
  },
  "floor": 4000
}
```

---

## §12 Corrections

**To the brief.**

1. *"A JSON diff that does not sort keys reports noise as change; one that sorts
   them hides ordering that mattered. Establish which this repo does."* —
   **Neither, and the dichotomy is not the repo's problem.** `jsonDiff` does not
   sort, so it does report key-order noise as change (executed, §0). But it never
   reaches the ordering question, because it is **one level deep**: it stringifies
   each top-level value whole, so every nested change — including an array
   reorder — surfaces as a single change on the *top-level key*, with the entire
   old and new subtree as the two sides. There is no depth at which "did ordering
   matter" is asked. The sharper finding is the one the dichotomy conceals:
   `objA[key] ?? null` makes **"key absent" and "key present with value null"
   indistinguishable** (executed: `{a:1}` vs `{a:1,b:null}` → 0 changes).

2. *"Check whether the diff is computed client-side from two full snapshots
   (cheap to build, quadratic to render) or server-side."* — **Both, 7 to 2**,
   and the split is not by expense. Seven client surfaces hold two full snapshots
   (one holds up to twelve); two are server-computed, and *neither of those two
   is a comparison*: one is a journal read (§7 D6) and one shells out to `git`
   and then picks its answer by byte length. So the repo's server-side diffs are
   not the disciplined half — they are the half where the comparison was
   delegated to something else and the delegation was not checked.

3. *"…quadratic to render."* — **Precise correction: linear in units, not
   quadratic**, at 5 of the 8 client surfaces. What is quadratic is the *kernel*
   (DP, 3 of 4 unguarded) and `ComparisonDiff`'s streaming append
   (`[...prev, ...chunk]` at chunk size 50). The render is one node per token or
   per line, unvirtualized — which at this repo's p90 section (412 words → ~824
   spans) is an ordinary large-list problem, and worth stating as such because
   the fix is different: virtualize, don't optimize the algorithm.

**To my own first pass.** §7 D3 records a replay that agreed with my hypothesis
and was produced by a fixture that could not have disagreed with it.

**To published paths.** None contradicted.
[`client-rule-mirroring`](./client-rule-mirroring.md) gains an instance: the
worker's line normalization is duplicated verbatim in its own synchronous
fallback (`comparisonDiff.worker.ts:13-14` ↔
`comparisonDiffWorkerClient.ts:142-143`) with nothing asserting they agree.

**Oracle.** Cohort for this leaf: `personas-web` and `personas-cloud` are
excluded as port/dependent on adjacent leaves; `brainiac`, `vibeman`, `ascent`
are the independent three. **No sibling ships a diff kernel, and none imports a
diff library** — a 3-of-3 silence, which stays strong under the one-author
confound. So the four hand-rolled kernels are a **house convention**, not
doctrine, and §2's prescriptions (the cell ceiling, the prefix/suffix strip, the
tiered degradation) are labelled as such: they are what this repo learned by
paying for it once, in `labPrimitives.ts`, and did not carry to the other three.
`convergence: "mixed"` is not testable against a fleet-wide silence; recorded as
**untestable for this leaf**, which is a different outcome from the thirteen
prior failures and should not be counted with them.
