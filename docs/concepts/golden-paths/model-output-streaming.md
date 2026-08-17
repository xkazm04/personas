# Model output streaming

> Situation node: `ai-agents/model-invocation/model-output-streaming` · situation spine
> `sides: server` · `twoSided: true` · recurrence 6 · risk **medium** · spine label
> `convergence: converged`. Dimensions: function · performance · ui · resilience.
> Spine's own framing: *"Turning an NDJSON stream into typed events line by line."*
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. **Short form** (spine header, §0, §2,
> §7, §9, §12) per the batched-tail runbook; the quality core is unchanged.
>
> **Sweep.** Both stream parsers read in full — `src-tauri/engine/src/parser.rs` (1,577
> lines, the execution stream) and `src-tauri/src/engine/build_session/parser.rs` (1,233
> lines, the build stream) — plus `engine/src/cli_process.rs`'s line reader, the runner's
> `StreamOutput` phase (`src/engine/runner/mod.rs:2100-2600`), `build_session/{runner,fanout}.rs`,
> and the frontend sink `src/lib/execution/executionSink.ts`.
>
> **The measurement corpus is 2,998 execution logs, 431,288,167 bytes, at
> `%APPDATA%\com.personas.desktop\logs\*.log`.** The runner writes every stdout line it
> received verbatim as `[STDOUT] <line>` (`runner/mod.rs:2172`) *before* parsing it, so
> these files are the exact bytes `parse_stream_line` was handed. **268,482 `[STDOUT]`
> lines were parsed out and classified by two independent implementations.** Row counts
> from `persona_executions` are **historical as of the 2026-08-17 purge** and were taken
> from the backup at
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, never the live
> file. The log files were **not** purged — they are files, not rows — so the stream-shape
> measurements below are reproducible today.
>
> `cargo` was unavailable in this session. Nothing here was compiled.

---

## §0 — The headline

**The Claude CLI stream carries five envelope types and ten `system` subtypes. This
app's parser has arms for four envelope types and three subtypes. What it drops is
where the numbers are: 32.6 million tokens, 3,483 live quota reports, 1,274 of them
warnings or rejections, and 107,501 reasoning-token counts — 40% of the entire stream
by line volume.**

Measured over 268,482 `[STDOUT]` lines in 2,998 execution logs, by two independent
implementations that agreed exactly on four of five totals (the fifth disagreement is
§0.4 and it is a finding):

| envelope `type` | lines | parser arm | outcome |
|---|---:|---|---|
| `system` | 130,273 | 3 of 10 subtypes | 111,096 lines → `Unknown`, no display |
| `assistant` | 88,363 | yes | handled |
| `user` | 43,483 | yes | handled |
| `rate_limit_event` | **3,483** | **none** | falls to `_ =>`, returns `Unknown` |
| `result` | 2,811 | yes | handled — with two fields read from a level that does not exist |
| `stream_event` | **0** | — | the app never passes `--include-partial-messages`, so there is no token-level streaming at all |

`system` subtypes, and which the parser names (`parser.rs:100-197`):

| subtype | lines | arm |
|---|---:|:--:|
| `thinking_tokens` | **107,501** | — |
| `task_started` | 9,123 | ✓ |
| `task_notification` | 9,064 | ✓ |
| `init` | 2,972 | ✓ |
| `task_progress` | 1,380 | — |
| `api_retry` | 106 | — |
| `task_updated` | 95 | — |
| `hook_started` / `hook_response` | 14 / 14 | — |
| `model_refusal_fallback` | **4** | — |

### §0.1 — The token half of deferred fix #24, verified and enlarged

Deferred fix **#24** was retitled today after its money half was refuted. The token half
is the subject of this leaf and it holds, at a larger scale than the entry claimed.

`parser.rs:340-341` reads the token counts off the **top level** of the `result` envelope:

```rust
let total_input_tokens  = value.get("total_input_tokens").and_then(|t| t.as_u64());
let total_output_tokens = value.get("total_output_tokens").and_then(|t| t.as_u64());
```

Six lines below, the two cache fields consult `usage` **first** and fall back to the top
level (`:347-349`, `:351-353`). Measured against the 2,811 `result` lines this app
actually received:

