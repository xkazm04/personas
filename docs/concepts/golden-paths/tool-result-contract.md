# Tool result contract

> Situation node: `ai-and-agents/prompt-and-output/tool-result-contract` ·
> [situation spine](../situation-spine.json) · `sides: "server"` (**contradicted —
> see §12.1**) · `twoSided: true` · `fusedAcrossSides: false` ·
> recurrence 4 · risk medium · `convergence: "converged"` (**contradicted — see
> §12.2**) · dimensions: function · ui · code-quality · resilience.
> Spine `why`: *"One outcome shape for callers, the audit log and the incidents
> inbox."*
>
> **Short form** (Mode 2 batched tail): spine header, §0 headline, §2 the one
> way, §7 deviations, §9 the gate, §12 corrections. Every count carries two
> independent implementations and a hand-verified precision.
>
> Composed 2026-08-17 against `master @ 2a874e692`. Sweep: all 963 `.rs` files
> under `src-tauri/` ([`shared-facts.json#rust.files`](../shared-facts.json)),
> the four `tool_audit_log::insert` call sites, the 33-handler MCP server, and
> a read-only copy of the **2026-08-17 purge backup**
> (`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`).
> Row counts below are historical as of 2026-08-17 and unreproducible from the
> live database — the operator's purge deleted 20,342 rows across 25 tables that
> morning. Where a claim is still reproducible live, it says so.

---

## 0. Headline

**This repo built the tool-result contract the spine asks for. It has nine typed
failure categories, a 256 KiB cap, a `truncated` flag, and a doc comment naming
the incidents inbox as its consumer. Its audit table has held zero rows since it
was created on 2026-03-12 — measured in the pre-purge backup, not the emptied
live file.**

**The surface that actually ran recorded 33,484 tool results across 1,921
executions. Each one stores exactly seven fields — `step_index`, `tool_name`,
`input_preview`, `output_preview`, `started_at_ms`, `ended_at_ms`,
`duration_ms` — and not one of them says whether the tool succeeded.** The
parser that produces them reads the `tool_result` block's `content` and never
looks at its `is_error` sibling (`engine/src/parser.rs:318-333`), and the trace
span for every tool call is closed with `end_span_ok` unconditionally
(`src/engine/runner/mod.rs:2491`). A tool that failed and a tool that succeeded
are the same row.

Three numbers make the shape of the miss precise:

