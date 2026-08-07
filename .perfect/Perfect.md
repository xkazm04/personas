# Perfect — personas

> The direction-and-delivery loop. Director proposes and reviews; builders build in
> worktrees; this vault remembers so no session starts from zero.

**Mission.** Personas is a desktop app for running AI agent teams against real
repositories. The loop's job is to make each context the best version of itself —
judged by what a user actually experiences, not by test count.

## Status

- **Mode:** autonomous — continuous waves, report only on exception (policy in `config.md`)
- **Cursor:** `prompt-assembly-engine` (wave 6). `agents-quick-answer`, `workspace-governance`,
  `engine-build-session` on cooldown. `studio` re-scored 8 → 2 (dev-only).
- **Shipped:** 17 directions across six waves
- **Last session:** [[sessions/2026-08-05]]
- **Verified on the tip:** `tsc` 0 · `cargo test -p personas-db` 707/12 (baseline 705/12, none added)

## Queue — fully scored 2026-08-06

All **208 contexts scored**. Full table with rationale and flags: [[contexts/_scores]].

Method: 20 parallel scorers against one pinned rubric, `agents-quick-answer` = 9 as the fixed
anchor, batches dealt round-robin across all 16 groups so no agent anchored to one group's
range. Global mean **4.84**, sd **1.73**; **no batch drifted ≥1 sd** — the scores are
comparable end to end.

| Band | Contexts |
|---|---|
| 9-10 | 1 (the anchor, now worked) |
| 7-8 | 39 |
| 5-6 | 76 |
| 3-4 | 70 |
| 1-2 | 21 |
| 0 | 1 |

### Cursor candidates — everything at 8

No context scored 9: none combined every-session reach with a defect set as concrete as the
anchor's. These thirteen are the 8s, and the cursor should come from here.

| Context | Group | The named opportunity |
|---|---|---|
| `prompt-assembly-engine` | Agent Platform | Every CLI execution passes through it; the submodule split started and `prompt/mod.rs` is still 108KB |
| `engine-build-session` | Design & Build Studio | 11k LOC where a mis-parsed event promotes a broken connector; the three largest files have zero unit tests |
| ~~`studio`~~ | Design & Build Studio | **WITHDRAWN — re-scored 2.** `registry.ts:88` gates the whole section `devOnly: true`; 18 of 19 files are unreachable in a shipped build (verified in the prod bundle). The DEV gate on the pill is redundant, not a missing feature. |
| `companion-core-store` | Agent Platform | 1221-line flat store, eight concerns, two tests, four downstream contexts inherit it |
| `hooks-design` | Design & Build Studio | The engine behind the product's core promise; four contexts merged in one day |
| `agents-executions-components` | Execution Engine | ~10.5k LOC / 6 test files; comparison silently falls back off-worker |
| `fleet-monitor-channels` | Fleet & Orchestration | Three parallel renderings of one event stream inside one context |
| `fleet-monitor-shell` | Fleet & Orchestration | — |
| `overview-manual-review` | Overview Observability | — |
| `recipes-playground` | Automation & Pipelines | 28-file two-phase execution loop, hand-rolled run-id correlation, zero tests |
| `triggers-triggers` | Automation & Pipelines | Claims to own dead-letter and rate-limit UIs that actually sit in unowned sibling dirs |
| `shared-components-layout` | Shared UI Components | `ContentLayout` has 79 consumers; three overlapping tab components |
| `companion-narration-ops` | Agent Platform | — |

### Read before picking a cursor

**`workspace-governance` (7) is the highest-leverage entry in the whole table**, and its score
understates it. It owns `context_generation.rs` — the scanner that produces the context map
this queue is built from — and that output is provably broken (see below). Fixing it repairs
the substrate every future `/perfect` run navigates by.

## The context map is broken at the topology layer

Found by five scorers independently, then confirmed at the map level:

```
contexts:                                        208
with ≥1 dangling cross_ref:                      199  (96%)
total dangling refs:                             449
distinct referenced names that no longer exist:  310
```

