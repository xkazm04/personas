# Golden-path recall

The corpus is 174 published paths and roughly 190,000 words of measured
prescription. None of it reaches a session at the moment it matters, because a
path is found by someone remembering it exists. This file describes the tooling
that closes that loop: an index, a router, a Stop hook, a fact ledger, and a
library of instruments that have already been wrong once each.

> **Pointers from [`golden-path-doctrine.md`](./golden-path-doctrine.md),
> [`golden-path-runbook.md`](./golden-path-runbook.md) and
> [`golden-path-contract.md`](./golden-path-contract.md) into this file are a
> deliberate follow-up, not an oversight.** All three were being edited by the
> live composition wave when this was built, and adding a line to a file another
> session is writing is how a wave loses a paragraph. Add the pointers when the
> wave pauses.

---

## 1. The artifacts

Both are **generated**, both live in `docs/concepts/golden-paths/`, and both are
**deterministic** — no timestamps, no commit hashes, sorted keys, LF endings. A
no-op regeneration writes identical bytes, which is what makes `--check` a plain
byte comparison rather than a heuristic.

### `index.json` — leaf-major (4.4 MB)

Per published path:

| field | what it is |
| --- | --- |
| `leaf`, `doc` | slug and repo-relative path |
| `headline` | first paragraph of `## 0.`, emphasis stripped, ≤400 chars (falls back to the first paragraph after the H1 for the 105 docs with no §0) |
| `oneWay` | first paragraph of `## 2.`, ≤300 chars — the prescription |
| `deviations` | §7 subsection titles, or bold lead-ins where §7 is a flat list; ≤12 |
| `ruleIds` | census rule ids from the §9 fenced JSON, gate **and** positive-control |
| `ruleIdsFrom` | `section-9` \| `document` \| `none` — a silent fallback is how you stop noticing that §9 stopped parsing |
| `sections` | which numbered sections the parser actually found |
| `citationCount` | every citation, before grouping |
| `citations` | **file-major**: `resolved-path → {count, sections, lines, contexts}` |
| `triggers` | §1 bullet lines, verbatim |

### `router.json` — file-major (0.9 MB)

- `leaves` — `leaf → {doc, oneWay}`. This is the Stop hook's whole budget: it
  runs on every turn and must decide from one small file.
- `byFile` — `resolved-path → [{leaf, sections, count}]`, sorted by count desc.
  **2,834 files.**
- `byDir` — the same, rolled up two directory levels.
- `triggers` — per leaf, the §1 bullets verbatim. **Carried for future
  prompt-time matching; nothing consumes them yet.**

### What the numbers are

Measured at `2ee130c3e`:

