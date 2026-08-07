# Athena longevity & efficiency — evidence + v0 design

> **Part I** (2026-08-07): measured evidence, grouped. **Part II** (2026-08-08): the design answer,
> synthesized from the operator's brainstorm (short/long memory, sleeping reconciliation, identity
> evolution, critique layer) against the codebase. v0 — written for iteration, not execution.
>
> **Evidence rule:** every number carries the query or `file:line` that produced it. The preceding
> round proved that a figure quoted without its source gets re-derived wrong by the next session.

---

# Part I — where the cost and the growth actually come from

## 0. The one-line version

Athena's cost is dominated by a prompt that is **~69% constitution** and is reassembled every turn;
her memory grows monotonically because **every capability that would shrink it was written in the
`ml` arm the shipping build does not compile**; and nothing measures whether any of it works. Those
are three views of one problem.

## 1. Where the money actually goes

| Measure | Value | Source |
|---|---|---|
| Constitution block | **106,598 chars avg · 110,883 max** | r4 scout brief, live DB |
| Constitution's own declared budget | **24,000 chars** — actual is **4.4× over** | `prompt.rs:1632` `BLOCK_BUDGETS` |
| Total prompt | **~154k chars ≈ 40k tokens** | r4 scout brief |
| Chat turns | 63 turns = **$111.60** = 53% of all Athena spend ≈ **$1.77/turn** | `companion_turn` |
| Headless turns | 1,636 turns ≈ 47% of spend ≈ **$0.06/turn** | `companion_turn` |
| `cache_creation_tokens`, chat | **239,852 → 305,401 and rising** | `companion_turn_sidecar` |

The budget is a tripwire by design — `warn_over_budget()` (`prompt.rs:1684`) emits one
`tracing::warn!` and changes nothing; the comment above `BLOCK_BUDGETS` says so explicitly
("a tripwire for silent growth, not a cap"). That choice predates the block growing to 69% of every
turn. Meanwhile the *enforcing* pattern already exists in the same file: `INDEX_CHAR_BUDGET`
(`prompt.rs:616-618`) enforces a split across three index blocks with an honest "_listing N of M,
truncated for prompt budget_" footer and a read-op pointer (`prompt.rs:785, 865, 997`).

Per-block sizes are **already recorded to the turn ledger every turn** (`prompt.rs:1671` —
`{"constitution": 5123, "identity": 812, …}`). The storage half of the instrument exists; the
churn analysis (which blocks change between turns — what drives cache_creation) does not.

The constitution itself is a **file** — `constitution.md` read whole from the brain root
(`prompt.rs:169-170`). Tiering it is file surgery plus an enforcement path, not an engine rewrite.

## 2. Memory grows monotonically; the brakes were in the wrong build

| Measure | Value | Source |
|---|---|---|
| Episodes | **907**; 515 `system` (57%); 259 raw `fleet-event` rows | `companion_node`; writers `fleet_bridge.rs:2277`, `brain/fleet.rs:75` |
| Consolidation runs, all time | **0 rows in 77 days** | `companion_consolidation` |
| Facts | **30**; decay dead until r4 (`touch_last_seen` was ml-only) | `companion_fact` |
| `prune_low_value_facts` | `consolidation.rs:565`, **zero callers** | grep |
| Deletion contract | episodes are **NEVER deleted** | `episodic.rs` |

Round 4 fixed decay and excluded machine chatter from recall. Still structural: storage grows at
machine-event rate; maintenance exists as functions, not as a schedule
(`maybe_run_lifecycle_sweep`, 6h-throttled off the recall path, is the only self-running piece).

## 3. The `ml` / non-`ml` split is one fact with four symptoms

Shipping build has no `ml`: `touch_last_seen` ml-only (decay dead) · `recall_synthesis` non-ml no-op
(nothing trims recall) · 0/907 episodes embedded · `retrieval.rs:100` recency cut assumed a vector
lane that never runs · `manual_recall` duplicated `brain/retrieval.rs` and the duplicate shipped.
**Every growth-control capability lived in the arm that does not run.** That is why the corpus only
grows. → resolved by Part II: non-ml first-class.

## 4. Recall changed shape last round; its budget is in items, not size

`RECALL_EPISODE_TARGET = 20` / `RECENCY_FLOOR = 6` — twenty long episodes are not twenty short
ones. And the non-ml prompt got materially bigger in r4 (doctrine now reaches it; nothing trims) —
a known, deliberate, unmeasured regression.

## 5. Nothing measures whether she is getting worse

`recall_json` in the sidecar is a real instrument (it caught "doctrine 0 on 54 turns"). Beyond it:
no recall-relevance signal, `is_error` was 0-by-construction until r4, and 30 stale facts were
recited as current for 70 days — **the operator noticed; no instrument did.**