| field | present at top level | present under `usage` |
|---|---:|---:|
| `total_input_tokens` | **0 / 2,811** | — |
| `total_output_tokens` | **0 / 2,811** | — |
| `input_tokens` | 0 / 2,811 | **2,811 / 2,811** |
| `output_tokens` | 0 / 2,811 | **2,811 / 2,811** |
| `cache_read_input_tokens` | **0 / 2,811** | 2,811 / 2,811 |
| `cache_creation_input_tokens` | **0 / 2,811** | 2,811 / 2,811 |
| `total_cost_usd` | **2,811 / 2,811** | — |
| `model` | **0 / 2,811** | — (`modelUsage` is present 2,811/2,811) |

So the two cache fields work *only* because of the `usage`-first branch (`cache_read_tokens`
is non-zero on 585 of 2,188 execution rows, `sum = 648,406,049`), the two token fields are
zero on **2,188 of 2,188** rows, and cost works because `total_cost_usd` genuinely is a
top-level field. **The correct accessor and the incorrect one are eight lines apart in the
same function.**

The volume discarded, summed off the stream itself rather than off the column that failed
to record it (doctrine §2: *a number you cite as the size of a gap must come from outside
the gap*):

- `usage.input_tokens` summed over 2,811 result lines: **3,559,492**
- `usage.output_tokens`: **29,677,263**
- total: **33,236,755 tokens**, against `sum(input_tokens) + sum(output_tokens) = 0`.

### §0.2 — The correct reader already exists in this repo, one directory away

`src/engine/build_session/parser.rs:141-168`, `extract_result_usage`, reads the same
envelope and gets it right:

```rust
let cost_usd = obj.get("total_cost_usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
let usage = obj.get("usage");
let input_tokens  = usage.and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
let output_tokens = usage.and_then(|u| u.get("output_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
```

Its docstring even names the failure it was written to fix: *"The parser normally discards
these sibling fields (it only unwraps `result` text); this reads them so the runner can
sum build cost across turns."* It is called from four sites in `fanout.rs` and one in
`runner.rs:757`, accumulates into `SeedReport`-style totals, and persists via
`record_build_usage`. **This is not a missing capability. It is a capability that was
built for one of the two streams and never carried to the other** — the same
component-boundary shape the doctrine records for `entity-picker`.

### §0.3 — The fixture pinned the wrong shape, twice

`parser.rs:1105` asserts the defect:

```rust
let line = r#"{"type":"result","duration_ms":5200,"total_cost_usd":0.0123,
               "total_input_tokens":1500,"total_output_tokens":800,
               "usage":{"cache_read_input_tokens":1200,…}}"#;
…
assert_eq!(total_input_tokens, Some(1500));
```

The fixture puts the token fields at the top level *and* the cache fields under `usage` —
i.e. it encodes the parser's own assumption on both halves. It is green, it has been green
since it was written, and the CLI has never sent that shape. `engine/src/provider/claude.rs:402`
carries a **second, independently written copy of the same wrong fixture**.

This is the doctrine's *"a test that runs on one side of a boundary is a third copy, not
a check"* in its purest form: the fixture and the parser have one author, so the test can
only assert what the parser already believes. §9 is built on this.

### §0.4 — Where the two implementations disagreed, and what it found

Impl A parsed each `[STDOUT]` payload with `JSON.parse`; impl B matched the log's own
line prefix and read the `type` with a regex, never parsing. They disagreed by **68**:

| type | impl A (JSON.parse) | impl B (regex) | Δ |
|---|---:|---:|---:|
| `user` | 43,483 | 43,550 | 67 |
| `assistant` | 88,363 | 88,364 | 1 |
| all others | identical | identical | 0 |

The first hypothesis — a second `[STDOUT]` marker embedded inside a payload — was tested
and returned **0**. The real cause is a defect: **68 envelope-shaped lines do not parse as
JSON**, because `cli_process::read_line_within` truncates at `MAX_LINE_BYTES` and appends
`...[truncated]`, producing invalid JSON. Payload lengths of the 68: min 60,463, median
65,097, max 65,550; **38 sit inside `[65000, 65600]`**, i.e. hard against the 64 KiB cap.
67 are `user` (tool_result) envelopes and 1 is `assistant`.

