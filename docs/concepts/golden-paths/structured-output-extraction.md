# Golden path — structured output extraction

> Situation node: `ai-agents/prompt-and-output/structured-output-extraction` · [situation spine](../situation-spine.md)
> Composed 2026-08-16 against `master` @ `bbb1a8864`. **Recurrence 17 · risk HIGH · sides: server · convergence: mixed.**
> Sweep: **963** non-generated Rust files walked by the census engine and by two further scanners written
> for this path. Every model-reply parser in the tree enumerated and hand-classified; `engine/src/safe_json.rs`,
> `companion/brain/oneshot.rs`, `companion/athena_reaction.rs`, `engine/deliberation.rs`, `engine/src/parser.rs`,
> `engine/kpi_binding.rs`, `engine/team_assignment_matching.rs`, `companion/proactive/{message,execution,backlog}_*.rs`
> and `engine/runner/mod.rs` read in full.
> **Five extractors were transliterated and EXECUTED** — the port was validated by re-running **26 of the
> repo's own `#[cfg(test)]` assertions** against it (26/26 pass) — then fed 18 realistic malformed replies,
> then **replayed over 2,058 real stored Claude replies** from a read-only copy of the operator's live
> `personas.db` (347 MB) and `personas_data.db` (17.5 MB), copied 2026-08-15 23:44.
> Convergence oracle run against **`brainiac`, `ascent`, `vibeman`, `personas-cloud`, `personas-web`**.
> Dimensions: **resilience · cost · function · code-quality · security**.
> **Settles:** what the program is allowed to believe when the model's text does not yield the value it asked for.

---

## 0. The headline, before anything else

**This app can record that a model reply failed to parse. It has the column, the writer, the KPI and the
rollup. Three of its 47 model-reply parsers use it. In 1,779 recorded model turns, exactly one row says a
parse failed — and that row cost $0.177867 for 2,409 output tokens and is flagged `is_error = 0`.**

`turn_ledger::update_outcome(pool, turn_id, r#"{"parse_failure":true}"#)` is written at exactly three sites
(`proactive/message_triage.rs:322`, `proactive/execution_review.rs:739`, `proactive/backlog_triage.rs:323`).
It is read by `commands/companion/observability.rs:247` into a `parse_failures` KPI and by
`proactive/rollup.rs:98`. The instrument works. Its coverage, measured against the live ledger:

| lane (`companion_turn.trigger_kind`) | turns | $ | rows carrying **any** `outcome_json` | can report a parse failure |
|---|---:|---:|---:|---|
| `deliberation_moderate` | 770 | 22.94 | **0** | no |
| `deliberation_turn` | 555 | 17.31 | **0** | no |
| `deliberation_proposal` | 117 | 2.89 | **0** | no |
| `deliberation_split` | 26 | 1.17 | **0** | no |
| `deliberation_merge` | 20 | 0.63 | **0** | no |
| `exec_triage` | 36 | — | 36 | **yes — and 1 of the 36 says the parse failed** |
| everything else | 255 | — | 89 | no |

The five deliberation lanes are **1,488 of the 1,636 headless turns (91%)** and **$44.94**. Not one of them
can say "the reply did not parse", because their parsers return `Option<T>` and their callers spend the
`None`:

```rust
Ok((parse_decision(&blob).unwrap_or_default(), cost))   // engine/deliberation.rs:516
let turn = parse_turn(&blob).unwrap_or_default();       // engine/deliberation.rs:1372
```

`ModeratorDecision::default()` is `round_outcome: Stalled`, `action: Discuss`, `status: Continue`,
`next_speakers: []` — and every field is `#[serde(default)]`, so this value is *also* what a
`{"deliberation": {}}` produces. `plan_transition` (`:214`) folds it into `TickOutcome::Continue { speakers: [] }`
with `consecutive_stall_rounds + 1`. The tick then runs **zero** persona turns, increments the round, leaves
the deliberation `open`, and pays for another moderator call next tick. Three in a row and
`plan_transition:263` escalates to the user with `reason: "stall_limit"` — *the team is stuck* — when what
actually happened is *the parser failed three times*. The live database holds 142 deliberations, 593 rounds,
**$138.35**, with 16 carrying `consecutive_stall_rounds = 1` and 4 carrying `2`. Every one of those 20 stalls
is either a real stall or a parse failure and **nothing anywhere distinguishes them**.

The same shape one layer down: `run_persona_deliberation_turn:1372-1414` posts to the channel only
`if !turn.message.trim().is_empty()`, then returns `Ok(TurnOutcome::Spoke)` regardless. A persona whose reply
did not parse is recorded as having spoken and says nothing.

**Nothing in this document is about the model being wrong.** It is about the fact that a paid call which
produced no usable value and a paid call which produced a legitimate "nothing to add" are, in this codebase,
the same bytes in the same row.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and every clause
carries its warrant. No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** Extraction is a *measurement of a paid artifact*, and every measurement has three outcomes,
> not two: the value, the absence of a value, and **the failure to measure**. A design that collapses the third
> into the second is not simpler; it is lying about which of two very different events occurred.
>
> **P2 — physics, and the sharpest clause here.** The extractor's **return type decides everything downstream**.
> A type that can only say "no value" gives the caller nowhere to put the reason, and a caller with nowhere to
> put the reason does not log it, does not count it, does not retry it and does not tell anyone. Every
> observability rule you write afterwards is an attempt to re-supply information the signature already threw away.
>
> **P3 — physics.** A default substituted for a failed extraction must be *distinguishable at the point of use*.
> A default that is also a legitimate model answer is not a fallback — it is a fabricated answer with the
> program's authority behind it. The test is not "is the default safe"; it is "can anything downstream tell
> this apart from the real thing".
>
> **P4 — physics.** Optionality on an envelope's fields is a decision about what a *refusal* deserializes into.
> When every field of a reply type has a default, a `{"refusal": "…"}` — or any well-formed object of the wrong
> shape — parses cleanly into a confident, empty, entirely fabricated answer. At least one field must be
> required, and it should be the one the control flow branches on.
>
> **P5 — physics.** Tolerance and accuracy are different axes and they trade against each other. A more forgiving
> extractor does not find the right object more often; it finds *some* object more often. Where a reply can
> contain several structured blocks, "the first one that balances" and "the one carrying the key I asked for"
> are different answers, and only the second is an answer to the question.
>
> **P6 — physics.** More than one extraction algorithm in a codebase is more than one contract with the model,
> maintained by nobody. The copies do not fail together; they disagree, silently, on the same input — which
> means a reply the system accepts in one lane is discarded in another and no layer records the discrepancy.
>
> **P7 — ergonomics, and the most replicated absence in this corpus.** A reply that was cut off is not a reply
> that was malformed, and the producer knows which it was. If the truncation signal is not carried into the
> value the extractor receives, no downstream code can ever recover it, and a truncated answer will present as
> either a parse error or — worse — as a complete answer with fields missing.
>
> **P8 — cost.** Extraction happens *after* the money is spent, so every extraction failure is a paid loss.
> That makes two things obligatory that are optional elsewhere: the failure must be recorded with its price,
> and a cheap precondition that could have failed the call must be checked before it, not after.
>
> **P9 — ergonomics.** A retry is the only remedy an unattended extraction has, and it is only correct when the
> failure was stochastic. So the extractor must distinguish "the model declined" from "the model was malformed",
> and retry exactly one of them.
>
> **Scale condition.** P1–P4 are correctness on the first call. P5 and P6 begin to bite at the second extractor
> or the second envelope in one reply. P7 and P8 pay the first time someone asks where the money went. P9
> matters only once nobody is watching.

### Warrant evidence — the sibling repos, censused independently

`brainiac` (Rust, 7 `.complete()` sites → 6 extractors → 29 classified decision points), `ascent` (Next.js,
11 sites behind **one** shared parser), `vibeman` (Next.js, 25 sites behind **five** helpers, two of them
byte-identical), `personas-cloud` (Node, 10 sites, 100% NDJSON-over-a-spawned-CLI), `personas-web` (**the
near-negative control** — 0 LLM SDKs, 0 provider endpoints, 0 spawns, and exactly **1** second-hand
model-authored payload).

- **P2 is convergent and it is the single strongest oracle result.** The repos sort cleanly by what their
  extractor's failure *type* can carry. `ascent` throws a typed `ProviderParseError` carrying the offending
  text (`lib/llm/json.ts:140`) — and it is the only sibling with a retry plan (`scan.ts:385-411`,
  primary → retry → failover → mock), because a thrown error is something an orchestrator can catch.
  `vibeman`'s `extractJSON` (`lib/llm/parse-response.ts:31`) `return undefined` — and vibeman has **0** sites
  that retry on malformed output, despite owning a full backoff/circuit-breaker stack that keys only on
  transport codes (`retryStrategy.ts:56-107`, and that module has **zero import sites**). Same team, adjacent
  repos, opposite return types, opposite outcomes. **The recovery capability tracks the failure type, not the
  engineering effort.**
