# memory-year - a simulated year of use, replayed against a memory design

A local-first harness that fabricates a year of one user's chat messages and tasks, with
**ground truth attached to every fact**, replays it day by day through a memory backend
under an **injected clock**, and asks the same probe questions of every backend on the
registry's baseline ladder. The output is a table of numbers that travel with their
predicate: per probe class, per rung, with the consumer, the judge, the budget and the
write cost beside each one.

It exists because Athena's memory has never been compared to anything - not to no memory,
not to the whole history in context, not to plain retrieval over the raw record - and a
design decision imported from a repository we intake is resting on someone else's
uncontrolled variable until it is re-run here.

## What the doctrine requires, and where the harness does it

The registry's `agent-memory` and `eval-harness` subjects already prescribe the
measurement. The harness is those rules made executable:

| Rule (technique) | Where |
| --- | --- |
| Four rungs, cheapest first, same tasks, same consumer (`baseline-ladder`) | `backends/none.py`, `full_history.py`, `raw_retrieval.py`, and the pipeline adapters under `backends/` |
| The learned rung: same pipeline with the learned decision pinned | `--pin` on any adapter that exposes a policy (constant / random / oracle) |
| Stage ablation only under the pressure the stage answers | `--ablate` runs only over a full store and past reversals; the report states the regime |
| The elaboration regime is held fixed across rungs | one answer prompt, one `--elaboration` flag applied to every rung of a run |
| Judge direction and abstention travel with the number | `judge.py` is deterministic first; the model judge is `strict` by default and the report names it; the answerer may say `UNKNOWN` |
| Per-arm recall budget held constant | `--budget-tokens` applies to every rung that injects context |
| Write cost is an axis | every backend counts model calls, tokens and embeddings at write time; reported per unit of history |
| The score is a pure derivation of an injected clock (`memory-value-model`) | `clock.py` supplies every instant; a backend that reads the wall clock fails the harness's clock test |
| The fixture set must not feed on itself (`probe-without-write-back`) | probes are generated from the world's ground truth, never from observed queries; probe reads do not increment usage |
| Coverage denominators are the population (`coverage-instrumentation`) | the world declares its scopes; coverage is reported over all of them, with honest zeros |
| Unaided-baseline screening (`eval-harness`) | a probe that rung 1 answers correctly is dropped from the scored set and counted as screened |
| Scenario cache key (`scenario-design`) | a scenario is `(seed, density, year, world version)` and is regenerated only when one changes |
| Re-run, never inherited | every report is stamped with consumer, embedder, judge, budget, elaboration and date |

## The world and its ground truth

A **world** is one user with projects, preferences, routines, collaborators and a body
of facts that *change*. Every fact is `Fact(id, scope, key, value, valid_from, valid_to,
supersedes)`. The generator walks 365 simulated days and emits **events**:

- `say` - the user states or updates a fact in natural language (from templates, optionally
  paraphrased by a local model and cached);
- `task` - the user asks for a piece of work; the world decides the outcome and, for some
  task kinds, a cause of failure that recurs until the user teaches a fix;
- `teach` - the user gives a procedure or a behavioural rule ("never do X", "always ask
  before Y");
- `noise` - chit-chat and off-topic material, so recall has something to be wrong about.

**Probes** are scheduled at later days and their gold answer is *derived from the world at
the probe's clock*, which is what makes reversals, expiry and scoping testable at all:

| Class | What it asks | What the gold is |
| --- | --- | --- |
| `stable` | a fact never changed | the value |
| `reversal` | a fact updated at least once before the probe | the value valid at the probe's day, and the old value is a *wrong* answer |
| `expired` | a fact whose validity ended | `UNKNOWN` or a statement that it no longer holds; the old value is wrong |
| `scope` | the same key in two projects | the value for the named project only |
| `preference` | a stated preference | the value; applied-preference variants check the answer's form |
| `procedure` | "how do we do X for project P" | the taught steps, in order |
| `rule` | a behavioural rule taught earlier | compliance of the answer's form (no emoji, a confirming question before a destructive action) |
| `failure-cause` | "why did task kind T fail last time" | the world's recorded cause |
| `adaptation` | a task kind that failed twice with a taught fix | the answer applies the fix |
| `distractor` | a question about something never said | `UNKNOWN`; any confident value is wrong |

Probe classes map onto the four structural objections to raw history the doctrine names -
wrong altitude, no supersedence, unbounded growth against a bounded recall, no correction
surface - so the report can say *where* on the year the pipeline's crossover sits, not
only whether it won.

## The rungs

1. `none` - the consumer answers the probe with nothing but the question.
2. `full-history` - every prior event, most recent first, as much as fits the budget.
3. `raw-retrieval` - events chunked and embedded locally; top-k by cosine within the budget.
4. a **pipeline adapter** - the design under test. The first is Athena's own memory,
   driven through the seam the project exposes; others are adapters over designs we
   intake (a graph over extracted entities, a hybrid store, a consolidating pipeline).

Every adapter implements four calls and nothing else:

```
ingest(event, clock)      -> None            # what the design does at write time
consolidate(clock)        -> None            # the design's scheduled passes, if any
recall(probe, clock, budget_tokens) -> Context (text + item ids + tokens)
cost() -> {model_calls, tokens_in, tokens_out, embeddings, store_bytes}
```

`recall` is the only read the harness makes, and it is a probe read: the harness tells the
adapter so the adapter can suppress its own usage feedback.

## The consumer and the judge

One consumer model answers every probe on every rung from `recall`'s context and the
question, under one fixed prompt that permits `UNKNOWN`. **The engine is the Claude Code
CLI on the operator's subscription** (`claude -p`, replaced system prompt, JSON output, no
session, no tools): the same engine Athena ships with, so the default consumer is Athena's
own main-turn model at its effort (`claude:claude-opus-4-8@low`) and the ladder's number is
her number. Model specs are `claude:<model>@<effort>`; every call is cached by content so
re-runs, re-judges and further rungs over the same probes are free, and calls run
concurrently (`--parallel`). "Local-first" here means freedom of database, server,
language and architecture on the operator's machine, never a weaker model: no open-weight
fallback is wired in. The judge is deterministic wherever the gold is a value (normalised
match, abstention detection, wrong-old-value detection) and a strict model judge only for
the form classes (`rule`, `adaptation`, applied preferences), with the lenient variant
behind a flag so the two can be compared on the same answers.

## What the report carries

Per rung × probe class: n, correct, wrong, abstained, *wrong-with-old-value*; per rung:
tokens injected per probe (read cost), model calls and tokens at write time per event,
store size at day 90/180/365, wall-clock per day; and a **crossover table** bucketed by
days of history at probe time. The header names consumer, embedder, judge, budget,
elaboration, seed, density and date. A number without that header does not exist.

## Running

```
py -m memory_year gen   --seed 7 --days 365 --density 10        # world + events + probes
py -m memory_year run   --scenario out/s7 --rungs none,full-history,raw-retrieval,athena
py -m memory_year report --run out/s7/run-<id>
```

Everything is under `evals/memory-year/out/` and gitignored except the committed
scenario templates and the report of record.
