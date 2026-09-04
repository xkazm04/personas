# Findings — first year of simulated use (2026-09-04)

The harness in this directory replayed one fabricated year (`out/s7-d365-x10`: 5 projects,
176 facts, 3,571 events, 194 probes over 10 probe classes) through the baseline ladder and
then through Athena's own brain, driven headlessly by `personas-memory-sim` (branch
`direction/memory-year-sim`). Every row shares the consumer (`claude-opus-4-8@medium`), the
judge (`claude-sonnet-5@low`), the budget (6,000 context tokens) and the elaboration regime
(direct), and every row was scored by the same judge revision.

`athena-turn` is the exception the table names: it is Athena answering in her own voice,
with her own prompt assembler, her own recall and her own production routing
(`claude-opus-4-8@low`). It sits on the table because the judge now reads a conversational
reply correctly, but its consumer is hers, not the harness's.

## The ladder over the year

| rung | scored | acc | wrong-old | abstained | ctx tokens/probe | write calls/event |
| --- | --- | --- | --- | --- | --- | --- |
| none | 194 | 0.08 | 0 | 175 | 0 | 0 |
| full-history | 194 | 0.65 | 6 | 41 | 5,870 | 0 |
| raw-retrieval (date-free embed) | 194 | 0.68 | 29 | 7 | 665 | 0 (embeddings only) |
| **athena** | 194 | **0.80** | 12 | 2 | 1,603 | 0.04 (1,341 tokens/event) |
| athena-turn (her own voice and routing) | 194 | 0.73 | 17 | 19 | 3,222 | 0.06 (1,736 tokens/event) |

By age of the fact at question time:

| rung | 7d or less | 8-45d | 46-120d | 121d+ |
| --- | --- | --- | --- | --- |
| full-history | 0.90 | 0.90 | 0.23 | 0.46 |
| raw-retrieval | 0.51 | 0.81 | 0.62 | 0.80 |
| athena | 0.78 | 0.92 | 0.75 | 0.74 |
| athena-turn | 0.73 | 0.77 | 0.79 | 0.60 |

## What each rung's failures look like

- **Whole history in context** falls off the window. It is the best rung inside six weeks
  and the worst past them: 0.90 at 45 days or less, 0.23 at 46-120. Most-recent-first
  packing at 6k tokens holds about six weeks of this stream. Its 41 abstentions are honest.
- **Retrieval over the raw record** does not know which chunk is current: 29 wrong-old,
  clustered in the week after a reversal (0.51 in its worst bucket, against 0.80 at 121
  days and beyond). Similar chunks tie, and the older restatements outnumber the one update.
- **Athena** leads on every horizon past a week and is the only rung that collapses nowhere:
  0.74 at 121 days and beyond, 0.88 on reversals, 1.00 on stable, scope and distractor
  probes, at a quarter of whole-history's context. She does it while losing a third of her
  sleep cycles.
- **Athena in her own voice** trades 7 points for her production routing, and the trade is
  not uniform. She is *better* than the neutral consumer at applying what she was taught
  (adaptation 0.84 against 0.56) and at expired facts (1.00 against 0.83), and she collapses
  on recurring failure causes (0.08 against 0.72, with 13 abstentions of 25). The same store
  answers that class well when a neutral consumer reads it, so the loss is in her assembly
  or her instructions, not in her memory.

## Findings about Athena's design (the point of the exercise)

1. **No clock seam existed.** 54 wall-clock sites (43 `Utc::now()`, 11 SQL
   `datetime('now')`) had to be routed through `brain/sim_clock.rs` before the brain could
   be replayed at a simulated instant. The corpus rule that a memory's score is a pure
   derivation of an injected clock was not something this tree could check.
2. **Recall ordering breaks ties on an unstable identity.** Clock-purity replay of the
   deterministic layer (46 probes, `--no-consolidate`) returned identical content, but 3
   probes swapped two adjacent episodes between runs. Traced: the two share a `created_at`
   to the second, `load_episodes_by_ids` selects with `IN (...)` and no `ORDER BY`, and the
   sort at `brain/retrieval.rs:399` and `:510` compares `created_at` alone, so SQL row order
   decides the tie. The consumer reads block order as recency.
3. **The reconcile leg's parser is stricter than its model.** A cycle died on "reconcile
   reply is not valid JSON: trailing characters" when the model appended a corrected second
   object. `oneshot::extract_json_span` slices from the first `{` to the LAST `}`, so two
   objects in one reply become one invalid span. The adapter records these instead of dying.
4. **The reconcile leg scans the store instead of shortlisting candidates.** The prompt grew
   from ~3k characters (day 30, ~40 facts) to ~17k (day 240, 256 facts) and 33k on a second
   pass, against a fixed 180 s timeout: **31 of 102 cycles died**, first at day 71. The
   corpus already prescribes a deterministic prefilter that shortlists a handful of
   candidates per new item, so the pass costs the same at any store size, and it predicts
   exactly this failure. Athena's caps (200 facts, 200 characters per value) bound the
   ceiling without prefiltering. The second consequence went back to the registry as an
   amendment: past 200 active facts the truncation is a permanent blind spot, because the
   list is ordered by importance then recency and the tail below the cut is never a
   candidate again.
5. **Production main-turn effort costs accuracy.** `model_routing::MAIN` runs Opus at `low`.
   On a fixed context the harness measured 15 of 40 abstentions at `low` that `medium`
   answered correctly, and over the year her own turn path abstained 19 times against the
   neutral consumer's 2 on the same store.
6. **Her own voice loses the failure-cause class.** 13 abstentions and 10 wrong of 25, where
   the neutral consumer reading her own recall scores 0.72. Worth reading her main-turn
   instructions for something that discourages naming a cause.

## What the harness learned about itself

- **A judge tuned to a terse consumer silently penalises a conversational one.** The first
  scoring of `athena-turn` came out at 0.36 with every reversal marked stale. The replies
  were right: "Django. It was changed from Axum in April" asserts the new value and dates
  the old one, and the judge's rule that naming both is a supersedence failure turned a
  correct answer into a wrong-old. Distractors failed the same way, because she abstains in
  a sentence rather than with the harness's `UNKNOWN` marker. The judge now collapses a
  reply to the value it *asserts* before comparing (`asserted_value`, triggered only for a
  long reply or one naming both values, so terse rungs keep the deterministic path), and it
  recognises natural-language abstention. Re-judging every rung moved the baselines by up to
  2 points and `athena-turn` by 37. **The lesson generalises: a harness that measures a
  design in its own voice must extract the assertion, or it measures verbosity.**
- A date inside embedded text leaks the clock into the ranking (caught by the purity check
  on raw-retrieval; the corrected rung reads 0.68).
- Consolidation is model-driven, so clock purity is checked on the deterministic layer alone.
- A run of this size must be resumable and detached. Two multi-hour runs were killed by
  session events, and only the per-probe checkpoint saved them.

## Backlog

- [ ] shortlist reconcile candidates per new item instead of scanning the active set under a
      200-fact truncation (finding 4). Highest value, and it is a corpus rule already.
- [ ] secondary sort key (episode id) at `brain/retrieval.rs:399` and `:510`, or
      `ORDER BY created_at, id` in `load_episodes_by_ids` (finding 2)
- [ ] brace-balanced object extraction in `brain/oneshot.rs::extract_json_span` (finding 3)
- [ ] read the main-turn instructions for what suppresses failure-cause answers (finding 6)
- [ ] decide whether MAIN stays at `low` (finding 5)
- [ ] merge `direction/memory-year-sim` (sim clock and driver). The seam is worth keeping
      regardless of the harness.