**There are more ghost names than real contexts.** The `personas-context-scan` run on
2026-08-04 collapsed roughly 500 contexts into 208 and never rewrote the cross-references, so
almost every context still points at siblings it absorbed. Most-referenced ghosts:
`persona-editor` (8), `execution-core` (7), `execution-runner` (6).

This is not cosmetic. `cross_refs` is how `/perfect` reasons about whether work in one context
compounds into another — every scorer using it as a strategic-fit signal was reading a dead
pointer. It is also why `stale-docs` is by far the most common flag (74 of 95 flagged
contexts): it is one defect reported 74 times, **not 74 separate rot events**.

### Ownership — CORRECTED 2026-08-06 after the wave-3 scout

An earlier revision of this note blamed `context_generation.rs`. **That was wrong.** The
generator is LLM-driven — `cross_refs` is a prose prompt bullet (`:301`) persisted verbatim
(`:1414`), with no derivation to fix — but it is not the main producer of these ghosts.

The defect site is **`context_consolidate.rs:399-473`**, a deterministic zero-LLM pass. Its
`apply()` transaction re-points six anchored artifact tables (`dev_kpis`, `dev_ideas`,
`dev_goals`, `memory_nodes`, `dev_use_cases`, `dev_use_case_contexts`) before hard-deleting
absorbed rows — and never touches `cross_refs`. The column is not even loaded into its working
struct (`:102-113`).

**Two independent ghost paths:** absorbed rows are hard-deleted (`:446`), *and* survivors are
renamed (`:412-427`), which orphans inbound references to the old name even when the row lives.
That is why 310 ghosts can exceed the number of deleted contexts.

Parsing the `[Consolidated …: absorbed …]` markers the pass stamps into each survivor's
description: **248 of 310 ghosts (80%) provably match an absorbed name.** The residual ~62 are
the pre-existing LLM hallucination baseline, which `mcp_server/tools.rs:628` already documented
*before* consolidation ran and multiplied it ~5×.

Self-demonstrating: `workspace-governance.cross_refs` names `context-scanning`, a context it
absorbed itself. It cross-references its own corpse. Its `db_tables` are also both fictional
(`standards_violations`, `doc_rot_findings` — the real tables are `dev_standards` and
`doc_status`), so the defect class covers every unvalidated descriptive field, not just refs.

**And `context_consolidate.rs` belongs to no context** — the file that corrupted the map is
invisible to the map it corrupted.

## Registry mismatch (read before emitting coverage)

`context-map.json` consolidated `agents-quick-answer` on 2026-08-04, absorbing
`quick-answer-legacy-rails`, `quick-answer-shell`, `triage-core`, `triage-tests`,
`triage-unified-hook`, `quick-config-shared`. **`.personas/contexts.txt` still lists the
pre-consolidation names** and does NOT contain `agents-quick-answer`.

Coverage entries must use a name from `contexts.txt` or they land unanchored and the bar
never moves. Use `quick-answer-shell` / `triage-deck-ui` / `triage-core`.

## Accepted pool — 0 open

Every accepted direction across waves 1-5 has shipped. In autonomous mode the pool no longer
gates a wave: the Director accepts on evidence and builds, stopping only for the irreversible
three (see `config.md` → Autonomy policy).

Rejected, still standing: [[untrusted-card-content]] — real finding, wrong context. Re-raise
against the owner of `shared/components/editors`.

## Superseded wave-1 plan (kept for the reasoning)

Two **sequential** builders — 1 and 3 both rewrite `useUnifiedTriage`, 1 and 4 both touch
`TriageDeckVariant`, so a parallel wave would conflict on merge.

1. **Builder A** — drag identity + colour-only (disjoint files, no i18n)
2. **Builder B** — honest endings + rebuild cost (forked after A merges; carries the i18n)

## Shipped ledger

