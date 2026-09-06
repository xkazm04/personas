# Findings — a simulated year, nine arms (2026-09-05)

The harness replays one fabricated year (`out/s7-d365-x10`: 5 projects, 176 facts, 3,571
events, 194 probes over 10 classes) against any design that implements four calls. Round
one measured the baseline ladder and Athena. Round two added three arms drawn from public
memory systems, each isolating one policy rather than porting an implementation.

Every row shares the consumer (`claude-opus-4-8@medium`), the judge (`claude-sonnet-5@low`),
the budget (6,000 context tokens) and the elaboration regime (direct), and every row was
scored by the same judge revision. `athena-turn` is Athena answering in her own voice with
her own production routing (`claude-opus-4-8@low`); its consumer is hers, not the harness's.

## The ladder

| arm | acc | wrong-old | abstained | false fire | silent failure | ctx tokens | write tokens/event |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.08 | 0 | 175 | 0.00 | 1.00 | 0 | 0 |
| full history in context | 0.65 | 6 | 41 | 0.14 | 0.25 | 5,870 | 0 |
| retrieval, 40-chunk ceiling | 0.68 | 29 | 7 | 0.21 | 0.05 | 665 | 0 |
| **retrieval, 200-chunk ceiling** | **0.89** | 16 | 0 | 0.00 | 0.00 | 3,253 | 0 |
| hybrid verbatim | 0.87 | 5 | 10 | 0.07 | 0.05 | 1,912 | 0 |
| compiled truth (page rewrite) | 0.84 | **3** | 13 | 0.07 | 0.08 | 1,632 | 3,434 |
| athena (before the reconcile fix) | 0.80 | 12 | 2 | 0.07 | 0.01 | 1,603 | 1,341 |
| athena (after the reconcile fix) | 0.82 | 13 | 2 | 0.14 | 0.01 | 1,628 | 1,352 |
| **athena (both tiers governed)** | **0.86** | 9 | 1 | 0.07 | 0.01 | 1,592 | 1,371 |
| write-time verdict | 0.78 | 4 | 3 | 0.14 | 0.02 | **918** | 7,341 |
| athena in her own voice | 0.73 | 17 | 19 | 0.00 | 0.12 | 3,222 | 1,736 |

Accuracy per thousand context tokens, because read budget is the scarce resource in a real
assistant whose system prompt is already large:

| arm | acc per 1k ctx tokens |
| --- | --- |
| write-time verdict | 0.85 |
| athena | 0.50 |
| compiled truth | 0.51 |
| hybrid verbatim | 0.46 |
| retrieval, 200 chunks | 0.27 |
| full history | 0.11 |

## The three results that matter

**1. Consolidation does not buy accuracy here. It buys currency and read cost.**
Verbatim storage that never calls a model outscores every distilling arm on raw accuracy,
provided it is allowed to fill the budget. But the three arms that distil (page rewrite,
write-time verdict, Athena) hold 3, 4 and 12 stale answers against verbatim retrieval's 16,
and two of them do it at half the read cost or less. The trade is not accuracy against
cost. It is **detail against currency**, and it shows up class by class:

| class | verbatim (200 chunks) | page rewrite | write-time verdict |
| --- | --- | --- | --- |
| reversal | 0.85 | 0.98 | 0.98 |
| procedure | 1.00 | 1.00 | 0.50 |
| failure cause | 0.68 (hybrid) | 0.36 | 0.48 |
| adaptation | 0.84 | 0.60 | 0.56 |

A store of rows keeps the incidental detail and goes stale. A rewritten page keeps what is
currently true and forgets why. Neither store shape wins outright, and a design that wants
both needs the timeline as well as the summary — which is precisely the shape the page
arm's own model prescribes and which Athena already has in her episodic tier.

