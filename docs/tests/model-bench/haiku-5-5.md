# Haiku 5.5 vs Sonnet 5.5 — the call-class calibration

**Measured 2026-10-08. Deterministic scoring only, no LLM judge.** This is the
evidence behind the routing table in
[`src-tauri/core/src/model_class.rs`](../../../src-tauri/core/src/model_class.rs)
(`CallClass` -> model + effort + optional one-shot escalation). Re-measure before
you move a row; the commands are at the bottom.

Two benches, both committed in `4298b11295`:

| bench | what it measures | size | source |
|---|---|---|---|
| one-shot | headless one-shot calls lifted verbatim from production prompts (fleet naming, `kb_extract`, `auto_triage`, `team_synthesis`, the `nl_query` SQL helper) | 61 tasks x 4 cells x 3 reps = 732 calls, 0 lost to infra | `.planning/oneshot-bench/report.md` |
| Athena | Athena's interactive turn on the full composed constitution, scored by the production dispatcher | 46 scenarios x 3 reps per cell = 414 turns in the report, 0 lost to infra | `.planning/athena-bench/report.md` |

The tables below are copied from those two `report.md` files by script, not
re-typed. They are generated artifacts under `.planning/` (gitignored), so the
copy here is the durable record.

## 1. One-shot bench

Baseline `s55-low`. Costs are the CLI's list-price `total_cost_usd`: compare them
with each other, not with an invoice.

| family | cell | pass % (n) | infra excl | p50 / p90 wall | p50 / p90 api | mean out tok | mean cost | over prod timeout |
|---|---|---|---|---|---|---|---|---|
| session-naming | h55-low | 97.2 (36) | 0 | 11.1s / 15.8s | 1.2s / 1.9s | 59 | $0.0020 | 0 |
| session-naming | h55-med | 94.4 (36) | 0 | 10.4s / 14.8s | 1.3s / 1.6s | 87 | $0.0020 | 0 |
| session-naming | s55-low | 94.4 (36) | 0 | 12.4s / 17.3s | 1.8s / 3.5s | 18 | $0.0392 | 0 |
| session-naming | s55-med | 88.9 (36) | 0 | 11.6s / 16.2s | 1.7s / 3.9s | 17 | $0.0390 | 0 |
| kb-extract | h55-low | 97.0 (33) | 0 | 15.0s / 20.1s | 3.2s / 4.9s | 728 | $0.0026 | 0 |
| kb-extract | h55-med | 100.0 (33) | 0 | 12.1s / 20.3s | 3.6s / 5.2s | 799 | $0.0027 | 0 |
| kb-extract | s55-low | 100.0 (33) | 0 | 14.7s / 21.7s | 2.9s / 3.9s | 327 | $0.0482 | 0 |
| kb-extract | s55-med | 100.0 (33) | 0 | 13.9s / 27.3s | 3.1s / 9.8s | 324 | $0.0481 | 0 |
| auto-triage | h55-low | 93.8 (48) | 0 | 13.4s / 19.4s | 1.4s / 2.2s | 133 | $0.0022 | 0 |
| auto-triage | h55-med | 95.8 (48) | 0 | 12.9s / 18.7s | 1.5s / 2.3s | 165 | $0.0022 | 0 |
| auto-triage | s55-low | 100.0 (48) | 0 | 14.8s / 20.6s | 2.1s / 3.5s | 92 | $0.0425 | 0 |
| auto-triage | s55-med | 100.0 (48) | 0 | 13.3s / 19.9s | 2.2s / 4.4s | 103 | $0.0426 | 0 |
| team-synthesis | h55-low | 100.0 (24) | 0 | 17.6s / 26.8s | 3.2s / 5.5s | 687 | $0.0027 | 0 |
| team-synthesis | h55-med | 100.0 (24) | 0 | 16.3s / 23.6s | 4.2s / 5.5s | 784 | $0.0028 | 0 |
| team-synthesis | s55-low | 95.8 (24) | 0 | 20.6s / 28.1s | 3.9s / 5.6s | 392 | $0.0517 | 0 |
| team-synthesis | s55-med | 100.0 (24) | 0 | 17.4s / 31.9s | 4.5s / 24.5s | 409 | $0.0519 | 0 |
| sql-helper | h55-low | 97.6 (42) | 0 | 14.7s / 23.5s | 3.6s / 5.2s | 696 | $0.0023 | 0 |
| sql-helper | h55-med | 100.0 (42) | 0 | 13.1s / 20.9s | 3.7s / 6.0s | 786 | $0.0024 | 0 |
| sql-helper | s55-low | 95.2 (42) | 0 | 15.8s / 26.1s | 3.7s / 11.1s | 365 | $0.0434 | 0 |
| sql-helper | s55-med | 100.0 (42) | 0 | 12.3s / 22.4s | 3.6s / 5.9s | 391 | $0.0437 | 0 |