`parse_stream_line`'s non-JSON arm (`parser.rs:88-96`) then discards them silently, and its
comment says why it exists: *"Non-JSON line -- suppress display. With --verbose +
stream-json, Claude CLI emits both JSON events and plain-text duplicates."* That arm was
written for duplicates. It is also, unremarked, the arm that eats every truncated
tool_result. Hand-verified: 4 of the 68 opened, all four end in the runner's own
`...[truncated]` marker mid-string.

### §0.5 — What else the discarded lines were carrying

`rate_limit_event` (3,483 lines in 2,941 of 2,998 logs) carries the account's live quota
state, already parsed:

```text
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning",
 "resetsAt":1780005600,"rateLimitType":"five_hour","overageStatus":"rejected", …}}
```

| `status` | lines |
|---|---:|
| `allowed` | 2,209 |
| **`allowed_warning`** | **1,166** |
| **`rejected`** | **108** |

`rateLimitType`: `five_hour` 2,548, `seven_day` 924. **3,472 of 3,483 carry `resetsAt`** —
an exact unix reset timestamp. The app was told 1,274 times that it was at or over a
quota edge, with the reset instant attached, and dropped every one.

And on the `result` line the parser does handle:

- **`is_error: true` on 82 of 2,811**, all with `stop_reason: "stop_sequence"`. The
  parser never reads `is_error`; its display string for all 2,811 is `"Completed in Ns"`.
- **`api_error_status: "429"` on 69**, `"400"` on 6. Never read.
- `modelUsage` names **9 distinct models**, and **48 lines used more than one model in a
  single turn**. `value.get("model")` is absent 2,811/2,811, so `Result.model` is always
  `None`; `model_used` is written from `SystemInit` instead (`runner/mod.rs:2200-2210`),
  which is why it is non-null on only 1,004 of 2,188 rows.
- `subtype` is `"success"` 2,811/2,811 and `terminal_reason` is `"completed"` 2,811/2,811
  — so those two would be worthless discriminators, and `is_error` is the one that works.

---

## §2 — The one way

**Deserialize the envelope into a closed type whose shape is the wire's shape, put the
usage numbers where the wire puts them, give the unknown variant a name and a counter,
and build your fixtures out of bytes the process actually sent you.** Concretely, in
order:

1. **Declare the stream, do not walk it.** Replace `serde_json::Value` + `.get("type")`
   with a `#[derive(Deserialize)] #[serde(tag = "type", rename_all = "snake_case")]` enum
   over `System`, `Assistant`, `User`, `Result`, `RateLimitEvent`, plus
   `#[serde(other)] Unknown`. The `Result` variant declares `usage: Usage` as a **nested
   struct**, so `input_tokens` has exactly one spelling and reading it from the root is
   not expressible. This is the whole of §0.1 made unspellable, and the fleet already
   does it: `vibeman/src-tauri/src/process/stream.rs:8,24` is a `#[serde(tag = "type")]`
   enum with `#[serde(default, alias = "total_cost_usd")]` on the cost field.
2. **Count the unknown; never drop it.** `Unknown` is a variant, not a fallthrough — emit
   it on the raw channel and increment a per-type counter. A stream you do not model is
   still a stream you received: 111,096 `system` lines and 3,483 `rate_limit_event` lines
   are invisible here precisely because "unhandled" and "absent" are the same code path.
   `brainiac/crates/brainiac-gateway/src/providers/anthropic.rs:130-137` is the fleet's
   only site that treats *missing* terminal usage as an anomaly worth a `tracing::warn!`
   rather than a silent zero — copy that instinct.
3. **Buffer partial records across chunk boundaries, and never truncate a record you
   intend to parse.** Line-oriented reading is correct and this repo does it
   (`cli_process::read_line_within`). A size cap is also correct. What is not correct is a
   cap that *mutates the record* and hands the mutant to a parser: emit the oversized
   record whole on the raw channel and skip parsing it, the way
   `personas-cloud/packages/worker/src/parser.ts:481-487` does, rather than appending
   `...[truncated]` and letting `serde_json` reject it (§0.4).
4. **Read the terminal event once, into one accumulator, and write every field it
   carries.** Cost, both token counts, both cache counts, the model, the session id, the
   error flag, the retry status. `update_metrics_from_result` (`parser.rs:721-752`) is
   already the right single door; four of its eight fields are simply never fed.