- **P3 is convergent as a defect in three repos and *solved* in two — which is the test that matters.**
  Defect: `vibeman` 10 of 25 sites end in a default, including `standupGenerator.ts:385-390` returning
  `{ success: true, summary: fallback }` for a template standup, and `:225-228` fabricating
  `velocityTrend: 'stable'`, `burnoutRisk: 'low'` from a `{}`; `personas-cloud` 7 of 10, including
  `httpApi.ts:1954-1957` returning HTTP 200 `{status:'completed', persona:null, error:null}` when the reply
  was prose; `brainiac` 11 of 29. Solved: `ascent` built `validateAssessment` which *never throws* and then
  discovered that was the bug — `provider.ts:277-287` says so verbatim (*"a response that parsed but said
  nothing slips straight through to the engine, which then renders the deterministic signal floor under the
  configured provider's name — with no 'AI was unavailable' caveat"*) — and closed it with
  `isAssessmentUsable` at `scan.ts:319`. And `personas-web`, the repo with **no model calls at all**, is the
  only one that wrote the rule down: `reviewStore.ts:35-39`, *"Fail-loud defaults: if JSON.parse throws or
  payload.severity is missing or invalid, we promote the review to 'critical' … The old behavior defaulted to
  'info' — under DEFAULT_ESCALATION_POLICY that silently widens the SLA to 8h and routes the row to
  auto_approve."* **Two independent discoveries that the direction of the default is the whole decision.
  Physics.**
- **P4 is convergent, and one repo names it exactly.** `brainiac/extract.rs:410` is a one-line guard —
  `v.get("memories")?; // require the key to be present` — with a doc comment stating the failure it prevents:
  *"a valid-but-wrong object (a refusal/reasoning wrapper like {"refusal":"…"}) would otherwise deserialize to
  an empty vec and masquerade as a clean 0-extraction."* Measured across brainiac's five model-reply envelopes:
  **1 carries that guard, 2 are protected by an accidentally-required field, 1 is unprotected**
  (`divergence.rs:67-80`, every field `#[serde(default)]` including the `bool` the control flow branches on) —
  and *that* is the one whose parse failure leads to a `DELETE` (`divergence.rs:267`). The unguarded case in
  this repo is `ModeratorDecision` (§0).
- **P5 does NOT converge — it is measured here and nowhere else**, because no sibling's model emits more than
  one structured block per reply. Reported as an invention with local measurement behind it (§7.C), not doctrine.
- **P6 is convergent, cleanly, and the correlation is with quality not count.** `ascent`: 1 helper / 11 sites,
  11/11 validated, 0 unvalidated parse→effect paths. `vibeman`: 5 helpers / 25 sites, 8/25 validated, 4
  unvalidated parse→effect paths including `fs.writeFile(fullPath, result.updatedCode)` gated on truthiness
  alone (`fileScannerService.ts:510`). `brainiac`: 1 shared `extract_json_object` used by 4 of 5 sites, with
  one straggler (`faithfulness.rs:133`) that reimplements it as `find('{')` + `rfind('}')` — the weaker
  algorithm, ~200 lines from the shared one. **Every repo that consolidated is better on every other axis.**
- **P7 is the strongest *silence* in the whole corpus: 0 of 53 external extraction sites check a truncation
  signal before parsing, and neither does this repo.** `ascent` 0/11 — despite writing three separate comments
  diagnosing truncation as the cause of silent mock-degradation (`bedrock.ts:97-99`, `openai.ts:50-53`,
  `json.ts:62 // unbalanced — truncated output`). `vibeman` 0/25 — and it is worse than not checking: three
  providers *capture* the field into `metadata` (`anthropic-client.ts:123`, `openai-client.ts:188`,
  `groq-client.ts:170`) and **grep finds zero consumers**. `personas-cloud` 0/10. `brainiac` 0/7 — and there it
  is *uncheckable*: `ChatResponse` (`gateway/src/lib.rs:56-62`) has no stop-reason field, so no caller could
  read one. Five repos, five different stacks, same hole. This is exactly the shape the
  [headless-model-call](./headless-model-call.md) path found for *prompt* truncation (36 of 202 sites record
  it here; 0/11, 0/30, 0/3, 1/6 in the siblings). **Both ends of the prompt are unmeasured, everywhere.**
  `vibeman/anthropic-client.ts:100-104` shows the worst version: a forced tool's truncated `input` object is
  `JSON.stringify`'d, so it becomes syntactically perfect JSON and truncation cannot even *present* as a parse
  error — it presents as missing fields, which then hit the `|| 'medium'` defaults. **Truncation laundered into
  a confident answer.**
- **P8 converges as a near-miss.** `brainiac` is genuinely good here — it has a regression test literally named
  `nothing_below_the_bar_ever_costs_a_model_call` (`contradict.rs:267`) — and still bills a call per
  (cluster, axis) before touching a schema whose partial unique index may not exist (`divergence.rs:283-287`).
  `personas-cloud` has the ordering *inverted*: its `402 Monthly budget exhausted` gate (`httpApi.ts:1293`)
  reads a ledger incremented only `if (msg.totalCostUsd > 0)` (`dispatcher.ts:474-484`), so a run whose
  `result` line never arrived spends real money and never moves the gate.
- **P9 is weak: 2 of 5.** `brainiac` retries (`MAX_REPAIR_ATTEMPTS = 2`, three temperature passes) with the
  best-argued policy in the corpus (`extract.rs:443-453`: *"Real Qwen parse failures are largely STOCHASTIC …
  a fresh re-ask often just succeeds"*). `ascent` retries via its orchestrator. `vibeman` 0, `personas-cloud` 0.
  This repo has 1 (§6). Call it strong, not settled.
- **A clause with NO external warrant: schema-constrained decoding.** Only `ascent` uses provider structured
  outputs (Gemini `responseJsonSchema`, Bedrock forced-tool `inputSchema`, OpenAI `response_format`, all from
  one `schema.ts`). `brainiac` has a `json_mode: bool` that on Anthropic is *literally a sentence appended to
  the system prompt* (`providers/anthropic.rs:70-77`). This repo drives the Claude **CLI**, which offers no
  schema parameter at all. **"Use the schema API" is not portable advice and is not in §2.**

---

## 1. Trigger

You are in this situation when you are about to type or say any of:

- "parse the JSON the model returned", "pull the object out of the reply", "it wraps it in a ```json fence"
- "the prompt says *respond with ONLY JSON* so I can just `from_str` it"
- "if it doesn't parse, just fall back to the default / return None / skip it"
- "make the fields `#[serde(default)]` so a partial object still deserializes"
- "why did the scan report zero findings?" / "why did the team stall?" / "why is this report empty?"
- **The "about to write X" test:** you are about to type `serde_json::from_str::<T>(&blob)`,
  `fn parse_something(text: &str) -> Option<T>`, `.unwrap_or_default()` on a parse result,
  `strip_prefix("```json")`, `#[derive(Deserialize, Default)]` on a reply envelope, or a new
  `"respond with only JSON"` line in a prompt.

You are **not** in this situation when the input is a file you wrote, a database column, an IPC payload, or
an HTTP body from a service with a contract — those are `row-to-struct-mapping`, `json-blob-column` and
`command-input-validation`. The discriminator is **whether a model was paid to produce the bytes**: that is
what makes the failure a loss rather than a validation event, and what makes "we don't know" a fact worth
storing.

### Boundaries with the three adjacent paths

- **[`headless-model-call.md`](./headless-model-call.md)** owns everything up to the bytes coming back — the
  owner, the ceiling, the payer, the model pin, the meter. This path begins at the returned string. Non-overlap
  test: a call that is perfectly bounded, metered, pinned and attributed, whose reply is then dropped by a
  `.ok()` with no record, is **100% compliant with that path and 0% with this one**. That is the $0.177867 row
  in §0 exactly.
- **[`model-composed-ui.md`](./model-composed-ui.md)** owns *which object* and *what it may name* — the closed
  vocabulary, the id set, the render boundary, and the 15 hand-rolled backward brace scans (its D3 and its
  `handrolled-llm-envelope-scan` rule). It answers "was this a legal answer". **This path answers the prior
  question: was there an answer at all, and if not, does anything know.** Where the two touch — the extractor
  population — this document cites that path rather than re-deriving it, and its §9 rule deliberately keys on
  a different token (a *signature*, not a `rfind`).
- **[`swallowed-error-telemetry.md`](./swallowed-error-telemetry.md)** owns errors the program authors reaching
  a door. A malformed model reply is not an error the program made; it is expected input with a price tag. The
  overlap is real and named in §9.

---

## 2. The one way

**Make the extractor's failure a value that carries its reason, record that reason against the call that was
paid for, and never let a manufactured default reach a place that cannot tell it apart from a real answer.**
Concretely: write the parser as `fn parse_x(text: &str) -> Result<T, AppError>`, never `-> Option<T>` — the
`Option` is not a smaller type, it is a type with nowhere to put *why*, and every missing log, missing metric
and missing retry downstream is that hole. Get the span with the **one** shared extractor
(`oneshot::extract_json_span` for "the whole reply is the object", `athena_reaction::extract_json_envelope::<T>`
when a key anchors it inside prose) and hand the serde error, plus a bounded head of the offending text, to the
caller — `extract_json_span`'s `context_label` argument exists so the message names *which* call produced the
garbage. Give the reply envelope **at least one required field**, ideally the one the control flow branches on,
so a well-formed object of the wrong shape (`{"refusal": …}`) fails to deserialize instead of arriving as a
confident empty answer. On the failure path do three things in order: write the fact against the paid turn
(`turn_ledger::update_outcome(pool, turn_id, r#"{"parse_failure":true}"#)`), retry **only** if you can
distinguish a malformed reply from an explicit decline (`kpi_binding.rs:480` is the shape — two attempts, and
`break` the moment the model says `null`), and then surface or propagate — never substitute. If you genuinely
must degrade, degrade to a value that is *typed as degraded*, not to `T::default()`. And before the call, check
the cheap precondition that could have made the call pointless: extraction is the one step that always runs
after the money is gone.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src-tauri/src/companion/brain/oneshot.rs:362` — `extract_json_span(text, context_label) -> Result<&str, AppError>`** | **The span extractor to reach for, and the best failure type in the tree.** Strips a leading fence, then `find('{')` .. `rfind('}')`, and every one of its three failure modes returns an `AppError` naming the caller (`"consolidation reply"`, `"night plan reply"`) **and** a 200-char preview of what actually arrived. 6 adopters, all of which propagate with `?`. Its `context_label` is a required argument — you cannot produce an anonymous parse failure through this door. |
| **`src-tauri/src/companion/athena_reaction.rs:855` — `extract_json_envelope::<T>(blob, marker) -> Option<T>`** | The marker-anchored variant, for when the object is embedded in prose and a key identifies it. String- and escape-aware via `match_braces` (`:817`), last-occurrence-wins. **Use it for the span; do not use its `Option` as your parser's return type** — wrap it and give the caller a reason (§7.A). [`model-composed-ui.md`](./model-composed-ui.md) §7 D3 owns its 12 hand-rolled copies. |
| **`src-tauri/engine/src/safe_json.rs:108` — `extract_balanced_object(s)`** · **`:145` — `parse_lenient_json::<T>(raw)`** | The forward, string-aware brace matcher, and the "strict first, then the first balanced object, then a `Result` carrying 300 chars of the head" wrapper. `parse_lenient_json` is the correct shape and has 2 adopters. **Measured on 2,058 real replies it is by far the most tolerant extractor in the repo (80.3% yield vs 0.0%)** — which is a hazard as much as a feature; see §7.C. |
| **`src-tauri/src/companion/turn_ledger.rs:359` — `update_outcome(pool, turn_id, outcome_json)`** | **The parse-failure recorder, and the only reason this document can quantify anything.** Writes `outcome_json` onto the `companion_turn` row for the call that was paid for. `{"parse_failure":true}` is read by `commands/companion/observability.rs:247` into a `parse_failures` KPI and by `proactive/rollup.rs:98`. The wrappers hand back a `turn_id` precisely so you can do this. **3 users; it should have 34 more.** |
| **`src-tauri/src/engine/kpi_binding.rs:478-505` — the bounded retry with a decline check** | The only retry loop in the headless extraction surface, and the only place that distinguishes *malformed* from *declined*: `for attempt in 0..2u8`, `break` when the blob contains `"kpi_procedure": null`, `tracing::warn!(attempt, blob_len, excerpt = …)` on each miss, and two different user-facing messages at the end. This is P9 discharged in 25 lines. |
| **`src-tauri/src/engine/team_assignment_matching.rs:311` — `parse_llm_match_response`** + **`:518-545`** | The reference **post-parse validation**: `parse_lenient_json` into a `Result`, then reject an empty `steps` vec as its own error (*"Decompose returned zero steps — refine the goal"*), then filter every model-supplied `suggested_persona_id` against the real candidate `HashSet` — *"drop the suggestion (let the user pick manually) rather than emit a bogus id."* Parsing is not validating; this is what the second half looks like. |
| **`src-tauri/src/companion/brain/briefing.rs:232` — `sanitize_briefing_spec(raw, delta)`** | The reference **closed-set** validator: id sets derived from the same document the prompt was built from. [`model-composed-ui.md`](./model-composed-ui.md) §6 owns it in full; it is listed here because it begins with `extract_json_span(raw, "briefing reply")?` and is what step 6 below points at. |
| **`src-tauri/engine/src/auto_triage.rs:187` — `parse_verdict_response(raw) -> Result<AutoTriageDecision, String>`** | Strict, then balanced-object fallback, then a `Result` carrying 500 chars — **and a closed-set coercion of the model's verdict word** with `other => return Err(format!("Unrecognised verdict value: {other:?}"))`. An unrecognised verdict is an error, not a coin flip. |

**Explicitly NOT primitives.**
`engine/src/safe_json.rs:175 lenient_from_str` / `:191 lenient_from_str_as` are a five-stage recovery pipeline
(fence strip → body extract → trailing commas → truncated keywords) with **16 dedicated passing tests** and
**zero callers**, carrying `#[allow(dead_code)] // planned API`. Do not adopt it before reading §7.D: replayed
over 2,058 real replies it recovers **26 (1.3%)** where `parse_lenient_json` recovers **1,652 (80.3%)**. It is
tested, dead, *and* the weakest extractor in the tree on real data — three independent reasons, and the tests
are why nobody noticed. `src/lib/utils/parseJson.ts:26 safeJsonParse` recovers **0 of 2,058**; it is
`JSON.parse` with a tuple signature.

---

## 4. Steps

1. **Decide what a failure to extract *means* for this call, before you write the parser.** Is it a fact the
   user must learn, a leg to retry, or an item to skip? All three are legitimate; substituting a default is
   not, unless the default is typed as degraded. Write the answer in the doc comment —
   `director.rs:459-461` and `brainiac/extract.rs:462-471` both do this and both are better for it.
2. **Return `Result<T, E>`, not `Option<T>`.** This is the whole path in one edit. If you find yourself
   wanting `Option`, ask whether "absent" and "unreadable" are genuinely the same event for this caller; in
   34 of the repo's 47 model-reply parsers the answer is no and the type says yes.
3. **Take the span from a shared extractor, not a fresh brace scan.** `extract_json_span(text, label)` when
   the reply should be one object; `extract_json_envelope::<T>(blob, "\"key\"")` when it is embedded in prose
   and a key identifies it. Do not write `rfind('{')` — that population is 15 and
   [`model-composed-ui.md`](./model-composed-ui.md) §9 already ratchets it down.
4. **Give the envelope one required field.** `#[serde(default)]` on *every* field means a `{"refusal": …}`
   deserializes into a confident empty answer (§7.B). Make the field the control flow branches on
   non-defaulted, so the wrong shape fails loudly. This is `brainiac/extract.rs:410` generalised.
5. **Carry the offending text into the error, bounded.** `preview(raw, 200)` /
   `truncate_on_char_boundary(trimmed, 300)`. An error that names a schema does not tell you what the model
   said; `brainiac/extract.rs:743-747` states the reason: *"'not an array of the expected shape' names a
   schema, not the thing the model actually said."*
6. **Validate after you parse — it is a separate step and it is not optional.** Required fields present,
   enum values in a closed set, every model-named id checked against the set the model was shown. Parsing
   proves the bytes were JSON. `team_assignment_matching.rs:530-545` and `briefing.rs:232` are the two shapes.
7. **Record the failure against the turn that was paid for.** `update_outcome(user_db, &turn_id,
   r#"{"parse_failure":true}"#)`. The wrappers return a `turn_id` for exactly this. Without it, the call is a
   normal successful row with a normal cost and no trace that it bought nothing.
8. **Retry only what is worth retrying.** Distinguish malformed from declined (`kpi_binding.rs:507`), retry
   the first, `break` on the second. An unattended extraction has no other remedy.
9. **Check the cheap precondition first.** The extraction runs after the spend; anything that could have made
   the call pointless — a missing table, an absent config, an empty candidate list — belongs before it.
10. **And then stop.** Which component may render it, which action may fire, which id may be named — that is
    [`model-composed-ui.md`](./model-composed-ui.md)'s territory and it begins where this step ends.

### Can the type make the wrong call impossible? — asked before §9

**Yes, and it is the entire finding.** See §9.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`fn parse_x(blob: &str) -> Option<T>`** | The signature discards the reason before any caller can decide what to do with it. **34 sites in 22 files.** Measured consequence: of the five deliberation lanes (1,488 turns, $44.94) **zero** rows can report a parse failure, while the one lane whose parser feeds a `parse_failure` write has recorded one. |
| **`parse_x(&blob).unwrap_or_default()`** | Two independent layers of "a failure looks like a real conservative answer": `unwrap_or_default()` at the call site *and* `#[serde(default)]` on every field, which produce the byte-identical value. `deliberation.rs:516` and `:1372`. |
| **`#[derive(Deserialize, Default)]` with every field `#[serde(default)]` on a reply envelope** | A `{"refusal":"I can't"}`, a `{}`, or any well-formed object of the wrong shape deserializes cleanly into a confident empty answer. `brainiac` found this, wrote the fix as one line (`v.get("memories")?`), and left 1 of its 5 envelopes unprotected — the one whose failure path is a `DELETE`. |
| **A protocol parser that never returns `None`** | `engine/src/parser.rs:506-618` — 11 `PROTOCOL_KEYS` parsers, **11 of 11 return `Some(...)` unconditionally**, with `str_field_or(msg, "content", "")`. `{"user_message": {}}` becomes a delivered report with an empty title and empty body. This is the highest-volume extraction site in the app. |
| **A default that is also a legitimate answer** | `RoundOutcome::Stalled` is both "the model judged this round a stall" and "we could not read the model". Its doc comment calls the defaults *"conservative"* and *"fail safe"* — and they are, in isolation; the defect is that they are **indistinguishable**, which is a property of the pair, not of either value. |
| **`.ok()` / `if let Ok(x) = …` on a model reply with no `else`** | The serde error — which names the byte offset and the expected type — is destroyed at the one moment it was diagnostic. Present at 34 of the 47 parsers. |
| **Assuming a reply carries one structured block** | **Measured: 1,927 of 2,058 real replies (93.6%) carry more than one distinct protocol envelope key.** "The first `{` that balances" and "the object carrying the key I asked for" are then different answers; they differ on **121** real replies. |
| **Requiring the envelope to be the entire line** | `runner/mod.rs:2515-2518` needs `trimmed.starts_with('{')` **and** the whole line to be exactly one JSON document. Measured on real output: **10 of 1,805 replies (0.55%) carry a `user_message` the runner cannot see** — 7 because a second envelope shares the line, 3 because the model wrapped it in backticks. Those user reports were never delivered, silently. |
| **Reaching for the more tolerant extractor** | Tolerance is not accuracy. On 2,058 real replies `parse_lenient_json` yields an object **80.3%** of the time; that number says nothing about whether the object was the answer. See §7.C. |
| **Trusting a passing test suite about a recovery pipeline** | `safe_json::lenient_from_str` has 16 passing tests and recovers **26 of 2,058** real replies (1.3%). Every test input is a hand-written miniature; every real input is a 7.9 KB prose report. The tests are not wrong — they are unrepresentative, and they are the reason nobody re-measured. |
| **Parsing without checking whether the reply was cut off** | **0 of 963 Rust files read a model-output truncation signal.** `finish_reason` appears 0 times; `CliUsage::from_result_event` (`turn_ledger.rs:84-96`) reads `is_error` but not `subtype`, so the CLI's `error_max_turns` never reaches the ledger. |
| **Naming a column after truncation and storing something else in it** | `persona_executions.log_truncated` is assigned `logger.had_write_errors()` (`runner/mod.rs:2759`). It records log-file **write errors**. It is `0` on all **2,188** rows, and the real 10 MB cut-off at `:2506` writes no column, no counter and no marker. |

---

## 6. Evidence

**The one site to copy: `src-tauri/src/companion/brain/oneshot.rs:362-383` — `extract_json_span`, together
with any of its six callers.**

It is the only extraction door in 963 Rust files where the *signature* discharges the obligations of §2:
the label is a required argument (so no failure is anonymous), the return type is `Result` (so the reason
survives), and all three failure branches carry a bounded preview of what the model actually said. Its
callers are one line each and cannot get it wrong:

```rust
let json = extract_json_span(text, "consolidation reply")?;      // consolidation.rs:1012
serde_json::from_str(json).map_err(|e| AppError::Internal(format!(
    "consolidation reply not valid JSON: {e}; got: {}", preview(json, 400))))
```

Its sibling `sleep_cycle.rs:2027-2030` states the doctrine in a comment: *"An unparseable reply is a hard
error: the cycle would otherwise report a clean pass over a leg that returned nothing usable."* That sentence
is P1.

Also exemplary:

- **`src-tauri/src/engine/kpi_binding.rs:478-505`** — the retry, the decline check, the per-attempt
  `tracing::warn!(attempt, blob_len, excerpt = …)`, and two distinct user-facing errors for
  *"the composer judged this connector unable to answer"* vs *"the composer could not produce a confident
  procedure"*. The only place in the repo where an unattended extraction failure is both recoverable and
  legible. (Its spend row still names the wrong model — [`headless-model-call`](./headless-model-call.md) §7.D.)
- **`src-tauri/src/engine/team_assignment_matching.rs:518-545`** — parse into a `Result`, then reject an
  empty result as its own error, then filter model-named ids against the real candidate set. Three steps,
  three different failure meanings, none of them a default.
- **`src-tauri/engine/src/auto_triage.rs:187-217`** — a `Result` carrying 500 chars of head, plus
  `other => return Err(format!("Unrecognised verdict value: {other:?}"))`. A closed set with a loud rejection.
- **`src-tauri/src/companion/proactive/backlog_triage.rs:318-330`** — the best `None` arm in the tree:
  writes `{"parse_failure":true}` onto the paid turn **and** returns a user-facing
  `"Athena returned no usable triage verdict for this batch. Try again with fewer items."` The user learns,
  the KPI learns, and the message is actionable.
- **`src-tauri/src/engine/director.rs:459-461`** — a documented silent drop: *"`None` if absent/malformed —
  the run still yields coaching verdicts; we just won't write a score onto the execution."* Still a deviation
  (§7.A), but an honest one: it names the trade rather than hiding it.
- **`src-tauri/src/engine/deliberation.rs:1383-1405`** — a model-named capability id resolved against the
  persona's *real* capabilities, with a `tracing::info!` naming the hallucinated id, and a second guard
  against re-requesting a capability already attempted this deliberation. Validation after parse, done right,
  in the same function whose parse defaults.

### Measured properties of the extractors (executed, not read)

Five extractors were transliterated from Rust to JS and validated by re-running **26 of the repo's own test
assertions** against the port — `safe_json`'s 14 behavioural lenient tests, `oneshot`'s 5 fence/span tests,
`athena_reaction`'s `match_braces_respects_strings` and two envelope tests, `deliberation`'s three
`parse_decision`/`parse_turn` tests, and `extract_balanced_object`'s documented string-awareness contract.
**26 passed, 0 failed.** Then they were fed 18 realistic malformed replies. `Ok`/`Some` means "yielded a
typed value":

| input | **E1** `extract_json_span` (6 callers) | **E2** `extract_json_envelope` (2 + 12 copies) | **E3** `parse_lenient_json` (2) | **E4** `lenient_from_str` (**0**) | **E7** `safeJsonParse` (frontend) |
|---|---|---|---|---|---|
| empty string | Err(missing object) | None | Err | Err | Err |
| a refusal, no JSON | Err(missing object) | None | Err | Err | Err |
| clean canonical envelope | **Ok** | **Some** | **Ok** | **Ok** | **Ok** |
| fenced + prose on both sides | **Ok** | **Some** | **Ok** | **Ok** | Err |
| truncated mid-string (max_tokens) | Err(missing `}`) | None | Err | Err | Err |
| truncated after a nested close | Err(serde) | None | Err | Err | Err |
| **parses, wrong shape** (`{"refusal":…}`) | **Ok** | **None** | **Ok** | **Ok** | **Ok** |
| right marker, inner is a string | **Ok** | **Some** | **Ok** | **Ok** | **Ok** |
| `}` inside a string value | **Ok** | **Some** | **Ok** | **Ok** | **Ok** |
| trailing comma | Err(serde) | None | Err | **Ok** | Err |
| single quotes | Err(serde) | None | Err | Err | Err |
| model restated it twice | Err(serde) | **Some** (2nd) | **Ok** (1st) | Err | Err |
| prose containing a `}` after the JSON | Err(serde) | **Some** | **Ok** | Err | Err |
| a `<thinking>` block holding a decoy | Err(serde) | **Some** (real one) | **Ok** (**decoy**) | Err | Err |
| NDJSON stream lines | Err(serde) | **Some** | **Ok** | Err | Err |
| bare array, wrapper dropped | **Ok** | None | **Ok** | **Ok** | **Ok** |
| fence with no closing fence | **Ok** | **Some** | **Ok** | **Ok** | Err |
| unicode prose before the object | **Ok** | **Some** | **Ok** | **Ok** | Err |

**The five extractors disagree on success/failure for 10 of 18 inputs.** Three results are load-bearing:

- **Only the marker-anchored extractor rejects a well-formed object of the wrong shape.** Every other
  extractor hands `{"refusal":"I cannot comply"}` to `from_str::<T>`, and if `T` has all-default fields it
  becomes a confident empty answer (P4). The marker *is* the required-key guard, accidentally.
- **On a `<thinking>` block containing a schema example, first-brace-wins returns the decoy and
  marker-anchored-last-wins returns the real answer.** Same reply, two different answers, in one repo.
- **`extract_json_span` silently reduces a single-element array to its element** (`[{"id":"a"}]` → `{"id":"a"}`,
  executed) and turns a two-element array into an `Err(serde)`. A model that wraps its answer in an array
  therefore yields a partial answer or a failure depending on how many items it found.

And the one broken copy, executed side by side:

```
input:  {"persona_wide":{"tone":"use } sparingly in prose","depth":3}}
fanout.rs:437  (no in_string state)   -> null
runner.rs:188  (string-aware)         -> the object
```

`build_session/fanout.rs:437-455` counts `{`/`}` without tracking string literals, so a `}` inside any
model-authored string value closes the object early, the slice fails to parse, and the function returns
`None` with no record. The payload there is `persona_wide` — a blob of model-authored prose. This copy is
counted by [`model-composed-ui.md`](./model-composed-ui.md)'s rule; the executed proof is here.

---

## 7. Deviations found

### 7.A The return type is the defect: 34 model-reply parsers cannot say why they failed

Three independent implementations (the census engine's whole-file regex; a line-oriented scanner; a
token-first scanner using string operations, no regex) partition the repo's model-reply parsers by return type:

| | matches | files |
|---|---:|---:|
| `fn parse_*/extract_*(<model text>: &str) -> Option<…>` **and deserializes JSON** | **34** | **22** |
| `… -> Result<…, E>` | **13** | **12** |

All 34 were read and all 34 parse a model reply — **100% precision after one documented exclude**
(`cli_capture.rs`, which reads a local CLI's own `~/.wrangler` config and matched only because a sibling
function eight lines later mentions `serde_json`). The 34:

`engine/src/design.rs` ×5 · `engine/src/credential_design.rs` ×2 · `engine/src/credential_negotiator.rs` ×2 ·
`engine/src/parser.rs` ×2 (`extract_execution_flows`, `parse_outcome_assessment`) ·
`engine/src/output_assertions.rs:244` · `src/engine/deliberation.rs` ×3 · `src/companion/athena_reaction.rs` ×3 ·
`src/commands/credentials/auto_cred_browser.rs` ×2 · `src/commands/recipes/{execution,generation,versioning}.rs` ×3 ·
`src/companion/proactive/{message,execution,backlog}_*.rs` ×3 · `src/commands/tools/automation_design.rs` ·
`src/commands/infrastructure/{context_generation,idea_scanner}.rs` ×2 ·
`src/commands/obsidian_brain/revitalize.rs` · `src/commands/design/n8n_transform/cli_runner.rs` ·
`src/engine/build_session/parser.rs:1213` · `src/engine/director.rs:462` · `src/engine/llm_topology.rs:155`.

Classifying what each caller does with the `None`, the distribution is the finding:

| failure semantics | count | exemplars |
|---|---:|---|
| **`default`** — a manufactured value indistinguishable from a real answer | **2 explicit + 11 structural** | `deliberation.rs:516`, `:1372`; all 11 `PROTOCOL_KEYS` parsers, which never return `None` |
| **`silent-drop`** — no log, no metric, no counter | **~24** | `design.rs` ×5, `credential_*` ×4, `recipes` ×3, `parse_athena_decision`, `parse_athena_batch`, `parse_proposal`, `parse_diffs`, `runner/mod.rs:2517`, `output_assertions.rs:244` |
| **`skip`** — dropped WITH a log or a `parse_failure` row | **6** | `parse_athena_review` (warn), `parse_exec_triage` (warn + `parse_failure`), `parse_message_triage`, `parse_backlog_triage` (+ user-facing error), `director::parse_score` (documented), `kpi_binding` |
| **`error`** — a reason reaches the caller | **13** | the whole `Result` partition |
| **`retry`** | **1** | `kpi_binding.rs:480` |
| **`repair`** | **0** | the repair pipeline exists and has no callers (§7.D) |

The `Result` column is not a coincidence of care. Every one of the 13 `Result` parsers propagates a bounded
preview of the offending text, because the type gave them somewhere to put it. Not one of the 34 `Option`
parsers does, because there was nowhere.

### 7.B `ModeratorDecision` is the unguarded refusal-envelope, and it governs 91% of headless spend

`deliberation.rs:96-112` — `#[derive(Debug, Clone, Deserialize, Default)]`, **every one of seven fields
`#[serde(default)]`**, doc comment: *"so a partial / sloppy LLM object still deserializes (the conservative
defaults — `Stalled`, `Discuss`, `Continue` — fail safe)."*

The defaults *are* conservative. The defect is that four different events collapse onto them:

1. the model genuinely judged the round stalled and named no speakers,
2. the model returned prose and `parse_decision` returned `None` → `unwrap_or_default()`,
3. the model returned `{"deliberation": {}}` → serde defaults every field,
4. the model returned `{"refusal": "…"}` — rejected here **only** because `ModeratorEnvelope.deliberation`
   is required, which is luck rather than design (executed: every non-marker-anchored extractor in §6 accepts
   that input).

Downstream, `plan_transition:229-233` increments `consecutive_stall_rounds`, `:288-295` yields
`Continue { speakers: [] }`, the tick at `:740-786` runs no persona turns, and the deliberation stays open to
be moderated again. `STALL_LIMIT = 3` then escalates with `reason: "stall_limit"`.

**Fix, one line, and it is `brainiac/extract.rs:410` generalised:** drop `#[serde(default)]` from
`round_outcome` (or add an explicit `Unreadable` variant to `RoundOutcome`) so a shapeless object fails to
deserialize, and replace `unwrap_or_default()` with a `Result` that the caller records via `update_outcome`.

The same shape, less consequentially, at `companion/brain/profile_synthesis.rs:310-334`: `parse_diffs` returns
`Vec<Value>`, and an empty vec means both "the model proposed no identity changes" and "nothing parsed".

### 7.C Tolerance is not accuracy — replayed over 2,058 real Claude replies

`persona_executions` holds **2,188** rows, **2,058** with stored `output_data` (mean 7,885 chars, max 57,097;
1,930 contain a `{`, 576 contain a fence). Every extractor was replayed over all 2,058:

| extractor | yields a parsed value | |
|---|---:|---|
| `parse_lenient_json` (= `extract_balanced_object`) | **1,652** | 80.3% |
| `lenient_from_str` (the dead recovery pipeline) | **26** | 1.3% |
| `extract_json_span` | **1** | 0.0% |
| `safeJsonParse` (frontend) | **0** | 0.0% |
| **any pair disagrees on the same input** | **1,658** | **80.6%** |

The 80.3% is not a success rate. **1,927 of 2,058 replies (93.6%) carry more than one distinct protocol
envelope key** — the corpus is prose reports that emit `execution_flow`, then `agent_memory`, then
`emit_event`, then `user_message`. "The first `{` that balances" therefore returns whichever envelope the
model happened to emit first: measured first-object distribution is `user_message` 1,078, `execution_flow` 411,
`emit_event` 137. **On 121 replies, first-brace-wins and marker-anchored-last-wins return different objects
for the same key.** A lenient extractor pointed at this corpus will confidently return an answer to a
different question, four times out of five, and nothing will notice.

`extract_json_span`'s 1/2,058 is the mirror image: `find('{')` .. `rfind('}')` spans every unrelated brace in
a 7.9 KB report. It is the right extractor for a "reply with ONLY JSON" lane (its six callers all are) and
catastrophically wrong one prompt-drift away — and its failure, at least, is loud.

**This is the one clause with no external warrant.** No sibling's model emits multiple structured blocks per
reply, so P5 is an invention with local measurement behind it, not doctrine.

### 7.D A five-stage recovery pipeline with 16 passing tests, zero callers, and 1.3% real-world yield

`safe_json.rs:175/191` — `lenient_from_str` / `lenient_from_str_as`: fence stripping, prefix/suffix chatter,
trailing-comma removal, truncated-keyword completion (`tru` → `true`). Sixteen dedicated tests, all passing.
`#[allow(dead_code)] // planned API — no Tauri command wires into lenient parsing yet`. Zero call sites
outside the file — first reported by [`model-composed-ui.md`](./model-composed-ui.md) §7 D7.

The new fact is that **adopting it would make things worse**. Its `extract_json_body` (`:249`) takes the first
`{`/`[` to the *last* `}`/`]`, the same span logic as `extract_json_span`, so on real prose it fails for the
same reason: **26 of 2,058 (1.3%)** vs `parse_lenient_json`'s 1,652. Its one unique win is trailing commas,
which no real reply in the corpus needed.

The tests are why nobody knew. Every fixture is a hand-written miniature — `{"a": 1, "b": 2,}` — and the
production input is a 7.9 KB report. **A green suite over unrepresentative fixtures is the exact hazard
recorded in `CLAUDE.md`'s model-effort section: a gate that asserts data is not a gate on behaviour.**

### 7.E Nothing checks whether the reply was cut off, and the column that promises to is measuring something else

Repo-wide over 963 Rust files: `finish_reason` — **0 occurrences**. `stop_reason` — 37, all of them the
unrelated `chain::stop_reason` module. `subtype` is read at 4 sites
(`fleet/classify.rs:215`, `fleet/headless.rs:318,351`, `design/analysis.rs:556`) and at none of them does it
gate a parse. **`CliUsage::from_result_event` (`turn_ledger.rs:84-96`) reads `is_error` and not `subtype`**,
so the CLI's own `error_max_turns` cap-out — which `build_session/parser.rs:523` explicitly says *"used to be
indistinguishable from a silent turn"* — never reaches the ledger.

Two truncations happen in the extraction path and neither is recorded:

- `runner/mod.rs:2154` — stdout past `MAX_OUTPUT_BYTES = 10 MB` is dropped with a `logger.log("[RUNNER] stdout
  truncated …")` line into a log file, no column, no counter.
- `runner/mod.rs:2506` — `assistant_text` silently stops accumulating at the same cap, **with no marker at
  all**, and `:2723` then scans that capped buffer for the post-run protocol envelopes. A reply's final
  `user_message` past 10 MB is not dropped by an extractor; it is never presented to one.

And `persona_executions.log_truncated` — the one column whose name promises this fact — is assigned
`logger.had_write_errors()` (`runner/mod.rs:2759`). It records log-file **write errors**. It is `0` on all
**2,188** rows.

A brace-balance proxy over the real corpus: **24 of the 1,930 brace-containing replies never balance** — the
only truncation evidence the system retains, and nothing reads it.

Convergence: **0 of 53 external extraction sites check a truncation signal either.** This is not a local
oversight; it is a hole five teams share (see the head).

### 7.F The runner requires an envelope to be alone on its line, and 10 real user reports were never delivered

`runner/mod.rs:2515-2518` needs `trimmed.starts_with('{')` **and** `serde_json::from_str::<Value>(trimmed)` on
the **whole line**. There is no `else`.

Replaying the real corpus against both the line-anchored rule and a marker-anchored brace scan:

| | marker-anchored finds it | line-anchored finds it | invisible to the runner |
|---|---:|---:|---:|
| any protocol envelope | 1,927 | 1,924 | **3** |
| `user_message` specifically | 1,805 | 1,795 | **10** |
| `agent_memory` | 1,922 | 1,918 | 4 |
| `emit_event` | 1,906 | 1,903 | 3 |

**The line-anchored rule is 99.8% correct, which refutes the obvious prediction** — the model reliably puts
each envelope on its own line, and this document declines to report the anchoring as a general defect. But
the 10 `user_message` misses were hand-diagnosed and split into two real classes: **7** where a second
envelope shares the line (so the whole-line parse fails on trailing content the brace matcher handles), and
**3** where the model wrapped the envelope in a backtick — `` `{"user_message": {"title": "UX Review — …` ``.
In all 10 the user's final report exists, is well-formed, and was never delivered. 0.55%, silent, and no row
records it.

Fix: brace-match from the first `{` on the line rather than parsing the whole line, and strip a leading
backtick. Both are two-line changes in the same expression.

### 7.G Eleven protocol parsers that cannot fail

`engine/src/parser.rs:506-618` — `PROTOCOL_KEYS` maps 11 envelope names to parsers, and **all 11 return
`Some(...)` unconditionally**. `parse_user_message` (`:520`) is
`str_field(msg,"title")` + `str_field_or(msg,"content","")`; `parse_emit_event` (`:537`) is
`str_field_or(msg,"type","")`. A `{"user_message": {}}` is a delivered report with no title and no body;
a `{"emit_event": {}}` is a dispatched event with an empty type.

**This is latent, not live**, and the document says so: the live database holds **0** empty-body persona
channel posts, **0** empty `event_type` rows in 4,972 `persona_events`, and **0** empty-content rows in 6,535
`persona_memories`. The model has never emitted a bare envelope. The deviation is that nothing would notice
if it did — and this is the highest-volume extraction site in the app.

The honest exception in the same file is `parse_outcome_assessment` (`:683`), which **requires**
`accomplished` (`msg.get("accomplished")?.as_bool()?`) and filters `business_outcome` to a closed four-value
set. One of twelve parsers in that file gets P4 right.

### 7.H The paid-loss is not priced anywhere

The single recorded parse failure — `turn_4275aa92a0c2`, `exec_triage`, `claude-sonnet-4-6` — cost
**$0.177867** for **2,409 output tokens** over **47.8 seconds**, and carries `is_error = 0`. It is a normal,
successful, billed row. Nothing in the schema multiplies "turns" by "parse_failure" to produce a dollar
figure, and nothing in the UI surfaces one; the `parse_failures` KPI at `observability.rs:247` counts events,
not money.

Extrapolating the one lane that measures (1 of 36 = 2.8%) onto the 1,442 unmeasured deliberation turns would
suggest ~40 silent failures and roughly $1.20 — **this document does not claim that number**, because a
sample of 36 from one lane is not a rate for another. The claim it does make is that the app cannot compute
the figure at all, and that the cheapest way to learn it is seven `update_outcome` calls.

### 7.I What this path CLEARED

Four things the brief or the obvious reading predicts, which measurement refutes:

- **"There is no parse-failure telemetry."** False. There is a column, a writer, a KPI and a rollup. The
  defect is coverage (3 of 47), which is a much cheaper problem than the one predicted.
- **"The line-anchored protocol scan misses envelopes embedded in prose."** Measured 1,924 of 1,927 — 99.8%.
  The real miss (10 of 1,805 `user_message`) has two specific, different causes (§7.F), and the effort spent
  disproving the general claim is what found them.
- **"A confident-empty default is reaching production data."** Not in this database: 0 empty events, 0 empty
  memories, 0 empty channel posts. §7.G is latent and is reported as latent.
- **"`log_truncated` records truncation."** It records log-file write errors, and is 0 on 2,188 rows. The
  column name is the entire misdirection.

---

## 8. Gaps

1. **The CLI's stop reason cannot reach an extractor, so P7 is not fixable at any call site.**
   `CliUsage` (`turn_ledger.rs:60-75`) carries cost, tokens, duration, turns and `is_error` — no `subtype`.
   `brainiac` has the identical structural gap (`ChatResponse` has no stop-reason field, `gateway/src/lib.rs:56-62`),
   which is why 0 of its 7 sites check either. The fix is one field on the boundary type plus one line in
   `from_result_event`, and until it lands, "was this cut off" is unanswerable by construction, not by
   omission. **Genuinely unbuilt.**
2. **No shared "record that this paid call yielded nothing" helper.** `update_outcome(pool, turn_id, json)`
   takes a raw JSON string, so the three users each write the literal `r#"{"parse_failure":true}"#`, and a
   fourth would have to know the exact spelling that `observability.rs:247` greps for. A
   `turn_ledger::record_parse_failure(pool, turn_id, reason: &str)` would make the fact typed, spellable and
   greppable — and would give the reason somewhere to live.
3. **No type distinguishes model-authored text from repo-authored text.** Everything is `String`, which is
   why the census signal in §9 has to guess from parameter *names* (`blob`, `text`, `raw`, …) and why its
   recall is bounded by that word list. Independently identified by
   [`model-composed-ui.md`](./model-composed-ui.md) §8 gap 3 — two paths reaching the same missing newtype
   from opposite ends is evidence it is real.
4. **The census cannot assert the interesting half.** It can count `Option`-returning parsers. It cannot
   assert *"every model-reply parse failure reaches a recorder"*, because that is an absence
   (`assertRule` treats a zero-match rule as a structural failure, correctly). §9 signal 2 specifies the
   different instrument that condition needs.
5. **The Claude CLI offers no schema-constrained decoding.** `ascent` gets its 11/11 validation rate partly
   from provider structured-output APIs (Gemini `responseJsonSchema`, Bedrock tool `inputSchema`). Driving a
   CLI, this repo has only prompt text and post-hoc validation. That is a real ceiling on how good extraction
   here can get, and it is why §2 leans on required fields and closed sets instead.
6. **No fixture in the repo tests an extractor against a real stored reply.** All 16 `safe_json` tests, all
   5 `oneshot` tests and all 3 `deliberation` parse tests use hand-written miniatures; §7.D is what that
   costs. A single test that replays a checked-in 8 KB real reply through each extractor would have caught
   the 1.3% and the 0.0%.

---

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Yes, decisively, and the type is `Result` in place of `Option`.** This is the cleanest instance of the
principle in the corpus so far, because the repo ran the experiment on itself: 34 parsers chose one type and
13 chose the other, in the same tree, for the same job.

Hold it against the doctrine's seven qualifications:

- **Q1 (a type carries only what it encodes).** `Result<T, AppError>` encodes exactly "failed, and here is
  why" — the one fact every downstream behaviour needs and `Option` destroys. It claims nothing more; it does
  not make the caller record, and §7.A shows six callers that log without one. But **all 13 `Result` parsers
  propagate a bounded head of the offending text and 0 of 34 `Option` parsers do**, which is the correlation
  the type produces.
- **Q2 (requiredness ≠ closedness).** This is neither; it is *informativeness*. Making the `Option` required
  changes nothing — it already is.
- **Q3 (a type nobody constructs constrains nothing).** 34 construction sites, all enumerated in §7.A. Not a
  hypothetical.
- **Q4 (a type anyone can construct authenticates nothing).** `AppError::Internal(format!(…))` is trivially
  constructible — but the *hole* is what matters, and `Result`'s hole demands a value where `Option`'s
  demands nothing. The ergonomic path (`?`) propagates it for free.
- **Q5 (withholding beats requiring).** This is the qualification that fits. The current design *requires*
  every caller to remember to log, and 24 of them do not. `Result` **withholds the ability not to know**: you
  cannot get `T` out without handling an `E` that is holding the reason.
- **Q6 (withhold the dangerous freedom, not the answer).** The freedom withheld is "discard the diagnosis",
  not "handle absence" — a parser with a legitimate empty case can still return `Result<Option<T>, E>`, which
  is the shape `parse_outcome_assessment` should have.
- **Q7 (relaxing a requirement is inert when the caller supplies the bad value voluntarily).** Does not apply:
  no caller here is *supplying* anything; they are being *denied* something.

**Where the type does not reach**, and this is a finding rather than a failure:

- **Inside serde.** `ModeratorDecision`'s all-default fields turn a shapeless object into `Ok`, so no return
  type helps. That needs a *different* type edit — one non-defaulted field, `brainiac/extract.rs:410`'s move
  (§7.B). Both edits are needed; neither substitutes for the other.
- **In the truncation signal**, which never enters a Rust type at all (§8 gap 1). No parameter-level
  discipline reaches a value that never crosses a parameter.

So the gate below is the **ratchet that holds the line while the 34 conversions land**, and it should reach
13-and-falling, not zero — some of the 34 have a legitimate absent case and become `Result<Option<T>, E>`,
which the signal correctly stops matching.

### Signal 1 — census rule `model-reply-parser-without-a-reason` (ships below)

**Condition it is a proxy for:** *the step that turns a paid model reply into a typed value discards the
reason it failed, leaving every downstream layer — log, metric, retry, user message — with nothing to say.*

**An adopting repo must re-derive its own proxy and must NOT port this pattern.** The precondition here is
specific and measured: this repo writes model-reply parsers as free functions with a `&str` first parameter
named from a small vocabulary, and encodes "no answer" as `Option`. In TypeScript the same condition wears
completely different clothes — `catch { return null }` (`vibeman/parse-response.ts:31`), `?? []`, a zod
`.default()` on a model field, `catch { return { score: 0 } }` — and this pattern scores **zero** on every one
of them. That is the `tables.md` / `form-field-and-validation.md` portability failure, avoided by naming it.

**Not already gated.** All **98** rules in `scripts/census/rules.json` were read.
`handrolled-llm-envelope-scan` (model-composed-ui) is the nearest neighbour and keys on
`blob[..pos].rfind('{')` — the *locating* step, inside a parser body; this rule keys on the parser's
*signature*. Zero pattern overlap; file overlap is 6 of 22 and those files carry both defects independently.
`empty-sample-as-confident-zero` (metric-definition, 16/34) and `unknown-money-as-zero` (llm-spend-accounting,
21/25) both gate a confident zero, but over *metric samples* and *cost fields* — neither can see a parser
signature. `bindingless-catch-on-io` (swallowed-error-telemetry, 84/122) is TypeScript-only and keys on
`catch {}`. `silent-row-skip` (row-to-struct-mapping, 64/148) is the closest in spirit and covers **database
rows**, which is the discriminator drawn in §1.

**Precision: 34/34, hand-verified**, after one documented exclude. **Recall: 34 of 35 known sites.** The
`[\s\S]{0,700}?serde_json` body window misses `athena_reaction.rs:650 parse_athena_decision`, whose first
`serde_json` is just past the window — found by the rule's own canary, and reported rather than papered over
by widening the window (which costs precision on unrelated neighbours).

**Two implementations agreed on the headline and disagreed on the membership — a false agreement, caught.**
The first regex (consuming form, `…-> Option<[\s\S]{0,700}?serde_json`) and the line scanner both reported
**34**, and were both wrong: the consuming tail *swallows the next function's signature*, so two adjacent
parsers merge into one match. Rewriting the body requirement as a **lookahead**
(`-> Option\s*<(?=[\s\S]{0,700}?serde_json)`) made the census engine and the independent token-first scanner
agree at **34 matches / 22 files** with an identical per-file distribution. The doctrine's warning was exactly
right: agreement is not soundness, and the composition is what has to match.

```json
{"rules":[{"id":"model-reply-parser-without-a-reason","goldenPath":"docs/concepts/golden-paths/structured-output-extraction.md","title":"A model reply is turned into a typed value by a parser whose failure carries no reason","roots":["src-tauri"],"extensions":[".rs"],"signal":{"pattern":"\\bfn\\s+(?:parse|extract)_[a-z0-9_]*\\s*(?:<[^>]{0,60}>)?\\s*\\(\\s*(?:&\\s*(?:'[a-z]+\\s+)?)?(?:blob|text|raw|reply|answer|output|out|assistant_text|full_output|completion)\\s*:\\s*&\\s*(?:'[a-z]+\\s+)?str\\b[^)]{0,160}\\)\\s*->\\s*Option\\s*<(?=[\\s\\S]{0,700}?serde_json)","flags":"g","ignoreCommentLines":true,"description":"A free function named parse_*/extract_* whose first parameter is model-reply text (&str) and which deserializes JSON, returning Option<T> instead of Result<T, E>. PROXY FOR the stack-free condition: the step that turns a PAID model reply into a typed value discards the reason it failed, so no downstream layer can log, count, retry or report it. Measured 2026-08-16 at bbb1a8864: 34 matches / 22 files against 13 matches / 12 files for the Result-returning form of the same shape; all 13 Result parsers propagate a bounded head of the offending text and 0 of the 34 Option parsers do. Live consequence: the five deliberation lanes (1,488 of 1,636 headless companion_turn rows, $44.94) carry ZERO outcome_json, while the one lane whose parser feeds turn_ledger::update_outcome has recorded one {\"parse_failure\":true} row — a $0.177867 / 2,409-output-token call flagged is_error=0. PRECISION 34/34 hand-read; RECALL 34/35 (the 700-char body window misses athena_reaction.rs:650 parse_athena_decision, found by this rule's own canary). CORRECT END STATE is ~13 and falling, NOT zero: a parser with a legitimate absent case becomes Result<Option<T>, E>, which this pattern stops matching. PRECONDITION (must be re-derived per repo, do NOT port): this repo spells the defect as a Rust return type on a free function with a &str first parameter named from a small vocabulary. The same condition in TypeScript siblings wears `catch { return null }` (vibeman/parse-response.ts:31), `?? []`, `catch { return {score: 0} }` and zod `.default()` on a model field — this pattern scores ZERO on all of them. The BODY REQUIREMENT MUST BE A LOOKAHEAD: the consuming form swallows the next function's signature and silently merges two matches into one."},"exclude":[{"path":"src-tauri/src/commands/credentials/cli_capture.rs","reason":"parse_wrangler_oauth_token reads a local CLI's own ~/.wrangler TOML config, not a paid model reply; it matches only because a sibling fn eight lines later mentions serde_json"}],"baseline":{"files":22,"matches":34},"floor":900}]}
```

**Positive control** — the same anchors pointed at a tree containing *only* the compliant form. Ships with a
`-positive-control` id and **no `baseline`**, per the runner's contract. The fixture is four files: a
`Result`-returning parser of the same shape, a module whose **doc comments quote the forbidden signature
verbatim** (twice), an out-of-scope `Option` parser over an already-parsed `&serde_json::Value`, and an
out-of-scope `Option` parser over CLI text that never touches JSON.

```json
{"rules":[{"id":"model-reply-parser-without-a-reason-positive-control","goldenPath":"docs/concepts/golden-paths/structured-output-extraction.md","title":"POSITIVE CONTROL — the Result-returning form of the same parser must NOT match","roots":["soe-fixture/compliant"],"extensions":[".rs"],"signal":{"pattern":"\\bfn\\s+(?:parse|extract)_[a-z0-9_]*\\s*(?:<[^>]{0,60}>)?\\s*\\(\\s*(?:&\\s*(?:'[a-z]+\\s+)?)?(?:blob|text|raw|reply|answer|output|out|assistant_text|full_output|completion)\\s*:\\s*&\\s*(?:'[a-z]+\\s+)?str\\b[^)]{0,160}\\)\\s*->\\s*Option\\s*<(?=[\\s\\S]{0,700}?serde_json)","flags":"g","ignoreCommentLines":true,"description":"The same anchors as model-reply-parser-without-a-reason, pointed at a tree that contains ONLY the compliant Result-returning form, plus (a) the forbidden signature written verbatim in two doc comments and (b) two out-of-scope Option parsers — one over an already-parsed &serde_json::Value, one over CLI text with no JSON. Any match here means the matcher keys on a token (the word Option, the word parse_) rather than on the shape."},"floor":1}]}
```

**Validation — run 2026-08-16 via `node scripts/census/run-census.mjs --rules <file> [--root <fixture>]`:**

| # | Scenario | Expected | Observed | Exit |
| --- | --- | --- | --- | --- |
| 1 | Rule as shipped, `--check` | baseline holds | `OK 22/22 files, 34/34 matches, 963 walked, floor 900` | **0** |
| 2 | **Positive control** — compliant-only tree, forbidden signature present verbatim in doc comments | must **fail**: a matcher that fires here keys on a token | `structural: matched zero files anywhere`; log also reports `2 match(es) ignored on comment-only lines` | **1** |
| 3 | **Negative control** — one genuine `Option` parser added to that same tree | must fire | `OK 1 file, 1 match, 4 walked` (run flips FAIL → OK) | **0** |
| 4 | Fault: new violation — a canary `.rs` added to real `src-tauri/src/` | must fail | `files rose 22 -> 23 (+1)` · `matches rose 34 -> 35 (+1)` | **1** |
| 5 | Fault: silent drop — baseline claims 23/35 | must fail | `files dropped 23 -> 22 … a silent drop is a broken matcher more often than fixed code` | **1** |
| 6 | Fault: broken matcher — `roots` narrowed to one directory | must fail | `walked 11 files but floor is 900. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| 7 | Re-run, unchanged | baseline reproduces | identical to #1 | **0** |

Scenario 2 is the one that matters: the compliant fixture **quotes the exact forbidden signature twice in
prose and still does not match**, so `ignoreCommentLines` is load-bearing rather than decorative — and the two
out-of-scope `Option` parsers in the same tree stayed silent, proving the rule discriminates between "returns
Option" and "turns a model reply into a typed value and returns Option."

**Where it executes.** `npm run census:check`, which is wired into `npm run check` and the pre-push hook —
**not** `ci.yml`, which has **0 successful runs in 260 all-time attempts** and would therefore enforce
nothing. The census runner's own fail-loud contract (floor, zero-match, stale-exclude, silent-drop) is what
makes this a gate rather than a report; scenarios 4–6 above are that contract exercised.

### Signal 2 — a paid-loss ledger assertion (not expressible as a census rule)

The condition §0 is actually about — *every model-reply parse failure reaches the ledger* — is an **absence**,
and the census structurally cannot assert one (§8 gap 4). It needs a different instrument, and the right host
is a test beside `scripts/census/self-test.mjs` or a Rust integration test, run by `npm run check`. It should:

1. Enumerate the callers of the four text-returning wrappers (`call_claude_text`, `cli_text_tracked`,
   `cli_text_with_usage`, `cli_decision_with_model`) that receive a `turn_id`.
2. For each, assert that every path from the parse to a `return`/`?` passes through
   `turn_ledger::update_outcome` or `record_failed_leg`.
3. Print the covered/total counts on success — today that is **3 / 34**.

**How it fails loudly if its own precondition is absent** — the requirement `ci.yml` keeps violating. It must
**fail, not skip**, when: the wrapper list yields zero callers (the wrappers were renamed and the enumerator
silently matched nothing); the `parse_failure` string literal is no longer found in
`observability.rs`'s reader (the KPI was renamed and the writers now write into a void); or the covered count
is not printed. A coverage assertion that greens out because a grep stopped matching is precisely the §0
failure, committed by the gate written to catch it.

**Allowlist:** parsers whose absent case is genuinely free — a probe, a capability check, anything that did
not spend. Name them; there should be very few, and each should say what it did not pay for.

**Once the 34 conversions land, this signal replaces signal 1**, because a `Result` that must be handled is a
much better place to assert recording than a count of signatures. Signal 1 is the ratchet; signal 2 is the
destination.

---

## 12. Corrections to the brief

The brief's hypotheses, tested:

1. **"Is there a shared helper, or N hand-rolled `JSON.parse` / `serde_json::from_str` calls behind a regex
   that finds the first `{`?"** — **Neither, and the framing is the correction.** There are **five distinct
   shared helpers** (`extract_json_span`, `extract_json_envelope`, `extract_balanced_object` /
   `parse_lenient_json`, `lenient_from_str`, and the frontend `safeJsonParse`), all real, all tested, all
   with different tolerance. Executed against 18 malformed inputs they **disagree on 10**; replayed over
   2,058 real replies they disagree on **80.6%**. The problem is not the absence of a helper. It is five
   helpers and no doctrine about which.
2. **"A prior path found a 'confident zero' pattern where an empty sample rendered as a real value" — hunt
   that shape.** Found, and it is worse than a zero: `parse_decision(&blob).unwrap_or_default()` produces a
   *confident stall*, which is not merely a wrong number but a **misattributed narrative** the user is shown
   as "the team stalled". It governs 91% of headless model spend.
3. **"Truncation: a prior path measured that nobody in any of five repos records prompt truncation."** —
   **Confirmed and extended: nobody records OUTPUT truncation either.** 0 of 963 Rust files read a
   truncation signal; 0 of 53 sites across the five siblings do. The extension is the sharper finding:
   `vibeman` captures `stop_reason` at three providers and reads it at zero, and this repo has a column named
   `log_truncated` that means log-file write errors and is `0` on all 2,188 rows.
4. **"Does any extraction feed something irreversible without a validation step between?"** — **In this repo,
   no, and the negative is worth stating.** Every path checked has a validator between parse and effect
   (`resolve_capability`, `sanitize_briefing_spec`, the candidate `HashSet` filter, the dispatcher's
   `ALLOWED_ACTIONS`), and the live data shows 0 empty events in 4,972 and 0 empty memories in 6,535. **The
   siblings are where this bites:** `vibeman/fileScannerService.ts:510` writes model text to a user's source
   file on a truthiness check, `personas-cloud/dispatcher.ts:1067` produces an unvalidated model payload onto
   a Kafka topic, and `brainiac/divergence.rs:267` runs a `DELETE` whose scope is decided by a silent parse
   drop. Reported in the head, not as a local deviation.
5. **"Cost: an extraction that fails after the model call has already been paid for."** — Confirmed with a
   price: **$0.177867**, 2,409 output tokens, 47.8 s, `is_error = 0` — the one such row the app has ever
   recorded. The correction is that the app *cannot* price the class, because 44 of 47 parsers do not write
   the row (§7.H), and this document declines to extrapolate the 2.8% rate from one lane onto another.
6. **"Enumerate the extraction sites and classify how each one parses."** — Done, and the classification that
   mattered turned out not to be *how it parses* but **what type it returns**. Every downstream behaviour —
   log, metric, retry, user message — correlates with `Result` vs `Option` and with nothing else. That
   reframing is this document's main claim and it was not in the brief.
7. **A prediction of my own, disproved and recorded as such.** I expected the runner's line-anchored protocol
   scan (`starts_with("{\"user_message\":")`) to miss envelopes embedded in prose at scale, since 93.6% of
   real replies carry multiple envelopes. Measured: **1,924 of 1,927 — 99.8% recall.** The prediction was
   wrong, and the effort spent disproving it is what surfaced the 10 real misses and their two specific
   causes (§7.F), which a coarser look would have reported as one vague problem.
8. **A claim retracted before it reached this document.** An early read of the replay suggested
   `extract_balanced_object` returns "a random code fragment" from prose reports. Sampling twelve of the
   1,652 showed the opposite: it returns a genuine protocol envelope every time — just, on 121 of them, the
   *wrong* one. The corrected claim (P5, §7.C) is narrower and stronger than the one I nearly published.

**Scratch artifacts.** All measurement scripts, the two scratch rule registries and the fixture tree live in
the session scratchpad and were not written into the repo; the only file this composition adds to the working
tree is this document. `scripts/census/rules.json` was **not** edited — the rule ships as the fenced JSON
above, per the contract's concurrent-composer rule.