## 6. Write amplification + the FTS fork

A memory body is stored up to 4×: `companion_node.body_excerpt`, `companion_fts.body`, markdown on
disk, `companion_embedding` (doctrine only). Two devices measured `companion_fts` (1,346 rows, then
zero readers) within a day and did opposite things: this machine built the BM25 reader
(`84a2ee870`); the other dropped the table and all nine writers (`b72f6914b`). The 2026-08-08 merge
kept the table (the deletion's premise was invalidated; dropping fails silently, keeping fails
loudly; guard test added in `373e91f2b`). **Unaddressed and correct objection:** it is a second
plaintext copy of every transcript, outside the encrypted-section work. → decision D3 below.

## 7. Two spend ledgers

`companion_turn` (tracked turns) vs `dev_llm_spend` (untracked `cli_text`, no user-db handle).
Monthly cost = the union; nothing unions them today.

---

# Part II — the way out (v0 design)

## The reframe the evidence forces

The unused memory dimensions are **not evidence the organs are wrong**. They are real
implementations — `reflection.rs` 211 lines, `backlog.rs` 248, `daily_goals.rs` 526,
`procedural.rs` 404, `goals.rs` 318, `identity.rs` 476 — that were never given a heartbeat. The
app says it itself: `MemoryPanel.tsx`'s doc comment reads *"These are manual maintenance passes;
**nothing here runs on a schedule**."*

And the heartbeat **already exists**: the night shift — `night_shift/mod.rs:337 tick()`, a planner
(`build_prompt/parse_plan/bound_plan/worker_prompt`), plan+event persistence
(`jobs/night_plan.rs`: `insert_plan`, `active_plan`, `night_window_active`, `record_event`), an
enable flag and a configurable hour (`enabled()`, `plan_hour()`). The sleeping reconciliation is a
**new job family for an existing scheduler**, not new infrastructure.

Same pattern everywhere the brainstorm points:
- *Strict long-term structure* → `companion_fact` already has scope/key/confidence/`supersedes_id`/
  `contradicts_id`, and `companion_provenance` already links facts → source episodes.
- *Identity that evolves* → `identity.md` is already read into the prompt as "the evolving
  self-model" (`prompt.rs:5,171`), has a 16k budget slot, and is already versioned
  (`identity.bak-{}-{}.md`, `identity.rs:306`).
- *Proposal review UI* → `ConsolidationReview` (diff-review for consolidation proposals) exists
  inside the very Memory page slated for replacement.
- *Honest inputs for critique* → the r4 failure ledger (`is_error`/`error_reason`) and nudge
  delivery fixes are exactly the material a critique pass needs.

**v2 is an activation-and-binding project, not an invention project.** Wire the organs to the
heartbeat; make the budgets bind; make the prompt cycle-stable.

## Architecture — four tiers + one cycle

**Tiers**

1. **Working set (short-term):** per-session transcript window + recency episodes. Exists; bounded.
2. **Episodic archive:** append-only, all sessions, never deleted (contract kept). Out of the
   prompt path except query-driven retrieval (keyword lane). Grows on disk, not in per-turn cost.
3. **Long-term structured memory** — *the product of sleep.* Strictly budgeted, typed,
   provenance-linked: facts · procedurals ("rituals") · goals/backlog · preferences (→ identity) ·
   classification tags from a **seeded registry** (`companion_taxonomy`: tag, definition, origin
   cycle, status `proposed|active`). **Schema evolution = rows in the registry, never DDL.**
   Athena's self-awareness proposes tags/kinds; expansion is data, gated, reversible.
4. **Doctrine:** retrieval-only (keyword lane; embeddings optional later).

**The sleep cycle** — a night-shift job family. Headless CLI legs (~$0.06/leg measured),
single-flight via the existing turn lock, and every leg frames episode content as **untrusted
evidence** (precedent: `e732c4e65` split trusted framing from untrusted evidence in the fix loop).

- **A · Compress:** episodes since last cycle → candidate facts/preferences/procedures, each with
  provenance episode ids. Auto-applied within budget.
- **B · Reconcile:** supersede / contradict / dedupe / re-tag; decay + prune (**the first real
  caller of `prune_low_value_facts`**). Forgetting = demotion (`importance → 0`, the existing
  supersede pattern), never deletion.
- **C · Identity:** rewrite the *evolved* section of `identity.md` from preference facts — tone,
  verbosity, level of detail, **channel style (text vs voice)**. Two writers feed preferences: an
  in-turn capture when the operator states one explicitly ("be simpler and friendlier on voice"),
  and cycle inference from observed patterns. Versioned via the existing `.bak-` mechanism; every
  line cites provenance; **the constitution outranks identity** — identity may change style, never
  capability or safety.