5. **Build the parser's fixtures from captured bytes.** Commit a small corpus of real
   `result` / `system` / `rate_limit_event` lines and assert against those. An invented
   fixture can only encode the author's belief about the wire — which is the belief under
   test. `src-tauri/tests/render_plan_fixtures.rs` is the shape to copy: committed
   `inputs/` + `expected/` directories and an `UPDATE_RENDER_PLAN_FIXTURES=1` regeneration
   path.
6. **On the client half, keep what is already here.** `executionSink.ts` is a bounded ring
   buffer (10,000 lines), a 4 KiB per-line clamp, a 10 MB byte budget with a 200-line tail,
   and visibility-aware batched flushes at 100 ms / 500 ms. It is better than every sibling
   and it is not the problem. **The contract it is handed is the problem:** the runner
   emits `ExecutionOutputEvent { execution_id, line: String }` — a formatted display
   string — so nothing downstream can filter, count or re-render a stream event. Emit the
   typed variant (`StructuredExecutionEvent`, `runner/mod.rs:2248+`) as the primary
   channel and derive the display string in the view.

**Two-sided contract, stated once.** Server owns: envelope typing, unknown-variant
accounting, record framing and size policy, and the single write of terminal metrics.
Client owns: bounding what it retains, batching what it renders, and never treating the
display string as data. The boundary is the typed event, not the formatted line.

---

## §7 — Deviations

Every entry is a real site in this tree, with the measurement that establishes it.

**D1 — P0: both token counts are read from a level of the envelope the CLI has never
used.** `engine/src/parser.rs:340-341`. Present at top level **0 / 2,811**; present under
`usage` **2,811 / 2,811**. Consequence: `input_tokens` and `output_tokens` are 0 on
**2,188 of 2,188** `persona_executions` rows in the pre-purge backup, discarding
**33,236,755** tokens. The fix is four tokens of code and is already written at
`build_session/parser.rs:157-163`. *Deferred, not applied — it changes what a live
surface reports.* Register entry **#24** (retitled today; money half struck, this half
intact).

**D2 — P1: `Result.model` is always `None`.** `parser.rs:361-364` reads
`value.get("model")`; absent **2,811 / 2,811**. The actual model is in `modelUsage`, an
object keyed by model name, present 2,811/2,811 and naming **9 distinct models**, with
**48 turns using more than one**. `metrics.model_used` therefore only ever comes from
`SystemInit` (`runner/mod.rs:2200`), which is skipped when the model string is empty or
`"unknown"` — hence 1,004 non-null of 2,188. A multi-model turn cannot be represented at
all by a single `model_used` column.

**D3 — P1: `rate_limit_event` has no arm in the execution parser.** 3,483 lines in 2,941
of 2,998 logs fall through `parser.rs:405` (`_ =>`) to
`extract_protocol_message_from_value`, miss, and return `(Unknown, None)`. **1,166 are
`allowed_warning` and 108 are `rejected`**, and 3,472 carry `resetsAt`. This *extends*
[`rate-limiting`](./rate-limiting.md) §0.4 / §7.J, which found the same discard in the
**build-session** parser (2 fixtures, 1 arm) — the execution parser drops the same
envelope 3,483 times, and its envelope is richer than the one that path measured
(`rate_limit_info.status` / `.resetsAt` / `.rateLimitType`, not just `retry_after`).

**D4 — P1: seven of ten `system` subtypes are unhandled, and one of them is 40% of the
stream.** `thinking_tokens` 107,501, `task_progress` 1,380, `api_retry` 106,
`task_updated` 95, `hook_started`/`hook_response` 14+14, `model_refusal_fallback` 4. The
last is the sharpest per-line: the model refused and the CLI silently substituted a
fallback, four times, and the app has no record. `api_retry` × 106 is the CLI reporting
its own retries to an app whose [`retry-with-backoff`](./retry-with-backoff.md) headline is
that nothing in the tree reads a retry hint.

**D5 — P2: 68 stream lines are truncated into invalid JSON and silently discarded.**
`cli_process.rs:213-284` (`read_line_within`) + `parser.rs:88-96`. 67 `user`, 1
`assistant`; 38 of 68 at the 64 KiB cap. A truncated `tool_result` vanishes from the
transcript entirely — it does not appear as a partial, an error, or a placeholder.
Hand-verified 4 of 68.

