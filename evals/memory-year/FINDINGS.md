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
| athena | 0.80 | 12 | 2 | 0.07 | 0.01 | 1,603 | 1,341 |
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

**2. The measured weakness in Athena is staleness, and it is a bug before it is a design.**
She carries 12 stale answers where the two other distilling arms carry 3 and 4, and she lost
**31 of 102 sleep cycles** to the reconcile timeout while they lost 1 of 1,026 and 0 of 480.
A third of her consolidation never ran. Her 0.80 is therefore a floor, not a verdict, and
the reconcile shortlist fix has to land before the comparison is fair.

**3. Her own voice is calibrated quiet.** Read by a neutral consumer her store gives 0.07
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
4. **The reconcile leg scans the store instead of shortlisting candidates.** The prompt grew
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

- [ ] shortlist reconcile candidates per new item instead of scanning the active set under a
      200-fact truncation (finding 4). Highest value; it is a corpus rule already, and until
      it lands Athena's row is measured with a third of her consolidation missing.
- [ ] give recall the episodic timeline alongside the distilled facts on detail-bearing
      questions — the class table above says that is where both store shapes lose.
- [ ] secondary sort key (episode id) at `brain/retrieval.rs:399` and `:510` (finding 2)
- [ ] brace-balanced object extraction in `brain/oneshot.rs::extract_json_span` (finding 3)
- [ ] read the main-turn instructions for what suppresses failure-cause answers (finding 6)
- [ ] decide whether MAIN stays at `low` (finding 5)
- [ ] re-run the ladder after the reconcile fix; a verdict is pinned to what it measured
- [ ] merge `direction/memory-year-sim` (sim clock and driver)