- **D · Critique — "what can be done better":** reads the now-honest turn ledger, nudge
  engagement, goal/project state → improvement proposals into backlog / proactive nudges / daily
  goals (all three delivery paths exist; nudge delivery fixed in r4), plus taxonomy-expansion
  proposals, plus the **cycle report**.
- **Output:** one `cycle_report` node per cycle — *what I learned / what I forgot / what I changed
  / what I propose.* The journal entry Memory v2 renders, and the audit trail for everything above.

**Approval posture (v0):** auto-apply A and B within budgets; **gate C (identity), forgetting
demotions, and taxonomy expansion** through a proposal inbox (generalized `ConsolidationReview`).
Relax per-dimension as trust accrues — the gate posture is itself a setting, not an architecture.

## The prompt restructure — where the money comes back

Order blocks by volatility. Everything above the volatile line changes **only at cycle
boundaries**, making it cache-stable between cycles:

```
[ constitution core   — tiered; budget ENFORCED via the index-block pattern
                        (honest truncation footer + read-op pointer to the rest)
  identity            — core (ours, fixed) + evolved (cycle-written)
  long-term memory    — the bounded block that REPLACES the constant recall dump
  tool/index blocks   — already budget-enforced today ]
──────────────── volatile line ────────────────
[ query recall hits · session window · observability ]
```

Effects to expect (and verify with L0, not assume): `cache_creation` collapses to the first turn
after each cycle; per-turn cost decouples from history length. Working targets: constitution ≤24k
(its own declared budget), identity ≤16k (existing slot), long-term block ≤8k — total ≈ 50–60k
chars ≈ **15k tokens vs 40k today**.

**Why this defeats exponential conversation growth:** growth lands in the episodic archive (disk),
cycle input volume (headless, ~$0.40–0.60/night at 6–10 legs), and the retrieval index — none of
which sit in the per-chat-turn prompt. Per-turn cost becomes ~O(1) in history size. That is the
way out.

## Memory page v2

Agreed on throwing the content away — the page's own comment describes a manual-maintenance
cockpit, and the cycle obsoletes every button on it. **Sequence it after cycle v1 ships**, because
the new page's content *is* the cycle's artifacts:

- **Journal** — timeline of cycle reports (the diary; also the natural voice-briefing source).
- **Long-term browser** — by tag/scope, provenance drill-down fact → source episodes.
- **Identity** — version history, diffs, revert (the `.bak-` files already exist).
- **Inbox** — pending proposals (identity / forgetting / taxonomy), generalized from
  `ConsolidationReview`.

Building the UI first would repeat v1's flaw: a viewer over organs that don't move.

## Decisions

- **D1 · Brain home (forced by the 2026-08-08 merge):** sleep cycles running on two devices
  against two brains **will fork identity** — today's `companion_fts` fork is the proof of
  mechanism. v0: cycles run only on a designated home device; the portability layer
  (`b72f6914b`) moves the home deliberately. Revisit if brain sync ever becomes continuous.
- **D2 · Approval posture per dimension** — proposed above; operator-tunable.
- **D3 · FTS plaintext mirror** (Part I §6): resolve during tier-3 work — port the lane to
  `companion_node` or encrypt the mirror. The schema-guard test (`373e91f2b`) holds the line.
- **Q1 resolved:** non-ml first-class. The cycle is LLM judgment via headless calls; embeddings
  later upgrade *retrieval*, gate nothing.
- **Q2 resolved:** the goal is **flat per-turn cost as the corpus grows** (bounded-prompt
  invariant), which subsumes "cheaper per turn".

## Phasing — each ships alone; sized for one-branch Phase B waves

- **L0 · Instruments** (small): churn analysis over the block sizes the ledger *already records*;
  unified spend rollup (`companion_turn` ∪ `dev_llm_spend`); `cycle_report` substrate.
- **L1 · Sleep cycle v1** (the engine wave): night-shift job family; phases A+B with the seeded
  taxonomy; cycle report; proposal inbox wiring.
- **L2 · Prompt restructure** (the payoff wave): constitution tiering; budgets bind; volatility
  ordering; before/after measured with L0.
- **L3 · Identity evolution** + channel styles (audio-ready).
- **L4 · Critique phase** (+ surface initiative through nudges/daily goals; note the r4 carry-over
  that nudge cards sit behind a collapsed attention chip — discoverability is part of this).
- **L5 · Memory page v2.**

L1 gates L3–L5. L2 needs only L0. **L0 first is non-negotiable on the evidence:** two rounds of
unmeasured fixes in this subsystem landed on code paths that never executed.