**D6 — P2: `is_error` is never read, so 82 failed turns display as "Completed".**
`parser.rs:376-386` builds the display from `duration_ms` and `total_cost_usd` only.
82 of 2,811 result lines carry `is_error: true` (`stop_reason: "stop_sequence"`), and 69
carry `api_error_status: "429"`. `subtype` and `terminal_reason` are constant across all
2,811 and are therefore useless as discriminators — `is_error` is the field that
discriminates, and it is the one not read.

**D7 — P2: the frontend's primary channel is a formatted string.**
`ExecutionOutputEvent { execution_id, line: String }` (`eventRegistry.ts:744`) carries
`display`, produced by `format!` inside the parser. The typed
`StructuredExecutionEvent` exists beside it (`runner/mod.rs:2248+`) but only for a subset
of variants. Anything the parser did not choose to format is unreachable from the UI even
when the bytes arrived.

**D8 — P3: the app never requests partial messages.** `stream_event` occurs **0 times in
268,482 lines**, so "streaming" here means whole-message granularity: an assistant turn
appears when it is complete. That is a defensible product choice for a log pane and a
poor one for a chat bubble; it is recorded here because
`build_session/events.rs:488` contains a **test fixture for `{"type":"stream_event"…}`** —
the repo tests a line type it has never received while dropping three it receives 111,000
times.

**D9 — P3: `build_sessions` token columns are present, correctly written, and empty.**
`total_cost_usd`/`input_tokens`/`output_tokens`/`num_turns` exist on the table;
`record_build_usage` (`build_session/runner.rs:853-861`) writes them from the correct
accessor. All 12 rows in the backup are 0/NULL — the rows predate the telemetry. Not a
defect; recorded so a later reader does not mistake an empty column for a broken writer.

---

## §9 — The gate

### 9.1 — Prefer a type over a gate, and here a type genuinely reaches

Held against the seven qualifications:

- **Q1 (a required prop carries only what it encodes).** Passes. The thing to close is
  *where the number lives*, and a nested `usage: Usage` struct encodes exactly that.
- **Q2 (requiredness ≠ closedness).** The win is closedness. `#[serde(tag = "type")]` +
  `#[serde(other)] Unknown` makes the variant set closed **and** total.
- **Q3 (a type nobody constructs constrains nothing).** `parse_stream_line` has 12
  non-test call sites across 8 files; every stream in the app goes through it or its
  build-session twin.
- **Q4 (a type anyone can construct authenticates nothing).** Not applicable —
  construction is `serde`'s, not a caller's.
- **Q5 (withholding beats requiring).** This is the operative one. A root struct with no
  `total_input_tokens` field **withholds** the wrong spelling; you cannot read it, so you
  cannot read it from the wrong place.
- **Q6 (withhold the dangerous freedom, not the answer).** The freedom withheld is
  *addressing an arbitrary key on an untyped map*. The answer — the token count — is still
  handed over, at `result.usage.input_tokens`.
- **Q7 (relaxing a type is inert where the caller volunteers the bad value).** Not
  applicable; nothing volunteers here.

**Where types cannot reach** (doctrine §1, item 5): a serialization boundary. But this is
the boundary crossed in the *safe* direction — serde is the boundary, and the struct
**defines** it rather than sitting behind it. Contrast `selective-per-item-verdicts`,
where the values live inside a `TEXT` column no type can enter. This one is reachable, and
that is the whole argument for doing it.

**The type does not, however, catch the fixture problem** — a hand-written fixture will
compile against the new struct as happily as against `Value`, because the author writing
the fixture is the author who chose the struct. That is what the census rule is for.

### 9.2 — Published rule: `invented-stream-envelope-fixture`

**Condition it is a proxy for (stack-free):** *a parser for a third-party stream is
tested against inputs its own author invented, so the test asserts the author's belief
about the wire rather than the wire.* Any repo can re-derive a proxy; in **this** repo the
condition wears the markup of an inline Rust raw-string literal beginning `{"type":"`.