By difficulty:

| family | difficulty | h55-low | h55-med | s55-low | s55-med |
|---|---|---|---|---|---|
| session-naming | easy | 96% (23/24) | 92% (22/24) | 96% (23/24) | 92% (22/24) |
| session-naming | hard | 100% (12/12) | 100% (12/12) | 92% (11/12) | 83% (10/12) |
| kb-extract | easy | 100% (15/15) | 100% (15/15) | 100% (15/15) | 100% (15/15) |
| kb-extract | hard | 94% (17/18) | 100% (18/18) | 100% (18/18) | 100% (18/18) |
| auto-triage | easy | 96% (23/24) | 100% (24/24) | 100% (24/24) | 100% (24/24) |
| auto-triage | hard | 92% (22/24) | 92% (22/24) | 100% (24/24) | 100% (24/24) |
| team-synthesis | easy | 100% (12/12) | 100% (12/12) | 100% (12/12) | 100% (12/12) |
| team-synthesis | hard | 100% (12/12) | 100% (12/12) | 92% (11/12) | 100% (12/12) |
| sql-helper | easy | 100% (18/18) | 100% (18/18) | 100% (18/18) | 100% (18/18) |
| sql-helper | hard | 96% (23/24) | 100% (24/24) | 92% (22/24) | 100% (24/24) |

Gate (same shape as the Athena bench): a Haiku cell passes a family when it drops
no more than 2 pts against `s55-low` AND fails no case that `s55-low` passed on
every rep. Verdicts from the report: **kb-extract** h55-med PASS (h55-low FAIL, one
missed split-paragraph merge on `kb-h03-board-decisions`); **team-synthesis** both
Haiku cells PASS; **sql-helper** both PASS; **session-naming** both FAIL, each on
a single easy case (`name-06-tests`, `name-03-db-migration`) while scoring at or
above Sonnet overall; **auto-triage** both FAIL.

## 2. Athena bench

Baseline `s55-low` (production MAIN). Same 166,058-char composed prompt in every cell.

| cell | engine | model | effort | prompt class | p50 prompt chars | runs | infra excluded | pass % | p50 / p90 to first visible text (n) | p50 to first forwarded chunk (end event) | p50 total | p90 total | p50 cost/turn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s55-low | claude | claude-sonnet-5-5 | low | full | 166058 | 138 | 0 | 71.0 | 11.8s / 34.6s (138/138) | 10.5s (input_json_delta, text_delta, thinking_delta) | 19.4s | 43.3s | $0.020 (metered) |
| h55-low | claude | claude-haiku-5-5 | low | full | 166058 | 138 | 0 | 68.8 | 11.0s / 19.1s (138/138) | 9.5s (text_delta, thinking_delta) | 17.3s | 28.6s | $0.001 (metered) |
| h55-med | claude | claude-haiku-5-5 | medium | full | 166058 | 138 | 0 | 68.8 | 11.7s / 21.1s (138/138) | 9.8s (text_delta, thinking_delta) | 18.3s | 34.0s | $0.001 (metered) |