| Direction | Commit | Observed effect |
|---|---|---|
| [[drag-decides-its-own-card]] | `4b0f7c5cf` | A drag verdict can no longer land on a card a poll swapped in mid-gesture |
| [[nothing-colour-only]] | `a8b098a28` → `f9a58d70d` | Fact tone and metric direction readable without colour; identical consecutive verdicts each get an utterance |
| [[honest-endings]] | `739d0ca3c` | The deck can no longer say "nothing is waiting on you" when a fetch failed or cards were skipped away |
| [[queue-rebuild-cost]] | `7c0a46793` + `07f1b0206` | 26 components on mount, ~4.3/keystroke, zero markdown re-parses while typing |
| [[staleness-sees-ideas-and-tasks]] | `9fc8c42ff`, `5ee89681a` | "Approved but never dispatched" is queryable for the first time; a goal due today no longer reads as overdue from midnight |
| [[dispatch-panel-one-truth]] | `33ef7e71b` | The Fleet dispatch arm is reachable from the UI for the first time; approved-but-never-sent work is visible |
| [[consolidation-rewrites-what-it-orphans]] | `c02ef1bd9` | Merging contexts no longer orphans the references to them. Repair for the *existing* damage is built and dry-run-verified at **341 of 449 resolvable** — but it has not been applied (see below) |
| [[ask-the-detector-we-already-built]] | `c13dbdc77` | The referential-integrity audit went from **zero callers** to three plus a human surface — it now runs after every consolidation and whole-tree scan |
| [[validate-what-the-model-asserts]] | `183aa5042`, `d9f5643a4` | A scan no longer publishes references that name nothing. Against the shipped map: **150 of 290 `db_tables` (52%)** and **449 of 555 `cross_refs` (81%)** are unresolvable |
| _(map repair)_ | `d46c8289f` | The 449 dangling refs **applied and republished: 449 → 108, 310 → 62 ghosts**. Idempotent; the 108 are the named hallucination residue |
| [[the-rot-detector-cannot-see-rot]] | `4eee00e22`, `543006212` | Co-located docs are visible for the first time (0 → 39); UNSCOPED stops rendering as clean; **108 docs (27%) name a path that no longer exists** — a fact git timestamps could not express |
| [[a-checkmark-that-means-something]] | `b093127a9`, `5f9431bd1`, `a13c922f0`, `510aa7a7a` | A build can no longer reach `active` — scheduler armed, webhook live, real credentials — **without one connector call ever being made**. `build_session` tests 96 → 149 |
| [[the-gate-ate-the-bootstrap]] | `61eda2fd0`, `5dc126447` | A DEV gate on a dev overlay was also eating an app bootstrap: the fleet awaiting-input badge never lit in production, and the memory-outbox ledger sweep never ran |
| [[the-fix-loop-makes-it-worse]] | `5a696c106`, `e24b89f8b`, `77ded42ee` | The corrective re-run no longer discards the input it is correcting, nor silently drops to a weaker model; truncation announces itself |
| [[the-correction-under-a-do-not-follow-banner]] | `e732c4e65`, `db9cb3b66` | **Premise refuted, defect was the inverse.** Model-authored failure text had been spliced RAW into trusted prompt structure above the canary since the feature shipped. Framing is now `&static str` by type; evidence is boundary-wrapped |

### The damage is diagnosed, not yet repaired

`c02ef1bd9` stops consolidation *creating* new orphans and `183aa5042` stops scans *publishing*
invented names. Neither has touched the 449 refs already in `dev_contexts`.

That is deliberate: `repair_cross_refs` is dry-run by default and wired into no scan hook,
because `dev_contexts` has no version column, no soft-delete and no `absorbed_from`, and context
scans are never recorded in `dev_scans` — a bad repair cannot be rolled back from inside the
app. **Applying it is an explicit act that needs the user**, per the autonomy policy's second
rule. Until then the live map still carries all 449.

Rejected: [[untrusted-card-content]] — real finding, wrong context.

See [[sessions/2026-08-05]] for the 11 commits shipped directly this session under the
user's own brief, before the loop was invoked.