Validated standalone against a private registry
(`node scripts/census/run-census.mjs --rules <scratch>`, exit 0), then re-extracted from
this document and re-run — identical counts.

```json
{
  "id": "invented-stream-envelope-fixture",
  "goldenPath": "docs/concepts/golden-paths/model-output-streaming.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "r#*\"\\{\"type\":\"(?:result|assistant|user|system|rate_limit_event|stream_event)\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A Claude CLI stream-json envelope written as an inline Rust string literal. The fixture is invented by the same author as the parser, so it can only assert what the parser already assumes — and it did: parser.rs:1105 and provider/claude.rs:402 both pin `total_input_tokens` at the envelope's top level, a field the CLI has emitted 0 times in 2,811 observed result lines."
  },
  "baseline": { "files": 14, "matches": 67 },
  "floor": 900
}
```

```json
{
  "id": "invented-stream-envelope-fixture-positive-control",
  "goldenPath": "docs/concepts/golden-paths/model-output-streaming.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "include_str!\\s*\\(\\s*\"[^\"]*\\.json\"\\s*\\)|(?:fs::)?read_(?:dir|to_string)\\s*\\(\\s*[^;)]{0,160}?(?:fixture|inputs|expected|golden)",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "COMPLIANT form: the input is loaded from a committed artifact instead of invented inline — src-tauri/tests/render_plan_fixtures.rs (golden inputs/expected dirs with an UPDATE_RENDER_PLAN_FIXTURES=1 regen path) plus the production bundle loaders. Proves the repo knows this discipline; it just never applied it to the CLI stream."
  },
  "floor": 900
}
```

**Measured, 2026-08-17 at `29e28aa8f`:**

| | files | matches |
|---|---:|---:|
| violating (invented envelope literal) | **14** | **67** |
| compliant control (input read from a committed artifact) | **4** | **5** |
| files walked | 963 | — |

**Hand-verified precision: 12/12.** I opened `transcript_read.rs:674-677`,
`classify.rs:244,245,258,269`, `events.rs:486,487,488,532`, `provider/claude.rs:381,402`
and confirmed every one sits inside a `#[cfg(test)]` module (lines 663, 233, 454, 356
respectively) and is a hand-written envelope. `provider/claude.rs:402` is a second,
independent copy of `parser.rs:1105`'s wrong shape, which is the rule earning its place
inside the sample used to verify it.

**Site-level overlap against the FINAL patterns of existing rules: 0 of 67.** I ran the
ten existing `src-tauri`/`.rs` rules that could plausibly touch a JSON string literal —
`unbounded-foreign-decode`, `adhoc-statement-verb-vocabulary`, `unqueryable-log-record`,
`handrolled-llm-envelope-scan`, `model-reply-parser-without-a-reason`,
`unchecked-closed-set-default`, `hand-rolled-fixture-ddl`, `unflagged-string-truncation`,
`untyped-command-payload`, `unverifiable-conflict-clause` — and compared line numbers, not
filenames. Eight files are shared; **not one line is.** (e.g. `engine/src/parser.rs`:
`model-reply-parser-without-a-reason` matches `:660,683` and `unqueryable-log-record`
matches `:11`; this rule matches `:969…:1476`.) File-level overlap would have reported
57% and been wrong in the pessimistic direction — the mirror of the doctrine's warning
that file overlap *understates*.

**Correct end state is not zero, and the rule must not be driven there.** Inline literals
are the right tool for a *negative* case (`a_non_object_json_line_is_surfaced_rather_than_dropped`,
`build_session/parser.rs:533`, is correct as written). The end state is that the
**positive** assertions about field placement come from captured bytes; a plausible floor
is ~25. If it ever reaches 0, delete the rule rather than baselining it there.

**How it fails loudly if its own precondition is absent.** The census runner supplies
this: `floor: 900` fails the run if the `src-tauri` walk sees fewer than 900 `.rs` files
("the matcher is broken, not the codebase clean"), a zero-file match fails, a stale
`exclude` fails, and a **silent drop** fails as loudly as a rise.