Accuracy by class (pass/runs):

| cell | prompt class | awareness | delegate_vs_inline | format_contract | gated_discipline | layer_one | restraint | tool_selection |
|---|---|---|---|---|---|---|---|---|
| s55-low | full | 15/18 | 9/15 | 14/15 | 9/18 | 12/24 | 18/18 | 21/30 |
| h55-low | full | 15/18 | 9/15 | 12/15 | 9/18 | 12/24 | 18/18 | 20/30 |
| h55-med | full | 16/18 | 9/15 | 10/15 | 9/18 | 13/24 | 18/18 | 20/30 |

Neither Haiku cell is certified: `format_contract` and `tool_selection` drop past
the 2-pt gate. `gated_discipline` and `layer_one` read 50% in **every** cell,
Sonnet included. That is not a model result; see section 6.

## 3. The finding: Haiku's gap is judgment, not capability

Haiku matched or beat Sonnet wherever the task has one checkable right answer
(extraction, a strict JSON structure, SQL) and lost wherever the task is a call:

- **Triage verdicts.** `auto-triage` hard cases: Haiku 92% in both cells, Sonnet
  100%. Every Haiku failure is `agreesWithLabel` (the verdict itself), never format:
  strict-format compliance was 48/48 in all four cells. The case that failed most is
  `triage-h08-quoted-profanity` (3 of 6 Haiku reps), a message that quotes abuse
  without being abusive.