**2. The reconcile failures were a reliability defect, and fixing reliability bought
reliability — not accuracy.** She lost 31 of 102 sleep cycles to the timeout; the shortlist
fix took that to 1 of 76 and capped the prompt at 10k characters against a 33k peak. The
prediction attached to that bug was that her 0.80 was a floor held down by a third of her
consolidation never running. Measured: it was worth **two points** (0.80 to 0.82), not the
seven she would need to reach the verbatim arms. The stale-answer count did not move
(12 to 13).

What the fix did buy sits exactly where consolidation should show: recall past 121 days of
history went 0.74 to 0.94, recurring failure causes 0.72 to 0.88, procedures 0.70 to 0.90.
Those are the classes that need the pass to have actually run. **The correction worth
carrying is the first one: an operational failure inside a pipeline is not automatically an
accuracy cost, and reading it as one sends the next fix at the wrong target.**

**3. The procedural tier had never been governed at all, and that was worth four points.**
The year store retired 261 of 375 facts on schedule and **0 of 133 rules, ever**: nothing
called procedural demotion, because the compress prompt asks for a supersedes link only on
facts and the reconcile leg only judged facts. `procedural::write_rule` had working demotion
wiring and no caller.

That is worse than an ordinary tier bug, because the always-on lane injects six top rules
into every turn regardless of the question — so the ungoverned tier was the one with the
most standing. In the replayed store a rule from 17 January still said "be direct and blunt"
in December, months after the user switched to casual and the corresponding fact was
properly retired; a rule from 25 January still said "default to two-space indentation" after
four-space superseded it, and that rule is what she answered from. The tier had also
accumulated six near-duplicate small-talk rules and five near-duplicate task-reporting rules,
all live, because nothing ever compared rules to each other.

Rules now go through the same shortlist and the same leg call as facts (`Shortlistable`: a
fact's subject is its key, a rule's is its trigger). Result: **68 of 131 rules retired**,
accuracy 0.82 to 0.86, stale answers 13 to 9, reversals 0.91 to 0.93. She is now second on
the ladder behind verbatim retrieval, at half its context.

**Two things this fix did not do, stated plainly.** The preference class moved 0.22 to 0.44
and did not return to the 0.56 it started at, so the stale-rule diagnosis was necessary and
not sufficient — something else is wrong in that class. And **procedures regressed 0.90 to
0.60** (four probes): the leg can now retire rules, and on a narrow class a few over-eager
retirements cost more than the stale ones did. Both need a look before this branch merges.

**4. Her own voice is calibrated quiet.** Read by a neutral consumer her store gives 0.07
false fire and 0.01 silent failure. Answering in her own production routing she gives 0.00
and 0.12: she never asserts where silence is right, and abstains on one answerable question
in eight. That is the same finding as her collapse on failure causes, seen from the other
side, and it is a property of her instructions and effort rather than of her memory.

## Findings about Athena's design

1. **No clock seam existed.** 54 wall-clock sites (43 `Utc::now()`, 11 SQL `datetime('now')`)
   had to be routed through `brain/sim_clock.rs` before the brain could be replayed at a
   simulated instant.
2. **Recall ordering breaks ties on an unstable identity.** Two episodes sharing a
   `created_at` to the second, a `load_episodes_by_ids` with no `ORDER BY`, and a sort at
   `brain/retrieval.rs:399` and `:510` on `created_at` alone, so SQL row order decides. The
   consumer reads block order as recency.
3. **The reconcile leg's parser is stricter than its model.** `oneshot::extract_json_span`
   slices first `{` to LAST `}`, so a self-correcting reply with two objects is one invalid
   span and the cycle dies.
4. **The reconcile leg scanned the store instead of shortlisting candidates** (fixed 2026-09-05). The prompt grew
   3k → 17k → 33k characters against a fixed 180 s timeout; 31 of 102 cycles died, first at
   day 71. Past its 200-fact truncation, ordered by importance then recency, the tail is
   never a candidate again — a coverage hole, not just a cost cap. Both halves went to the
   registry as an amendment.