```
174 docs parsed · 26,004 citations · 2,834 distinct cited files
24,846 citations name a file; 19,579 resolve ......... 78.8%
 1,158 are directories or globs (`src/`, `src-tauri/**`) and cannot resolve
 5,267 unresolved, dominated by AMBIGUOUS BASENAMES:
        lib.rs ×220 · executions.rs ×100 · mod.rs ×82 · Cargo.toml ×58
min 60 citations in a document · median 142 · max 277 · zero empty documents
```

An ambiguous basename is **deliberately not guessed at**. A router entry pointing
at the wrong file fires a hook on a path the corpus never discussed, which is
worse than a missing entry.

---

## 2. Regenerating

```bash
node scripts/census/build-golden-path-index.mjs          # write both artifacts
npm run gp:index                                          # the same thing
node scripts/census/build-golden-path-index.mjs --check   # byte-compare, exit 1 on drift
```

It runs in ~1.5 s against the codegen runner's 60 s per-task timeout.

**Three registration points**, because registration is the variable that
predicts whether a generated artifact is fresh (14/14 versus 1/4 for the obvious
rival, a compare-before-write guard — and the repo's own tour-anchor generator
is the cautionary case: two byte-consistent artifacts, 127 anchors behind the
tree, because it is wired into nothing):

1. **`merge-published-rules.mjs`** regenerates both artifacts at the end of every
   run. This is the composition wave's natural door — the orchestrator already
   merges once per composed path — so the artifacts stay fresh through the
   existing flow without anyone knowing they exist. It **never fails the
   merger**: the rules are already written by then.
2. **`scripts/run-codegen.mjs`** carries it as the `gp-index` task, in both the
   `predev` and `prebuild` presets. (The task registry is now **15** tasks;
   `.claude/CLAUDE.md` still says 14.)
3. **`check-corpus-integrity.mjs`** reports staleness — **advisory only**, see §5.

---

## 3. The Stop hook

`scripts/docs/check-golden-path-touch.mjs` fires when a turn edited a file that
appears verbatim in `router.json`'s `byFile` — meaning a published path cites
that exact file. Not a glob, not a heuristic, not a directory rule, so the
false-positive rate is a property of the corpus rather than of the script.

On a hit it exits 2 with up to **3** paths ranked by citation count, each
carrying its §2 first sentence, its document path, and up to **2** touched files
with the prose line that cited them. Overflow is disclosed, never dropped.
Dismissal contract, identical in spirit to the doc-sync hook: reply with one
short sentence either confirming the edit follows §2 or naming the deviation and
why it is right here.

**It is silent for:** any `.md`, `docs/**`, `scripts/census/**`,
`scripts/docs/**`, `src/lib/bindings/**`, `src/i18n/locales/**`,
`src/i18n/section-locales/**`, `**/__tests__/**`, `*.test.*`, `*.spec.*`,
`*.gen.*`, `*.generated.*`. The first four exist so **the live composition wave
never sees this hook** — that session edits paths, rules and census scripts all
day, and a nag on every one of those turns would be noise the hook would not
survive. The property is asserted directly, over the wave's whole edit set, as a
batch and file by file.

**Missing or corrupt router → one-line warning, exit 0.** Freshness is enforced
upstream. A hook that hard-failed on infrastructure absence would nag every turn
for a reason that has nothing to do with the turn.

### Registration — and the one thing that could not be committed

`.claude/settings.json` is **gitignored** (`.gitignore:70` `.claude/*`, and the
allowlist beneath it does not include it). The registration therefore cannot
travel in a commit. Append this second `Stop` entry after the existing
`check-doc-sync` one, leaving `PreToolUse` untouched:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node $CLAUDE_PROJECT_DIR/scripts/docs/check-golden-path-touch.mjs",
      "timeout": 10
    }
  ]
}
```

Do this **after** the branch reaches `master`. Registering it earlier makes every
turn of a session on `master` spawn `node` against a file that does not exist
there yet.

---

## 4. The instrument library

`scripts/census/lib/instruments/` — ESM, zero dependencies, one regression test
each under `__tests__/`, runnable as `node <file>` with a non-zero exit on
failure. Every module's header names the recorded bug it embodies, and the tests
reproduce that bug's shape rather than only asserting the fix.

| module | the bug it exists because of |
| --- | --- |
| `stripCfgTest.mjs` | Two implementations agreed on the finding and **disagreed on where it was** — one placed a site 16 lines early because its stripper ate newlines. Output is always the same length as the input. Ships `isRustTestFile()` beside it, because a brace-matched range cannot see `dev_tools_backlog_tests.rs`. |
| `extractRustStrings.mjs` | Draft 1 excluded newlines from its string class (multi-line SQL invisible: 33/22 against a truth of 141). Draft 2 used an escape class where `.` does not match a newline, so a line continuation split `ORDER BY` from its `LIMIT` (104/63). Both were regexes; this is a scanner, and it refuses to read a lifetime as a quote that never closes. |
| `matchJsxTags.mjs` | `<UnifiedTable<PersonaEvent>` closed three independent composers' scanners at the generic's `>`; one reported 2 of 17 virtualized when the truth was 6. `errPct >= 10` is the same bug from the other side. Fixed by depth tracking, not by a longer character class. |
| `extractFences.mjs` | A CRLF rewrite made the merger see **zero** fences, and **a lost rule looks exactly like a rule nobody wrote**. `merge-published-rules.mjs` imports this; behaviour is identical, asserted over three real corpus documents against the ids they contributed to `rules.json` and over the whole corpus byte-for-byte (175 docs / 232 fences / 278 ids). |
| `stripComments.mjs` | `check-csp-hosts.mjs` reported **zero** frontend fetch hosts twice, the second time because `https://` contains `//`. Two defences: a real scanner, plus the `(?<!:)` guard — belt *and* suspenders was that gate's whole lesson. |

---

## 5. What is advisory, and what would promote it

| check | today | promotion condition |
| --- | --- | --- |
| `build-golden-path-index.mjs` floors and cross-artifact inventory | **failing (exit 2)** | already a gate |
| `--check` inside `check-corpus-integrity.mjs` | **advisory** — prints, never changes the exit code | promote once (a) the composition wave is finished or paused and (b) the artifacts survive one full batch without a spurious drift report. The one-line change is marked `PROMOTION POINT` in the source. |
| the Stop hook on a missing router | **advisory** (warn, exit 0) | never; freshness belongs upstream |
| `RULES_WITHOUT_EXTRACTABLE_FENCE` (7 entries) | **enforced allowlist** — an unlisted miss is fatal *and* a listed entry that starts extracting is fatal | shrinks to zero when the four `jsonc` fences and three fence-less §9s are fixed |

The advisory choice for corpus-integrity is deliberate: it runs inside the
wave's own loop (`npm run census` is `check-corpus-integrity && run-census`), and
a freshness failure there would redden that loop mid-batch over a bookkeeping
artifact that two other registration points already keep fresh. A gate that fires
on correct content is worse than no gate, because the first fix anyone reaches
for is to delete the gate.

### The finding the inventory produced on its first run

**Seven registered census rules cannot be re-derived from the document that owns
them.** Four publish the rule in a ` ```jsonc ` fence, which
`merge-published-rules.mjs` does not read (`raw-react-lazy`,
`local-empty-state`, `deferred-read-then-write`, `silent-row-skip`); three
publish no fence at all (`raw-web-storage`, `hand-rolled-spinner`, `raw-select`,
all wave-1, predating the convention).

For those seven, the doctrine's own instruction — *"after any programmatic edit
to a finished path, re-extract the fence and confirm the rule count"* — returns
**zero**, which is exactly what a lost rule reads like. Three of the four `jsonc`
blocks parse as JSON and need one character changed; `row-to-struct-mapping`'s
does not parse at all and needs rewriting. Not fixed here: those files belong to
the live wave.

---

## 6. The fact ledger

[`shared-facts.json`](./shared-facts.json) is **schema 2**. Every fact carries
the instrument that reproduces it, the commit it was measured at, and a
`verify` level (`cheap` / `db` / `manual`).

```jsonc
"rust.tauriCommands": {
  "value": 1661,
  "instrument": "node scripts/docs/measure-shared-facts.mjs -> facts['rust.tauriCommands'] (countAttr(): …)",
  "measuredAt": "2026-08-17", "commit": "2ee130c3e",
  "leaf": "new-ipc-command.md", "verify": "cheap",
  "note": "…the instrument was counting itself…"
}
```

It also carries two structured ledgers extracted from the doctrine's own §5:
`lineage` (per sibling repo: relation, evidence, and the section that earned it,
plus the four measured per-leaf cohorts) and `spineLabels` (the `convergence` and
`sides` ledgers with their tested counts, failure modes and upholdings).

`node scripts/docs/measure-shared-facts.mjs` regenerates it. It **merges**: it
owns the 20 `verify: cheap` facts and writes `meta`, `lineage`, `spineLabels`
and any hand-added fact back untouched. It reports value deltas explicitly and
appends a delta note to anything that moved.

> **Recorded discrepancy.** `golden-path-runbook.md` step 1 still reads *"Twelve
> `convergence: converged` labels have been tested and eleven failed"* and
> *"`sides: "client"` has been contradicted by measurement on 4 of 4 leaves"*,
> where the doctrine — the later document — records **13 tested / 13 failed** and
> **7 contradicted / 2 upheld**. The ledger says to cite the doctrine. The
> runbook is not edited here; it belongs to the live wave.

---

## 7. For composers

Three habits, in the order you will need them.

**Prime the brief before you start.** Every claim the corpus already makes about
the files you are about to touch, grouped by leaf:

```bash
node scripts/census/build-golden-path-index.mjs --prime src/features/x/Y.tsx
node scripts/census/build-golden-path-index.mjs --prime-diff   # everything in `git diff --name-only HEAD`
```

This is the mechanical half of the runbook's *"prime each brief with what
neighbouring paths measured"*. It cannot tell you what a neighbour concluded —
read the §2 it prints and then read the document — but it will tell you which
neighbours exist, which is the part that gets missed.

**Import an instrument; do not write a third copy.** If you are about to strip
`#[cfg(test)]`, pull Rust string literals, match a JSX tag, read a fenced block
or strip comments, the module in §4 has already been wrong at that exact task
and has a test proving it no longer is. Two independent implementations are
still required — but let one of them be an instrument that has already survived
its own bug.

**Cite a fact by id and re-verify it with its instrument.** Not "963 Rust
files" — `shared-facts.json#rust.files`, after running the instrument recorded
beside it. The corpus has published a wrong shared number three waves running,
each time as a confident correction of the last.