**Precondition, to be re-derived per repo (do NOT port):** this proxy assumes the fixture
is a *string literal in the source of the language being tested*. The three sibling
stream parsers spell the same condition differently — `personas-cloud`'s fixtures are TS
template strings, `vibeman`'s Rust path deserializes into a `#[serde(tag)]` enum whose
tests construct the enum directly (no envelope text at all), and `ascent`'s SSE tests
build frames with `\n\n` joins. The pattern scores structurally near zero on all three.
Re-derive the proxy; keep the condition.

### 9.3 — A second instrument the census cannot host

The rule above catches *invented* fixtures. It cannot catch the larger condition in §0 —
**a line type the stream sends and the parser has no arm for** — because that is an
**absence**, and the census ratchets presences (doctrine §4). The instrument that finds it
is the one used to write this document, and it should be a checked-in script:

> Walk `%APPDATA%\com.personas.desktop\logs\*.log`, extract every `[STDOUT] {…}` payload,
> histogram `type` and `system.subtype`, and diff that set against the arms enumerated in
> `parse_stream_line`. **Exit 2 if the walk finds zero result lines** — the precondition
> guard, without which a version that measures nothing passes forever
> (`scripts/check-csp-hosts.mjs` reported zero twice for two unrelated reasons).

This is an *inventory of what should exist* compared against a registry, which is the only
instrument shape the doctrine records as finding this class — the same shape that found
the 29 orphan ts-rs bindings and the 314 unregistered triage queues.

---

## §12 — Corrections

**12.1 — To my brief: the Retry-After lead was attributed to the wrong path.** The brief
said *"`retry-with-backoff`'s §0 was extended today — the `Retry-After` arrives already
parsed … `parser.rs:86`, fixture at `:542`."* `retry-with-backoff.md` contains **zero**
occurrences of `parser.rs`. The extension lives in
[`rate-limiting.md`](./rate-limiting.md), at §0.4, §7.J and §12.5, and the file is
`src-tauri/src/engine/build_session/parser.rs` — the **build** parser, not the execution
parser I was pointed at. Following the citation as given lands on
`engine/src/parser.rs:86`, which is the opening line of `parse_stream_line`. Both parsers
turned out to matter, so the lead was productive; the attribution was wrong.

**12.2 — To my brief: the sample size was 314; it is 2,811.** The brief stated the top-level
token fields are *"present 0 of 314 times"* and `usage.input_tokens` *"present 314 of 314"*.
Measured over the full log corpus by two implementations: **2,811 `result` lines in 2,808
of 2,998 files**. The direction and the ratios are exactly as briefed (0/2,811 and
2,811/2,811); the population is **8.95×** larger. Naming the corpus matters more than the
multiplier: the number to cite is "2,811 result lines in
`%APPDATA%\com.personas.desktop\logs`", because that is the set an auditor can re-walk.

**12.3 — To my own first pass: the cost total, and a self-inflicted disagreement.** My two
implementations disagreed on `sum(cost_usd)`: SQLite's `sum()` gave **2,036.2570954** and
my Node pass gave **2,036.2573**. The disagreement was **mine** — I quantized each value to
microdollars before summing, and 8 decimal places are stored. Re-summed exactly as decimal
integers: **$2,036.25709540**, which reproduces SQLite to the digit. Deferred fix #24's
`$2,036.2571` is correct to 4 dp. Recorded because the doctrine's rule is that a
disagreement is a finding — and sometimes the finding is that your instrument lost
precision, not that the data is inconsistent.

**12.4 — To `rate-limiting.md` §0.4 / §7.J: confirmed, and the population is 1,600×
larger than the site it names.** That path measured the discard at
`build_session/parser.rs:86` with a fixture at `:542`, which is correct and is still
correct. What it could not see from the build-session side: the **execution** stream
carries `rate_limit_event` **3,483 times across 2,941 of 2,998 logs**, with a richer
envelope (`rate_limit_info.status` ∈ {allowed 2,209, allowed_warning 1,166, rejected 108},
`resetsAt` on 3,472, `rateLimitType` ∈ {five_hour 2,548, seven_day 924}) and **no arm at
all** — it does not even reach a `match` on the subtype, it falls off the end of the
envelope match. That path's §12.5 says the value *"arrives already parsed and is discarded
by a match arm."* In the execution parser it is discarded by the **absence** of a match
arm, which is worse: there is no line to point at.