5. **Production main-turn effort costs accuracy.** `model_routing::MAIN` runs Opus at `low`;
   15 of 40 abstentions at `low` were answered correctly at `medium` on a fixed context.
6. **Her own voice loses the failure-cause class** (0.08 against 0.72 for the same store read
   neutrally), and abstains six times more often than the neutral consumer.

## What the harness learned about itself

- **A judge tuned to a terse consumer silently penalises a conversational one.** The first
  scoring of `athena-turn` was 0.36 with all 86 reversals marked stale. The replies were
  right: naming the current value and dating the old one tripped the rule that naming both
  is a supersedence failure. The judge now collapses a reply to the value it *asserts*
  before comparing, and recognises natural-language abstention.
- **An undeclared constant inside an arm silently sets that arm's budget.** The retrieval
  rung carried a hard-coded 40-chunk ceiling and spent 665 of the 6,000 tokens it was given.
  Every number it produced — 0.68 accuracy, 29 stale answers, "retrieval does not know what
  is current" — was a fact about the ceiling. At 200 chunks the same code scores 0.89 with
  16 stale. **Any cap that can bind before the declared budget is a predicate of the arm and
  belongs in the run header**, next to the consumer and the judge.
- **The restraint pair earns itself.** False fire and silent failure travel together because
  either alone is gamed by being louder or quieter. The empty rung reads 0.00 against 1.00,
  the degenerate quiet extreme in two numbers.
- A date inside embedded text leaks the clock into the ranking; all embedding arms embed
  date-free text and the purity check passes on each.
- A run of this size must be resumable and detached. Three multi-hour runs were killed by
  session events; only the per-probe checkpoint saved them.

## What the peer cohort was worth

Three public systems were read (a 59k-star verbatim archive, a write-time-reconciliation
store, a file-canonical page memory). None solves supersedence outright and none has a
usable published number: the first's held-out split is contaminated, the second's benchmark
scripts do not exist, the third's numbers are honest but self-against-self. Their value was
three mechanisms and one metric, all of which are now arms or instruments here.

## Backlog

- [x] shortlist reconcile candidates per new item (finding 4). Landed 2026-09-05 as
      `68829f2de` on `direction/memory-year-sim`: seeds are the facts the cycle wrote plus a
      rotating two-fact sweep, four candidates each by a directional overlap normalised on
      the smaller side. 31 of 102 cycle failures went to 1 of 76; the prompt is now set by
      the write budget, not the store.
- [x] the procedural tier was never governed (0 of 133 rules ever retired). Fixed 2026-09-06
      as `1c5b88571`: rules shortlist and reconcile beside facts. 68 of 131 retired, +4 points.
- [ ] preferences are still below where they started (0.56 -> 0.22 -> 0.44). Retiring stale
      rules was not the whole cause; the remaining half is unidentified.
- [ ] procedures regressed 0.90 -> 0.60 when rule retirement switched on. Check for
      over-eager supersedes on the four failing probes before merging the branch.
- [ ] one cycle in 76 still stalls (a 300s timeout on a prompt that size normally answers in
      under a minute). Looks like an occasional hang, not a tight budget. Do not raise the
      timeout again without evidence it is size-related.
- [ ] give recall the episodic timeline alongside the distilled facts on detail-bearing
      questions — the class table above says that is where both store shapes lose.
- [ ] secondary sort key (episode id) at `brain/retrieval.rs:399` and `:510` (finding 2)
- [ ] brace-balanced object extraction in `brain/oneshot.rs::extract_json_span` (finding 3)
- [ ] read the main-turn instructions for what suppresses failure-cause answers (finding 6)
- [ ] decide whether MAIN stays at `low` (finding 5)
- [ ] re-run the ladder after the reconcile fix; a verdict is pinned to what it measured
- [ ] merge `direction/memory-year-sim` (sim clock and driver)
