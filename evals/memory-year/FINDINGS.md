# Findings — first year of simulated use (2026-09-03)

The harness in this directory replayed one fabricated year (`out/s7-d365-x10`: 5
projects, 176 facts, 3,571 events, 194 probes) through the baseline ladder and then
through Athena's own brain, driven headlessly by `personas-memory-sim` (branch
`direction/memory-year-sim`). Every row below shares the consumer
(`claude-opus-4-8@medium`), the judge (`claude-sonnet-5@low`), the budget (6,000 context
tokens) and the elaboration regime (direct). Athena-turn is the exception by design: she
answers with her own prompt assembler, her own recall and her own model routing
(`claude-opus-4-8@low`), so that row is reported beside the ladder, not on it.

## The ladder over the year

| rung | scored | acc | wrong-old | abstained | ctx tokens/probe | write calls/event |
| --- | --- | --- | --- | --- | --- | --- |
| none | 194 | 0.08 | 0 | 175 | 0 | 0 |
| full-history | 194 | 0.63 | 12 | 39 | 5,870 | 0 |
| raw-retrieval (date-free embed) | 194 | 0.68 | 32 | 7 | 665 | 0 (embeddings only) |
| athena | 194 | **0.77** | 18 | 2 | 1,603 | 0.04 (1,341 tokens/event) |
| athena-turn (beside the ladder) | PENDING | | | | | |

Smoke scenario (60 days, 443 events, 40 probes, all within 7 days of their fact):
athena 0.93 (2 preference abstentions, 1 adaptation wrong), athena-turn 1.00, 11–12
admitted sleep cycles, 0 cycle failures, 0.05–0.14 model calls per event.

## What each rung's failures look like

- **Whole history in context** fails by *falling off the window*: 0.90 at ≤45 days of
  history, 0.23 at 46–120 days. Most-recent-first packing at a 6k budget keeps about six
  weeks. Its abstentions are honest; its wrong-old answers (12) come from the few reversals
  where both versions fit the window and the model picked the older.
- **Retrieval over the raw record** fails by *not knowing which is current*: 32 wrong-old
  answers, clustered in the week after a reversal (0-7d bucket 0.51). Similar chunks tie
  and the older restatements outnumber the one update. Adaptation probes (a taught fix
  the user expects applied unprompted) are its worst class at 0.28.
- **Athena** is the best row and fails by *losing a third of her sleep cycles*: 71 cycles
  admitted, 31 failed (reconcile timeouts and one compress error, first at day 71, then
  steadily as the fact table grew). Her wrong-old answers (18) sit in the same post-reversal
  week as raw-retrieval's, but at half the count, and her long-history buckets hold
  (0.75 at 46–120 days, 0.71 beyond, where whole-history collapses to 0.23). Weak classes:
  rule 0.33 (3 probes), preference 0.44 (4 of 9 wrong-old: an updated preference loses to
  the older one), adaptation 0.56 (a taught fix not applied unprompted). Strong classes:
  stable, scope, distractor all 1.00, reversal 0.83.

## Findings about Athena's design (the point of the exercise)

1. **No clock seam existed.** 54 wall-clock sites (43 `Utc::now()`, 11 SQL
   `datetime('now')`) had to be routed through `brain/sim_clock.rs` before the brain could
   be replayed at all. The registry rule (`memory-value-model`: the score is a pure
   derivation of an injected clock) was not something the tree could have checked before.
2. **Recall ordering breaks ties on an unstable identity.** Clock-purity replay of the
   deterministic layer (46 probes, `--no-consolidate`) returned identical content, but 3
   probes swapped the order of two adjacent episodes between runs. Traced: the two
   episodes share a `created_at` to the second (two messages in the same minute),
   `load_episodes_by_ids` selects with `IN (...)` and no `ORDER BY`, and the stable sort
   in `brain/retrieval.rs:399` / `:510` compares `created_at` alone, so SQL row order
   decides the tie. Not a clock leak; add the episode id as the secondary key. It matters
   because the consumer reads block order as recency.
3. **The reconcile leg's parser is stricter than its model.** Twice in earlier runs a sleep
   cycle died on "reconcile reply is not valid JSON: trailing characters" — the model had
   appended a corrected second object after the first. `oneshot::extract_json_span`
   slices from the first `{` to the LAST `}`, so two objects in one reply become one
   invalid span. The adapter now records these as `cycle_failures` instead of dying; the
   fix is a brace-balanced scan that returns the first complete object (and, since the
   model's later object is its correction, arguably the last complete one). In the smoke
   and year runs reported here: 0 failures.
4. **Production main-turn effort abstains with the fact in context.** At `low` effort
   Opus answered UNKNOWN on 15/40 probes whose fact was verbatim in the context; `medium`
   recovered all of them. `model_routing::MAIN` runs at `low`. The harness consumer was
   moved to medium so the ladder measures memory rather than effort; the athena-turn row
   keeps production routing on purpose, so its gap to the athena row prices this.
5. **The reconcile leg's prompt grows with the live fact table.** Over the year replay the
   reconcile prompt went from ~3k characters (day 30, ~40 facts) to ~17k (day 240, 256
   facts), and three cycles then hit the leg's 180 s timeout while one compress leg exited
   with an error; by year end 31 of 102 cycles had failed. The timeout and the prompt shape were sized for a young store; a mature
   one needs either a bounded candidate set per cycle (only facts touching the new
   episodes' scopes and tags) or a budget that scales with the table.
6. **Preference probes are Athena's weak class on the smoke run** (1/3): a stated
   preference that was never restated does not surface for a question phrased as a
   task. Whether the year run confirms this decides whether it is a retrieval-lane
   problem or a distillation problem.

## What the harness learned about itself

- A date inside embedded text leaks the clock into the ranking (caught by the purity check
  on raw-retrieval; corrected run dropped 0.76 → 0.68, which is the honest number).
- Judge article-stripping and a deterministic fix-phrase check for adaptation probes were
  needed before the model judge was trusted; `rejudge` re-scores cached answers.
- Consolidation on Athena is model-driven, so purity is checked on the deterministic layer
  alone; the model layer is compared by counts and normalised content only.

## Backlog (personas, not harness)

- [ ] secondary sort key (episode id) at `brain/retrieval.rs:399` and `:510`, or `ORDER BY created_at, id` in `load_episodes_by_ids` (finding 2)
- [ ] brace-balanced object extraction in `brain/oneshot.rs::extract_json_span` (finding 3)
- [ ] bound the reconcile candidate set per cycle, or scale the leg timeout with the fact count (finding 5)
- [ ] decide whether MAIN stays at `low` given the abstention rate (finding 4)
- [ ] merge `direction/memory-year-sim` (sim clock + driver) — the seam is worth keeping
      regardless of the harness