**12.5 — To `retry-with-backoff.md` §0 / §7 D8: an unread retry signal, from a third
direction.** That path measured *zero* reads of `Retry-After` in 963 Rust + 4,423 TS files.
Independent confirmation from the stream side, and an addition it could not have seen:
the CLI reports **its own** retries as `{"type":"system","subtype":"api_retry"}` — **106
lines** — and 69 `result` lines carry `api_error_status: "429"`. Three separate channels
tell this app that a rate limit occurred, and it reads none of them.

**12.6 — The spine's `convergence: converged` label: the fourteenth failure, and a new
mode.** The label is wrong in a way none of the thirteen prior failures wore.

The effective cohort for this leaf is **3, not 5**: `personas-web` has no LLM call at all
(its SSE carries orchestrator events and delegates framing to the browser's `EventSource`);
`brainiac` has **zero** streaming consumption anywhere in `crates/` or `console/`.

Within those three, the label splits by clause, and the *directions differ*:

| clause | fleet | verdict |
|---|---|---|
| buffer partial records across chunk boundaries | 6 hand-rolled buffered sites (ascent 3, vibeman 2, personas-cloud 1); **1 naive** (`vibeman/…/executionManager.ts:295`) | **converged — genuinely physics.** Three independent implementations of the same `buffer += chunk; lines.pop()` shape |
| where usage lives on the terminal event | personas-cloud reads **no tokens at all**; vibeman's Rust reads nested `usage` while vibeman's **own TypeScript** reads `parsed.result?.usage`; ascent and brainiac read top-level `usage.*` | **diverged, and one repo disagrees with itself** |
| what to do with an unmodeled event | 2 explicit arms fleet-wide (`vibeman/useSSEStream.ts:92`, vibeman's Rust `{"raw": line}`); ascent's 4 consumers and personas-web have none | **converged on the disease** |
| per-record size cap | only `personas-cloud/parser.ts:460` caps a record — and **emits the oversized record whole** rather than truncating it | **silence, with one better answer** |

So: converged on one clause, self-contradictory on the second, converged on the *disease*
on the third, silent on the fourth. **A single enum field cannot carry a verdict that
splits four ways** — the same structural objection `cross-device-pairing` raised, now with
a fourth mode to add to the ledger: **a sibling that disagrees with itself across its own
two languages.** vibeman's Rust and TypeScript both read the same CLI's `result` envelope
and disagree about whether `usage` sits on the envelope or inside `result`. Only one can
be right, and no test on either side can tell — the doctrine's *"a test that runs on one
side of a boundary is a third copy"*, reproduced inside a single repository.

**12.7 — `sides: "server"` holds, and `twoSided: true` is the more accurate half.** The
headline defect, all nine deviations, the exemplar, the census rule and its control are
server-side Rust. But the client half is not empty and is not derivable from the server:
`executionSink.ts` is a genuinely good bounded-retention subsystem, and D7 — the
formatted-string contract — is a defect **of the boundary**, which neither side owns
alone. Report as: server-weighted, two-sided at the contract.

**12.8 — Personas is ahead of the fleet on retention, and behind its own ancestor on
typing.** Stated as self-comparison, per doctrine §5. Ahead: no sibling has anything like
`executionSink`'s ring buffer + byte budget + tail-preserving truncation notice +
visibility-aware flush; `personas-web` delegates entirely and `vibeman` keeps a
head-discarding tail cap with one log line. Behind: `vibeman/src-tauri/src/process/stream.rs`
— in the repo the corpus has twice dated as this one's **ancestor** — types the envelope as
a `#[serde(tag = "type")]` enum, which is precisely the fix §9.1 prescribes. Personas
walks an untagged `Value`. An ancestor's better choice that was not carried forward is not
a peer's independent agreement; it is a regression with a date on it.

**12.9 — Not a defect: `stream_event` is absent because the app does not ask for it.** I
nearly filed "the parser has no `stream_event` arm" as a deviation. It has none because
the CLI sends none — 0 of 268,482 lines — because nothing passes `--include-partial-messages`.
The real finding is inverted and is D8: the repo carries a **test fixture** for
`stream_event` (`build_session/events.rs:488`) while having no arm for the three types it
actually receives 111,000 times a corpus. Checked before publishing, per doctrine §2's
rule that a measurement agreeing with your thesis is the one to re-run.