| surface | contract | rows recorded |
|---|---|---:|
| Tool Runner / automation / MCP playground (`tool_runner`, `automation_runner`, `mcp_tools`) | **full** — `ToolErrorKind`, `http_status`, `retryable`, `output_truncated` | `tool_execution_audit_log` = **0** |
| Persona LLM runs (the Claude CLI's own tools) | **none** — 7 fields, no outcome | `persona_tool_usage` = **5,720** rows / **37,921** invocations; `tool_steps` = **33,484** steps |
| Lab arena / eval tool calls | **none** — name + sequence only | `lab_tool_calls` = **259** |

`tool_outcome.rs`'s own module docstring says it plainly, and is the most honest
line in the file: *"Persona LLM tool calls do NOT flow through here."* The
contract is installed on the roads nobody drives.

And a fourth number, which is the one that would show up in an incident: the
promoter at `db/src/audit_incidents_promoter.rs:99-125` has a dedicated arm for
`tool_execution_audit_log`. **164 incidents exist across six source tables and
none of them came from that arm** — because the arm's source table has never
held a row.

### The truncation is the leak

`runner/mod.rs:2473-2477` cuts `output_preview` at 500 characters and records
the cut by splicing `"..."` into the value. `redact_execution_fields`
(`db/src/repos/execution/executions.rs:804`) then redacts what survives. **That
order is backwards, and the backup proves it.** Replaying `redact.rs`'s own
eight patterns against the 31,047 stored previews:

- **8 occurrences the patterns would mask** — 1 GitHub PAT, 7 Google API keys.
- **3 occurrences a reader recognises as a secret and the redactor cannot see** —
  1 `-----BEGIN … PRIVATE KEY-----` header with **no matching `END`** (the PEM
  rule is `(?s)-----BEGIN … .*?-----END …`, so it matches **0 of 1**), and 2
  GitHub-token prefixes shorter than the pattern's `{20,}`, **one of which sits
  exactly at the 500-character cut**.

A PEM private key is longer than 500 characters. **The PEM rule can therefore
never fire on a `tool_steps` preview, by construction** — not "usually misses",
cannot fire. `brainiac` wrote the fix down as a comment, independently, at
`crates/brainiac-server/src/mcp.rs:2386-2390`: *"Redact before truncating so a
secret straddling the cut is still masked."*

### The marker lies 23 times

`content_preview.len() > 500` compares **bytes**; `chars().take(500)` takes
**characters**. A 480-character, 502-byte value therefore gets `"..."` appended
while nothing was removed. Measured over the 16,309 marked previews:
**16,286 were genuinely cut at 500 chars; 23 were not** — 480/502, 494/502,
498/502, 456/505, 495/519 chars/bytes. The repo has a test asserting exactly
this invariant **in a neighbouring module** —
`engine/src/prompt/mod.rs:2197` `untruncated_variable_gets_no_marker`, whose
assertion message is *"must not claim a cut that never happened"*. Same repo,
same author, same week; one site used `chars().count()` and one used `len()`.

---

## 2. The one way

**A tool result is a value with four parts — an outcome, a payload, a
truncation fact, and a failure category — and it is redacted at the boundary it
crosses, before it is cut.** Concretely, in this order, because each step is
worthless without the one before it:

**(a) Type the outcome, never stringify it.** The result of an invoked tool is
`Result<ToolRunResult, _>` where the error arm carries a **closed enum**
(`personas_engine::tool_outcome::ToolErrorKind` — nine variants:
`Auth`, `Timeout`, `Http`, `Transport`, `ToolError`, `RateLimited`,
`Misconfigured`, `Unsupported`, `Unknown`), plus `http_status: Option<u16>` and
`retryable: bool`. A handler that returns `Result<String, String>` cannot
produce a category, so no downstream consumer can ever get one — the audit
column, the incidents inbox and the retry policy all degrade to prose at once.
Map into the enum through the single door `classify_app_error`
(`engine/src/tool_outcome.rs:106`) so the three surfaces cannot disagree about
what a 401 means.

**(b) Redact before you truncate, at the boundary the value crosses.** A secret
that straddles a cut is unmatched by every pattern that has a minimum length,
and a PEM block longer than the cap loses the `END` marker its rule requires.
Order is not a nicety here; it decides whether the redactor runs at all.

**(c) Carry the truncation fact beside the value, never inside it.** Return
`(String, bool)` — `cap_output` (`tool_outcome.rs:87`) is the shape — or a
struct field (`output_truncated: bool`, `tool_runner.rs:39`). A `"..."` spliced
into the payload is not a signal: nothing downstream can distinguish it from a
tool that genuinely printed an ellipsis, a `len()`-vs-`chars()` bug will
manufacture it, and a caller who needs to know whether the value is whole has to
parse English out of the data.

**(d) Give a parse failure, an oversize result and an error result three
different answers.** They are three conditions and the common implementation
gives them one code path. An oversize result is a **refusal**, not a silent cut
(`brainiac`'s `within_cap`, `mcp.rs:157`: *"Oversized input is a clear tool
error (rejected), never silent truncation"*). A parse failure is a typed reason,
not an empty value — this is the same rule
[`structured-output-extraction`](./structured-output-extraction.md) publishes
for model replies, and it applies verbatim to tool replies. An error result is a
`ToolErrorKind`, and it must survive into the row.

**(e) Enumerate the destinations before you install the redactor.** A tool
result reaches three places with three obligations: a **prompt** (an external
model reads it), a **UI surface** (the operator reads it, and may legitimately
need to see their own secret), and a **stored transcript** (it outlives both).
Write the list down and check each one. *A module that never called a redactor
never appeared in any search for redactors* — the 3,243-line `mcp_server/` has
0 redactor calls and was invisible to every prior audit of this repo's redaction
for exactly that reason.

**Reach for:** `personas_engine::tool_outcome::{ToolErrorKind, classify_app_error,
classify_http_status, cap_output}` and the `ToolRunResult` shape at
`src/engine/tool_runner.rs:29-57`. **The single site to copy is
`src/engine/tool_runner.rs:319-330`** — it caps through `cap_output`, binds
`output_truncated` from the returned flag, classifies the error, and writes the
audit row in the same function.

---

## 7. Deviations

Counts are two-implementation and hand-verified where stated.

**D1 — `mcp_server/` has no contract at all: 33 handlers, `Result<String, String>`,
no cap, no redactor.** `src/mcp_server/tools.rs:1133-1182`. `call_tool` maps
`Ok(s)` → `{"content":[{"type":"text","text":s}],"isError":false}` and
`Err(s)` → the same with `isError:true`. Because the error arm is a `String`,
`ToolErrorKind` is unreachable from this surface **by type**. There is no size
cap on the way out (the client-side path has one — `mcp_tools::MAX_MCP_PAYLOAD_BYTES`,
10 MiB — the server-side path has none), and searching the module for a
redactor returns **0 hits across 3,243 lines and 149 `row.get` calls**.

**D2 — `personas_result` hands a model the raw `tool_steps` blob.**
`tools.rs:1803-1834` selects `output_data` **and `tool_steps`** and returns them
`to_string_pretty`. Registered as deferred fix **#34**; re-verified here against
the backup: `tool_steps` is **1,921 rows / 26,551,258 bytes**, byte-identical to
#34's figure. **The door is unlocked and currently unopened** — no `mcp.json`
exists on this machine, so nothing is connected. `brainiac` redacts at exactly
this door.

**D3 — `handle_knowledge_search` is `SELECT * FROM execution_knowledge`.**
`tools.rs:1842-1876`. A `SELECT *` into a model-facing tool result means every
column added to that table in future is published to a foreign model with no
edit to this file. The other three `personas_*` read handlers name their
columns; this one does not.

**D4 — 33,484 recorded tool results carry no outcome field.** Measured two ways
(JSON parse; raw-text key scan) — identical: 1,921 rows, 33,484 steps, exactly
7 distinct keys, **0 outcome-shaped keys** (`error|status|success|ok|fail|exit|result`).
`ToolCallStep` (`core/src/types.rs`) has no place to put one, so the omission
starts in the type. **2,437 of the 33,484 steps (7.3%) have an empty
`output_preview`** — a tool call whose result never arrived, indistinguishable
in the row from a tool that returned nothing.

**D5 — the parser drops `is_error`.** `engine/src/parser.rs:318-333` matches
`block_type == "tool_result"`, extracts `content`, and returns
`StreamLineType::ToolResult { content_preview }`. The wire block's `is_error`
field is read nowhere in 963 `.rs` files for a *tool result* (every `is_error`
hit in the tree is the CLI's terminal `result` envelope or the MCP client's
`McpToolResult`). Downstream, `runner/mod.rs:2491` closes the span with
`end_span_ok` on every tool result.

**D6 — truncate-then-redact.** `runner/mod.rs:2473` cuts;
`executions.rs:804` redacts the survivor. Proven above: PEM 0/1, GitHub 1/3.
**The 500-char preview is also strictly smaller than the redactor's own
worst-case pattern**, so no ordering fix at the redactor helps — the cut has to
move.

**D7 — 43 truncations in 37 files record the cut inside the payload.**
Hand-verified **43/43**. Two of them are the shared helpers everyone else
inherits: `engine/src/str_utils.rs:5` (`truncate_owned`) and
`engine/src/parser.rs:9` (`truncate_field`), both `fn(&str, usize) -> String`.
The repo owns the correct signature — `cap_output(String) -> (String, bool)` —
and calls it **once** (`tool_runner.rs:323`).

**D8 — a tool result crosses back into a prompt, unredacted, and nobody has
looked at that sink.** `build_session/tool_tests.rs` runs real credentialed
`curl` calls; `api_outcome_from_http` (`tool_runner.rs:700`) puts the **response
body**, truncated to 500 chars, into the error message; `oneshot.rs:658-701`
`build_failure_summary` copies that error (400 chars) into the fix-pass prompt;
`fix_pass.rs:144-155` sends it to Anthropic. There is no redactor anywhere on
that path. `secret-and-pii-redaction.md` measured the disk sink and the read
command; `live-log-stream-view.md` measured the stream. **This is the fourth
sink: a tool result re-entering a prompt.** It is unmeasurable on this install
(11 of 78 personas ever held a `last_test_report`, and the personas are gone),
so it is stated as a reachable path, not as an observed leak.

**D9 — the incidents arm is real and starved.** `audit_incidents_promoter.rs:99`
promotes `result_status = 'error'` rows into the inbox, *and* is additionally
gated on `PERSONAS_INCIDENTS_PROMOTION=1`. Two gates in series over a table with
zero rows. 164 incidents exist, from `persona_blocker` (68), `execution_error`
(63), `team_assignments` (20), `circuit_breaker` (11), `fleet` (1),
`review_dispatch` (1).

**D10 — `lab_tool_calls` is a fourth recorder with no outcome column.** 259 rows,
columns `id, result_kind, result_id, sequence, tool_name, variant, created_at`.
It records that a tool was *named*, in an expected-vs-actual comparison, and
nothing about what it returned.

**D11 — the truncation marker lies 23 times.** `runner/mod.rs:2473`, bytes vs
chars. See §0.

---

## 9. The gate

### Published: `unflagged-string-truncation`

**The condition it is a proxy for:** *a value was shortened and the fact was
recorded inside the value instead of beside it.* The proxy is the Rust idiom
this repo happens to wear — `format!("{…}...", <cut>)`. **An adopting repo must
re-derive its own proxy**; in TypeScript the same condition wears
`s.slice(0, n) + '…'`, which this pattern would not see.

Two independent implementations agree exactly: a bespoke walk over
`src-tauri/**/*.rs` using `scripts/census/lib/instruments/stripCfgTest.mjs`, and
the census engine with `ignoreCommentLines`. Both: **37 files / 43 matches.**

**Hand-verified precision: 43/43.** All 43 sites were opened. Every one is a
string truncation whose only record of the cut is a marker in the payload
(`str_utils.rs:5`, `parser.rs:11`, `runner/mod.rs:2474`, `tool_runner.rs:1111`,
`smart_search.rs:217`, `observability.rs:227`, `llm_topology.rs:56,75`,
`assignments.rs:463`, `workflow_compiler.rs:377,378`, `pocket.rs:416,483`,
`debug_log.rs:367`, `persona_change_log.rs:46`, `ambient_context.rs:1021,1101`,
`transcript.rs:164`, `skills_sidecar/mod.rs:285`, `approval_exec_dev.rs:791`,
`data_portability.rs:8106`, `credential_design.rs:68`,
`team_synthesis.rs:157,242`, `incident_diagnosis.rs:129`, `static_scan.rs:198`,
`twin.rs:779,2342`, `recipe_derivation.rs:94`, `oneshot.rs:354`,
`sleep_cycle.rs:2106`, `connector_use.rs:192`, `knowledge_ops.rs:632`,
`planner.rs:112`, `backlog_triage.rs:113`, `message_triage.rs:138`,
`prompt.rs:1412`, `session.rs:2530`, `whisper.rs:190`, `kokoro.rs:271`,
`director.rs:660`, `goal_advance.rs:268`, `pipeline_executor.rs:275`). Zero
false positives; the marker in every case is a truncation ellipsis, never
prose.

**Positive control: 19 files / 55 matches**, hand-verified **10/10** — every
opened site is a boolean carrying the fact beside the value
(`core/src/types.rs:335` `pub log_truncated: bool`; `tool_runner.rs:39`
`pub output_truncated: bool`; `connector_explorer/mod.rs:123`
`let truncated = bytes.len() > opts.max_body_bytes`;
`prompt/runtime_safety.rs:100` `truncated_from = (…).then(…)`;
`db_query.rs:916` `truncated: false`; `api_proxy.rs:628`;
`schema_vocabulary.rs:74`; `sleep_cycle.rs:583`; `ollama.rs:386`;
`runner/globals.rs:72`). **It does not partition** — a file can hold both forms,
and `ambient_context.rs` does (`:1020` compliant, `:1021` violating). It
discriminates: 43 violating against 55 compliant, on disjoint syntax.

**Site-level overlap against the FINAL pattern: zero.** All 43 `file:line` sites
were intersected against every `.rs`-scoped rule in `scripts/census/rules.json`
(191 rules). No shared site with any of them, including the nearest neighbours
`magic-collection-ceiling` (which anchors on `.iter()/.values()/.drain()` before
`.take(` — `chars` is not in its adaptor list), `unqueryable-log-record`, and
`anonymous-deadline`.

**Prefer the type over this gate, and say so out loud.** The 43 sites are
downstream of two helper signatures — `truncate_owned(&str, usize) -> String`
and `truncate_field(&str, usize) -> String`. Changing those to
`-> (String, bool)`, as `cap_output` already is, makes the omission unspellable
at every call site at once, and the census becomes the ratchet that holds the
line until that lands. This is the contract's fifth failure mode read forwards:
**a gate on reaching a destination is only as good as the destination's
defaults**, and here the destination itself is the defect.

```json
{
  "id": "unflagged-string-truncation",
  "goldenPath": "docs/concepts/golden-paths/tool-result-contract.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "format!\\s*\\(\\s*\"\\{[^\"}]{0,40}\\}(?:\\.\\.\\.|\\u2026|\\[truncated[^\"]{0,60})\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A string truncation whose ONLY record of the cut is an ellipsis spliced into the payload. The caller gets a String and cannot ask whether anything was removed, so a downstream redactor, parser or size check sees a value that looks whole. Prefer (String, bool) — personas_engine::tool_outcome::cap_output is the shape."
  },
  "baseline": { "files": 37, "matches": 43 },
  "floor": 900
}
```

```json
{
  "id": "unflagged-string-truncation-positive-control",
  "goldenPath": "docs/concepts/golden-paths/tool-result-contract.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:was_truncated|is_truncated|log_truncated|output_truncated|body_truncated|truncated_from|truncated)\\s*(?::\\s*bool\\b|:\\s*(?:true|false)\\b|=\\s*(?:[A-Za-z_][\\w.]*\\s*(?:\\.\\s*len\\s*\\(\\s*\\)\\s*)?[<>]|\\(|matches!|.*\\.then\\())|\"truncated\"\\s*:",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL. The compliant form of the same cut: the truncation fact is carried BESIDE the value as a boolean/Option/field the caller can read, not spliced into the string. 19 files / 55 matches at composition; hand-verified 10/10."
  },
  "floor": 900
}
```

### Declined, with the reason: a gate on the MCP server's missing redactor

The obvious second gate is *"an egress handler with no redactor call"*. It
cannot be written as a census rule and the reason is structural: **the census
ratchets a count of something present; it cannot assert an absence.** The
condition here is "3,243 lines contain zero calls to `redact_string`", which is
a rule matching zero files — and a rule that matches zero files fails the runner
structurally, by design. The instrument this needs is an **inventory of egress
channels** compared against the redactor call graph, in the shape of
`scripts/check-csp-hosts.mjs`, not a ratchet. That is specified here and not
built, because building it is a fix and this campaign does not apply fixes to
security controls whose current setting may be deliberate.

### Deferred fixes registered

None new. **#34 is re-verified, not superseded** — its `tool_steps` byte count
reproduces exactly (26,551,258 B / 1,921 rows) and its structural lesson (*"a
module that never called a redactor never appeared in any search for
redactors"*) is the reason D8 was found. The truncate-before-redact ordering
(D6), the byte/char marker (D11) and the missing `is_error` (D5) are recorded
here rather than in the register because none of them can be applied without
changing what a live surface stores.

---

## 12. Corrections

**12.1 — `sides: "server"` is INCOMPLETE, not inverted.** The spine also carries
`twoSided: true` in the same object, and the two fields disagree. The headline
defect, the exemplar, the census rule, its control and its floor are all
server-side Rust — so a server-scoped brief would have found the important half.
But the leaf has a real client half that a server-only brief would have missed
entirely: `src/features/vault/shared/playground/tabs/McpToolResultDisplay.tsx`
is the one surface that renders a tool result to a human, and the operator
*legitimately* needs to see their own secret there — which is precisely why
redaction belongs at the boundary the value crosses and not at the place it is
displayed, the clause `secret-and-pii-redaction.md` §2 already publishes. The
ledger entry: `sides: "server"` — **upheld for where the answer lives,
contradicted for completeness**, mechanism named.

**12.2 — `convergence: "converged"` FAILS, in a mode the ledger already
records: the fleet split, and the best answer is not ours.** Cohort measured
per-leaf at composition time, not assumed: `personas-cloud` is a **port** (its
`BLOCKED_ENV_PREFIXES` set and RCE rationale comment are textually identical to
`src-tauri/src/engine/runner/env.rs`) and has no tool-result type at all —
`tool_result` appears only as a stream-stage label. `personas-web` has no LLM
dependency in `package.json`; its only `isError` is a toast prop. **Effective
independent cohort: 3** (`brainiac`, `ascent`, `vibeman`), not 5.

Of those three: **`brainiac` is ahead of Personas on this leaf and it is worth
saying so.** Its `enum ToolError` (`mcp.rs:85`) has three arms to our nine, but
it (a) redacts at the MCP door **before** truncating (`mcp.rs:2393`), (b) treats
oversize as a *rejection* rather than a cut (`mcp.rs:157`), and (c) makes a
parse failure a typed reason that cannot masquerade as a clean empty result
(`extract.rs:399-441` refuses a payload whose `memories` key is absent, so *"a
refusal wrapper would otherwise deserialize to an empty vec and masquerade as a
clean 0-extraction"*). Personas has the richer enum and the worse plumbing.
`vibeman` truncates tool results to 200 chars **silently** with no marker and no
flag (`protocol.ts:186-189`) and has no redaction anywhere — and per
`shared-facts.json#lineage.siblings.vibeman` it is this repo's *ancestor*, so
that gap is vibeman's own, not something we exported. `ascent` redacts only into
its stored eval log (`eval-log.ts:61-62`) — never to the model or the UI — which
is the same one-of-three-sinks failure this leaf is about, reached independently.

So the fleet did **not** converge on an answer; three repos wrote three
different partial answers, and the union of them is §2. **Ledger: 14 tested, 14
failed.**

**12.3 — the brief's framing "what is a tool result allowed to contain" was the
wrong first question.** The measured answer is that in the surface that actually
runs, a tool result is not *allowed* anything — it has no outcome field to
contain one. The containment question is downstream of a shape question, and
asking it first sends you looking for a redactor in a struct that has nowhere to
put a verdict either.

**12.4 — my own first pass measured the wrong redaction thresholds and would
have published a 12× overcount.** Scanning for credential *prefixes* returned
92 "invisible to the redactor" occurrences. Hand-verification collapsed it to
**3**: all **80** `sk-` hits are word-internal (`ask-`, `task-`, `desk-`,
`risk-` — the four-character predecessors are `n("a`, `: "a`, `d (a`, `r-de`),
and the 9 bare `eyJ` hits are base64-encoded `{"`, which is not evidence of a
JWT. This is the doctrine's *"a vocabulary-based signal's precision is bounded
by its author's word list"* landing from the precision end, and the only thing
that caught it was opening the matches.

**12.5 — my two implementations disagreed on one number and both were right.**
SQLite `SUM(LENGTH(tool_steps))` = 26,551,258; JavaScript `.length` summed =
26,551,823. The 565-unit gap is astral-plane characters counted as two UTF-16
code units by JS and one character by SQLite. Recorded because a byte/char
confusion is also the cause of D11, twelve lines away in the same subject — the
same ambiguity produced an honest measurement disagreement and a live bug in the
same afternoon.

**12.6 — a claim I could not make.** The brief asked whether truncation without
a marker is "the classic". In this tree it is not: of the 43 sites, **43 append
a marker**. The defect here is subtler and worse — the marker is present, is not
derived from whether a cut occurred, and is not readable by anything except a
human. A gate looking for *unmarked* truncation would have returned zero and
reported the tree clean.
