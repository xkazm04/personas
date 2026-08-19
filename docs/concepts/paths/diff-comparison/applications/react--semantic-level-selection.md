---
layer: application
subject: diff-comparison
technique: semantic-level-selection
stack: react
---

# Semantic level selection — four kernels, and which entity each one was chosen for

Every kernel in this repo was hand-written for one entity, and reading
them side by side is a level ladder with worked examples on each rung —
including the three "lies while looking structural" the technique names,
all of which were found here.

## Level chosen from the entity: the two that got it right

- **Prose → real LCS.**
  `src/features/plugins/obsidian-brain/sub_sync/conflictDiff.ts::diffNoteLines`
  is a genuine longest-common-subsequence over lines. Its docstring
  (`:12-17`) states the reason in the technique's own terms: a set
  difference would lose order and duplicates, and "the same blank line or
  heading legitimately recurs" in prose. Level chosen *from the entity*.
  It also names its cost (O(n·m)) and pushes the cap to callers — which is
  where the diff-honesty application picks the story up.
- **Sectioned prompt → structural outer, text inner.**
  `src/features/agents/sub_lab/shared/DiffViewer.tsx:29` and
  `src/features/agents/sub_lab/components/shared/InlineDiffPreview.tsx:29`
  compare section keys first, then run the token diff (`diffStrings`,
  `labPrimitives.ts:113`) only inside sections whose text differs. This is
  the technique's *levels compose* clause and is why those two stay cheap.

## Level chosen from convenience: the terminal-log set diff

`src/features/agents/sub_executions/libs/comparisonHelpers.ts::diffLines`
(`:53`) is a **set-membership** diff — a line is `same` if the other side
contains it anywhere. The docstring (`:42-52`) is exemplary honesty about
what that gives up: repeat-count changes read as `same`, reordering is
invisible, all `added` lines are appended after A's rather than placed.
"Good enough for a quick 'did anything change' signal — do not rely on it
for exact positional diffing." The level is wrong for prose and
defensible for terminal logs, and the kernel *says which it is doing* —
the technique's last section, honored in a comment. What it does not do
is say so on the surface: `ComparisonDiff.tsx` renders it with left/right
line-number gutters (`:111-127`) that imply positional alignment the
kernel never computed.

## The three structural lies, all present in one function

`comparisonHelpers.ts::jsonDiff` (`:74-93`) is the kernel behind
`JsonDiffSection` — the surface that shows how two executions' input and
output payloads differ. Replayed verbatim (`version-diff-view.md` §0):

| input | reported | technique clause |
|---|---|---|
| nested keys in a different order, same values | **1 change** | equality by serialization — `JSON.stringify(objA[key])` vs `JSON.stringify(objB[key])` (`:85-86`), unsorted |
| `{"input":{"topic":"x"}}` vs `{"input":{"topic":"y"}}` | 1 change at path `input`, never `input.topic` | depth one — each top-level value stringified whole |
| `{"a":1}` vs `{"a":1,"b":null}` | **0 changes** | absent collapsed into null — `objA[key] ?? null` |

Nowhere in 4,801 files is `JSON.stringify` given a key-sorting replacer,
and nowhere is `Object.keys(x).sort()` applied on a comparison path (two
independent implementations agreed). The census rule
`stringify-decided-equality` (published from `version-diff-view.md` §9)
keys on the condition — serialized bytes deciding equality on both sides
of an operator — and finds **6 sites in 5 files**, five of them shipping.
Its paired-const alternative is load-bearing: it is the only form that
sees `comparisonHelpers.ts:85`, the diff kernel itself.

## The projection failure

`DiffViewer.tsx:14-16` normalizes both versions through `getSectionSummary`
(`src/lib/personas/promptMigration.ts:255`), which iterates
`STANDARD_SECTION_KEYS` — five of the seven fields a `StructuredPrompt`
holds; `customSections` and `webSearch` (`promptMigration.ts:70-80`)
never reach the diff. The empty state at `DiffViewer.tsx:54` then
re-walks *the same five keys* and, finding them equal, renders
`t.agents.lab.no_structural_diff` — an affirmative denial computed over
the projection. `DraftDiffViewer.tsx:24` has the identical blind spot by
a different route. Measured against the pre-purge backup: **0 of 73**
persona prompts populate either field, so this is latent by measurement
and real by construction — the technique's "enumeration comes from the
schema" clause, violated at exactly the surface whose job is to say what
changed between versions.

## Four kernels, three whitespace policies, none written down

The normalization-ledger clause, measured: the worker drops blank lines
but does not trim survivors (`comparisonDiff.worker.ts:13-14`); its
synchronous fallback duplicates those two lines verbatim
(`comparisonDiffWorkerClient.ts:142-143`) with nothing asserting they
agree; `conflictDiff.ts:20-21` and `PromptDiffModal.tsx:36-37` do a bare
`split('\n')`. The same pair of texts yields different "differences"
depending on which surface the reader opened, and no document says which
policy is intended.