- **Athena memory writes.** `tool-write-fact` ("Remember that I prefer TypeScript
  strict mode in all new projects"): Sonnet 3/3; h55-low 0/3, h55-med 0/3. Haiku
  declines to propose `write_fact` because it reads the provenance contract as
  forbidding a fact without a citable source episode, then offers to remember it
  "in this conversation". It is a refusal, not a format error.
- **Reinforcement did not fix it.** The `h55-low-r` cell (h55-low plus
  `scripts/test/fixtures/athena-bench/reinforcements.md`, whose first rule names
  exactly this: no OP line on `write_fact` asks) scored **0/3** on `tool-write-fact`
  too. Prompt pressure did not move a judgment the model reaches on its own reading
  of the constitution. (`h55-low-r` ran 8 scenarios x 3 reps after `report.md` was
  generated; these per-scenario counts come from `.planning/athena-bench/results.jsonl`.)

## 4. What moved to Haiku and what stayed

From the table in `model_class.rs`:

| class | route | escalates to | evidence |
|---|---|---|---|
| Title | Haiku 5.5 @ low | none | session-naming: h55-low 97.2% vs s55-low 94.4% |
| Classify | Haiku 5.5 @ low | Sonnet 5.5 @ medium | small closed label sets; the escalation covers a bad parse |
| Summarize | Haiku 5.5 @ medium | none | digest of already-gathered material, no judgment |
| Extract | Haiku 5.5 @ medium | Sonnet 5.5 @ medium | kb-extract: h55-med 100% = s55 |
| StructuredJson | Haiku 5.5 @ medium | Sonnet 5.5 @ medium | team-synthesis: h55-med 100% vs s55-low 95.8% |
| Sql | Haiku 5.5 @ medium | Sonnet 5.5 @ medium | sql-helper: h55-med 100% vs s55-low 95.2% |
| Verdict | Sonnet 5.5 @ medium | none | triage hard: Haiku 92% vs Sonnet 100% |
| Synthesis | Sonnet 5.5 @ medium | none | judgment class |
| AgentTask | Sonnet 5.5 @ medium | none | judgment class (acts on the user's environment) |
| Director | Sonnet 5.5 @ medium | none | pinned; moves only by explicit decision |
| Build | Sonnet 5.5 @ low | none | unmeasured on Haiku until the build bench runs |

A unit test (`judgment_classes_stay_off_haiku`) fails if Verdict, Synthesis,
AgentTask, Director or Build is ever routed to Haiku. Athena's conversational turns
are NOT on this table (`companion::model_routing`), and neither are persona
executions (`db::model_routing`).

## 5. The escalation rule

`personas_engine::cli_process::with_escalation` runs the call on its class's route.
If the call site's **own** parser or validator rejects the output
(`AttemptError::BadOutput`) and the row names an `escalate_to`, it retries **once**
on that route. A second `BadOutput`, or any `Fatal` (spawn failure, timeout, IO),
is the error: those belong to failover, not escalation. Every escalation is logged
under the `model_routing` target, and call sites that book `dev_llm_spend` book the
escalated leg with `trigger_kind = "escalation"`, so the escalation rate is
measurable from real runs. A class whose escalation rate climbs is a row to re-tune.

Census rule `model-literal-outside-class-table` counts the call sites that still
declare their own `const *_MODEL: &str` (25 at `5defd894d4`), ratcheting down.

## 6. Caveats

- **Wall time is mostly CLI startup.** Every call is a cold `claude -p` spawn. In
  the one-shot bench p50 wall is 10-21 s while p50 API time is 1-5 s, so the wall
  deltas (+2% to -21% for Haiku) say little about model speed. The API column is
  the model; the wall column is the harness.
- **Costs are list-price and relative.** `total_cost_usd` is what the CLI reports
  at list price. On a subscription seat nothing is billed per call; the useful fact
  is the ratio (Haiku 94-95% cheaper per call in every family), not the dollars.
- **Ten Athena scenarios were stale.** They failed in every cell on every rep,
  Sonnet included: `delegate-dev-job`, `delegate-drive-count`, `gated-assign-team`,
  `gated-delete-goal`, `gated-run-persona`, `layer-one-daily-brief`,
  `layer-one-findings-list-7-items`, `layer-one-smalltalk`, `tool-github-prs`,
  `tool-unpinned-sentry`. They depress `gated_discipline`, `layer_one`,
  `delegate_vs_inline` and `tool_selection` equally for every cell, so the
  between-cell comparison stands but the absolute pass rates do not. Corpus v3
  (`scripts/test/fixtures/athena-bench/scenarios.json`, `_v3`) recalibrates eight of
  them (expectation widened with `anyOf`, or the missing roster seeded) and leaves
  two failing on purpose: `delegate-drive-count` (every cell counts files inline
  with Bash for 21-52 s instead of delegating) and `tool-unpinned-sentry` (the
  composed prompt advertises Sentry as wired and never says nothing is pinned, a
  composer fix). The numbers above are corpus v2; v3 needs a fresh run.
  `tool-write-goal` also named a date that had passed by run day; v3 makes it relative.
- **Three reps per cell.** A one-case difference (session-naming's single easy
  failures) is inside run-to-run noise; the triage and memory-write gaps are not,
  because they repeat across both Haiku cells and the reinforced cell.

## 7. Re-measure

```bash
# one-shot bench (no LLM in --dry-run: proves every check passes a good sample and fails a bad one)
node scripts/test/oneshot-model-bench.mjs --dry-run
node scripts/test/oneshot-model-bench.mjs --cells h55-low,h55-med,s55-low,s55-med --reps 3 --parallel 4
node scripts/test/oneshot-model-bench.mjs --report --baseline s55-low

# Athena bench (--dry-run builds/uses the athena-bench-validate binary, no model)
node scripts/test/athena-model-bench.mjs --dry-run
node scripts/test/athena-model-bench.mjs --cells s55-low,h55-low,h55-med --reps 3 --parallel
node scripts/test/athena-model-bench.mjs --report --baseline s55-low
```

Both runners resume: a `(cell, case, rep)` key already in `results.jsonl` is
skipped, so a rate-limited run is re-invoked, not restarted (`--fresh` ignores
existing rows). Neither has a re-score mode: `--report` aggregates the pass/fail
stored at run time, so an expectation change needs a re-run of the affected
scenarios (`--scenarios <id,...> --fresh`) to show up in the report.
