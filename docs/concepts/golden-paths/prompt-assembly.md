# Golden path — prompt assembly

> **Topic path:** `ai-agents` › `prompt-and-output` › `prompt-assembly`
> [situation spine](../situation-spine.md) · recurrence **17** · risk **medium** ·
> sides: **client** (contradicted by measurement — see [§12.1](#121--sides-client-is-wrong-again-and-this-is-the-seventh)) ·
> convergence: **mixed** (fails — see [§12.2](#122--convergence-mixed-fails-and-it-fails-in-the-rarest-way)) ·
> dimensions: **function · security · cost · code-quality**
> Composed 2026-08-17 against `master` @ `9fdede67c`.
>
> **Sweep size.** All **963** `.rs` under `src-tauri/`, walked three times — once by the
> census engine, once by an independent brace-matching `#[cfg(test)]` stripper, and once by
> the reconstruction harness. Read end to end: `engine/src/prompt/{mod,templates,capabilities,
> variables,runtime_safety,cli_args,resume_prompt,advisory}.rs` (4,863 lines),
> `engine/src/prepared_run_cache.rs`, `db/src/memory_recall.rs`,
> `db/src/repos/core/memories.rs`, `src/engine/runner/{mod,team_context}.rs`,
> `src/commands/execution/executions.rs`. All **79** committed census rules rooted at
> `src-tauri/*.rs` were re-run against this path's matched files for site-level overlap.
>
> **Measured by execution, not by reading.** `assemble_prompt_with_skills` was
> **transcribed into a JS harness** and replayed over a read-only **copy** of the operator's
> live `personas.db` (347 MB, 244 tables), taken 2026-08-17 10:55 UTC with the app running;
> the live file was never opened for write and **the copy was deleted at the end of
> composition**. The harness reconstructed **1,433 real production prompts** and was
> calibrated against the byte count the runner itself wrote into **2,982 execution logs**
> (`Prompt length: N characters`, `runner/mod.rs:1113`). It reproduces two append-free
> production prompts **exactly, to the byte**, and **overshoots zero of 1,433**. `cargo` was
> not run; no execution was started in the live app.

---

## 0. The headline

**A persona is 17% of its own prompt. 34% is text compiled into the binary, and 45% is
appended by the runner after `assemble_prompt` has returned — below the security canary,
below `## EXECUTE NOW`, and outside the reach of the fence, which is `pub(super)`.**

Composition of **1,433 reconstructed production prompts** (107,020,554 bytes of system
prompt actually sent to Claude):

| source | bytes | share |
|---|---:|---:|
| **appended by the runner after assembly** (memory · prior reviews · team ledger · team alignment) | 47,670,467 | **44.54%** |
| **static text compiled into the binary** | 36,776,668 | **34.36%** |
| **persona-authored text** (`personas` table) | 11,507,856 | **10.75%** |
| input data (untrusted, fenced) | 6,588,178 | 6.16% |
| workspace shared instructions | 1,231,080 | 1.15% |
| connector usage reference | 961,124 | 0.90% |
| fence tags (nonce boundary markup) | 847,060 | 0.79% |
| tool documentation | 527,239 | 0.49% |
| credential hints | 501,714 | 0.47% |

Ten more numbers, each measured:

| | |
|---|---:|
| Median real prompt (2,982 logged executions) | **68,462 bytes** (≈17k tokens) |
| Identical, compiled-in bytes shipped on **every** execution | **26,722** |
| Persona-memory candidates the current budget **drops**, live corpus | **3,767 of 4,052 — 93.0%** |
| Candidate memory **bytes** that survive the 6,000-char budget | **1.5%** |
| Memories that individually exceed the entire active-memory budget | **2,456 of 6,535 — 37.6%** |
| `core`-tier memories — the tier always injected — in 6,535 rows | **0** |
| Logged executions that injected a core memory | **0 of 2,729** |
| Production sites that fence untrusted content | **18** |
| Production sites that append to the prompt where the fence cannot be called | **8** |
| Rows anywhere recording the prompt that was sent, its hash, or its length | **0** |

And the one that reframes the rest: **`persona_executions.input_tokens` is `0` on all 2,188
rows.** The column exists, the schema reserves it, and nothing has ever written it. The
prompt is the largest, most expensive, most behaviour-determining artifact this application
produces, and the only durable trace of any given one is a byte count in a `.log` file under
`AppData`.

### How much of a real prompt could be accounted for

**55.46% by exact transcription.** The harness reproduces `assemble_prompt_with_skills`
byte-for-byte: of 1,433 reconstructions, **zero overshoot**, and the **two** executions that
took no runner append at all reconstruct with a **delta of exactly 0** — different personas,
different sizes, same result.

The remaining **44.54%** is the runner's five post-assembly appends. They are not in
`assemble_prompt`, they are not fenced, and none of them is individually recorded — so they
had to be recovered by differencing the reconstruction against the logged length, and then
decomposed by which append the log says fired:

| what the log says fired | runs | median residual |
|---|---:|---:|
| nothing | 2 | **0 bytes** |
| memories only | 14 | 4,591 |
| memories + prior human reviews | 18 | 8,459 |
| memories + team ledger + team alignment | 838 | **34,233** |
| all four | 561 | **38,566** |

**The team context block is the single largest contributor to a real prompt — ~29.6 KB,
43% of a median prompt — and it is two `format!("{prompt_text}{…}")` calls in the runner.**

> **Calibration detail, stated because it is the evidence.** The two append-free runs are
> from 2026-06-11 and reconstruct 1,712 bytes high against the current source. That is
> exactly `DATA_HONESTY_INVARIANT` (`templates.rs:250`, 1,712 bytes), which
> `git rev-list -1 --before=2026-06-11T16:30` shows did **not** exist at that commit and
> does exist by 2026-06-19. Subtracting it for pre-2026-06-19 runs takes both deltas to 0
> and leaves 1,433 of 1,433 reconstructions non-overshooting. The transcription is not
> approximately right; it is right, and the residual is a dated build difference.

---

## Principle (stack-free head)

A model call has exactly one input that matters: the bytes you send. Everything else —
the persona record, the memory store, the tool registry, the retrieved documents — is
*material*, and material is not the artifact. The artifact is assembled, and assembly is
where three separate failures converge:

1. **The trust boundary is about origin, not about parameter position.** Content that
   arrived through the function's `input` argument gets fenced because it *looks* untrusted.
   Content that came out of your own database gets concatenated because it *looks* like
   yours. But a store the model can write to is not yours — it is a durable channel from
   whatever the model last read into every prompt you will ever build. Fence by origin.

2. **A budget on a section is not a budget on a prompt.** Every section can be individually
   capped and the total still unbounded, because nothing owns the total. And when a cap does
   fire, the entity that needs to know is the model — a log line tells the operator, who is
   not the one reasoning over a truncated corpus.

3. **Nothing downstream can tell you what you sent.** A model call is the one operation in a
   system where the input is enormous, derived from a dozen mutable sources, and *not*
   persisted. Every debugging question about model behaviour ("why did it do that?", "did it
   see the new instruction?", "is this regression a prompt change?") reduces to a question
   the system cannot answer unless assembly records its own output.

The prescription that follows from all three: **one assembler, one return type that cannot
be concatenated onto, one budget, and one record.**

---

## 1. Trigger

You are in this situation when you would say, or type, any of these:

- "I need to add a section to the system prompt."
- "The agent should also know about X — let me append X to the prompt."
- "Where do I put the retrieved memories / documents / prior decisions?"
- "Why did this run behave differently from that one? Same persona."
- "How big is the prompt? Is that why the cost went up?"
- **The "if you are about to write X" test:** if you are about to write
  `format!("{prompt}{something}")`, `prompt.push_str(&format!(...))` with a non-literal, or
  add a parameter to a function whose name ends in `_prompt`, you are here.

You are **not** here if you are choosing a model, setting effort, or bounding spend —
that is [`headless-model-call`](./headless-model-call.md) and
[`spend-ceilings`](./spend-ceilings.md). You are not here if you are parsing what the model
sent back — that is [`structured-output-extraction`](./structured-output-extraction.md).

---

## 2. The one way

**Assemble the prompt in one function, return a value the caller cannot concatenate onto,
and record what you sent.** Concretely: (a) **one door** — every byte that reaches the model
goes through one assembler; a caller that needs to add something passes it *in* as a
parameter, and never appends after the return. (b) **Make appending unspellable** — the
assembler returns a newtype, not a `String`, and its only extension method is
`push_untrusted(label, content)` which fences internally; then "add raw text to a prompt"
stops compiling. (c) **Fence by origin, not by parameter name** — anything read out of a
store the model can write to (its own memories, prior review notes, team ledgers, tool
results) is untrusted exactly as `input_data` is, and is *worse*, because a fence bypass
that persists gets re-injected on every future run forever. (d) **One budget for the whole
prompt**, not one per section, and when it fires **tell the model** with an in-prompt
omitted-count, not only the operator with a log line. (e) **Announce every truncation
in-band** and point at where the complete value is. (f) **Record the assembled prompt's
SHA-256 and byte length on the execution row**, in the same write that records the model
and the tool list — a hash is cheap, non-secret, and turns every "did it see X?" into a
lookup. (g) **Keep the prefix byte-stable** so the provider can cache it, put what varies at
the end — and put *nothing* after the instruction that tells the model to begin.

> If you must get one right first: **(a)**. Every other failure in §7 is downstream of the
> prompt having more than one door.

Two answers are genuinely available for (c) and it is worth saying which to reach for.
Sanitising (`sanitize_runtime_variable`) and fencing (`wrap_runtime_xml_boundary`) are not
alternatives — **reach for the fence first**. Sanitisation is a filter over a hostile input
space and is measurably incomplete (§7 D6); the fence is structural and does not depend on
enumerating attacks. Sanitise only values you must splice into *trusted* structure, where a
boundary tag would break the structure it is spliced into.

---

## 3. Mandated primitives

| primitive | what it gives you |
|---|---|
| `engine::prompt::assemble_prompt_with_skills` (`engine/src/prompt/mod.rs:161`) | The one assembler. Ten parameters, all of them content the prompt needs. Add an eleventh rather than appending after the call. |
| `engine::prompt::assemble_prompt` (`mod.rs:130`) | Thin wrapper for callers with no skill sidecar. **Note the four positional `None`s at every call site** — see §7 D9. |
| `runtime_safety::wrap_runtime_xml_boundary` (`runtime_safety.rs:26`) | Nonce-tagged `<untrusted_<label>_<nonce>>` boundary. `pub(super)` — deliberately unreachable outside `engine::prompt`. 18 production call sites. |
| `runtime_safety::sanitize_runtime_variable` (`runtime_safety.rs:90`) | Nine structural passes for values spliced into trusted structure. Announces its own truncation (step 9). |
| `prompt::replace_variables` (`variables.rs:12`) | `{{var}}` interpolation with a *closed* trusted-variable set and sanitisation of everything else. Warns on unresolved and on truncated keys (`variables.rs:127-142`). |
| `prompt::templates` (`templates.rs`) | Every static prompt string. **Never inline a prompt string literal in the assembler.** |
| `capabilities::render_active_capabilities` (`capabilities.rs:71`) | Renders `design_context.useCases`, filtered by `enabled != false`. Returns `""` when there is nothing — callers push unconditionally. |
| `capabilities::build_tool_documentation` (`capabilities.rs:330`) | One tool's docs. The *only* place tool text is shaped. |
| `prompt::render_correction_required` (`mod.rs:951`) | **The site to copy.** Splits a trusted half (compile-time const) from an untrusted half (nonce-fenced) *at construction*. |
| `personas_core::utils::text::truncate_on_char_boundary` | UTF-8-safe cut. Never slice a prompt string by byte index yourself. |
| `db::memory_recall::pack_by_budget` (`db/src/memory_recall.rs:193`) | Value-ranked greedy pack into a char budget; returns `omitted`, so the caller *can* tell the model. |

**Do not use** `prepared_run_cache::append_memories` (`prepared_run_cache.rs:93`) as a
model for anything — it is the divergent second copy of the memory renderer and is the
subject of §7 D3.

---

## 4. Steps

1. **Decide whether your content is a parameter or a section.** If it varies per execution,
   it is a parameter of `assemble_prompt_with_skills`. If it is fixed prose, it is a `const`
   in `templates.rs`. There is no third option, and in particular "append it in the runner"
   is not one.

2. **If it is a parameter, add it to the signature** — and stop to ask whether the signature
   can make the wrong call impossible before you add it. Ten positional parameters, seven of
   which are `Option`, is already the shape that produced §7 D9; prefer an options struct
   with named fields so a new caller cannot silently pass `None` for the thing you added.

3. **Classify its origin, in one sentence, in a comment at the site.** "This came from
   `<table>`, which is written by `<who>`." If `<who>` is or includes the model, it is
   untrusted and step 4 is mandatory.

4. **Fence untrusted content**: `prompt.push_str(&wrap_runtime_xml_boundary("<label>", value))`.
   Pick a `<label>` that names the origin, not the section. Do not hand-write a tag; the
   nonce is the point.

5. **Splice trusted values through `replace_variables`** if and only if they must appear
   inside prose you authored. Register any new magic name in `variables.rs`'s `trusted_vars`
   and document it — an unregistered `{{name}}` ships to the model as literal template
   syntax (measured: **27 of 78 personas** do this today, §7 D8).

6. **Give it a budget, and make the drop visible in-band.** Use `pack_by_budget` and render
   its `omitted` count as a line the model can read. A silent drop is a lie about
   completeness, and the model reasons as if it had everything.

7. **Place it before `## EXECUTE NOW`.** That block is the assembler's closing instruction.
   Anything after it is material the model is told to act *before* reading.

8. **And then stop.** `assemble_prompt_with_skills` owns ordering, the canary position, and
   the EXECUTE-NOW terminator. Do not re-order sections at the call site, do not post-process
   the returned string, and do not build a second assembler for your surface — there are
   already two (`assemble_prompt`, `assemble_resume_prompt`) plus `build_advisory_prompt`,
   and the second and third have never run in production (§7 D11).

---

## 5. Anti-patterns

| anti-pattern | the failure mode |
|---|---|
| `format!("{prompt_text}{section}")` after the assembler returned | The fence is `pub(super)`; from outside `engine::prompt` you *cannot* call it. So the content is appended raw, after the canary, forever. **8 sites; 44.5% of every real prompt.** |
| Concatenating a DB row's free text because "it's our data" | `persona_memories` is written by `emit_memory`, i.e. by the model, from whatever it just read. **1,031 of 6,535 memory rows (15.8%) already contain a triple-backtick fence** that is injected unescaped into the prompt's markdown. |
| A second copy of a renderer "for the fast path" | `prepared_run_cache::append_memories` renders the same two memory sections with **no budget at all** and **no omitted-count**, while the runner caps at 6,000 chars. Same headings, different contract, two answers for one persona. |
| A cache key that hashes "the important fields" | `prepared_run_cache::cache_key` (`:30-64`) hashes id, `system_prompt`, `structured_prompt`, `design_context`, `model_profile`, workspace instructions, tools, input. It does **not** hash `name`, `description`, or `parameters` — all three of which change the prompt. |
| A per-section cap with no total | `## Input Data` is deliberately uncapped (`mod.rs:863-875`); memory is capped at 6,000; team ledger at 15 rows; reviews at 5. Nothing owns the sum. Measured spread: **1,812 → 228,409 bytes**. |
| Telling the operator about a drop instead of the model | `pack_by_budget` returns `omitted`; the runner renders it (`runner/mod.rs:929-932`) — and its twin does not, and **the log format carrying it appears in 0 of 2,982 logs**. |
| Naming a section after the code that produced it | `## Agent Memory — Core Beliefs` is the header of a tier with **0 rows**. The banner ("Treat them as strong defaults") has never described anything. |
| Documenting the same protocol three times | `user_message`, `agent_memory`, `emit_event` and `manual_review` are each specified **three times in three different shapes** in every prompt (Protocol Tools + Communication Protocols + Protocol Integration). ~16 KB of every prompt. |
| Rendering a capability list the runtime does not enforce | Already measured by [`least-privilege-scope-grant`](./least-privilege-scope-grant.md) §0.3: the tool list is rendered into the prompt and the spawn gets `--dangerously-skip-permissions` (`cli_args.rs:107`). This path adds the size: that list is **0.49%** of the prompt. |

---

## 6. Evidence

**The one site to copy: `render_correction_required` (`engine/src/prompt/mod.rs:921-1001`).**
It is the only place in the tree that takes a single conceptual message, splits it into a
trusted half and an untrusted half **at construction**, renders the trusted half from a
compile-time `&'static str` (`fix_loop::FIX_INSTRUCTION_FRAMING`) and the untrusted half
inside a nonce-tagged boundary under its own banner — and then documents, in its own
docstring, the limit it does *not* close ("the *trigger* is still payload metadata"). Copy
its shape, its comment discipline, and its honesty.

Other exemplary sites:

- **`runtime_safety.rs:90-188`** — `sanitize_runtime_variable`'s nine passes, each numbered,
  each with the reason it exists. Step 9 (the announced truncation) is the model of an
  in-band drop notice.
- **`mod.rs:863-875`** — a divergence between two limits, *documented as deliberate at the
  site*, with the reason both numbers are right. This is what a cap disagreement should look
  like when it is intentional.
- **`variables.rs:53-142`** — classification before logging: unresolved keys and truncated
  keys are collected, deduplicated, and warned once per assembly rather than once per field,
  and a present-but-non-scalar key gets a *different* message from an absent one.
- **`capabilities.rs:71-156`** — `render_active_capabilities` returns `""` rather than an
  empty header, so the caller can push unconditionally. The right way to make an optional
  section.
- **`templates.rs`** — every static string in one file, each with a docstring naming the UAT
  finding or research run that produced it. `DATA_HONESTY_INVARIANT`'s comment
  (`templates.rs:241-249`) explains *why it is positioned where it is*, which is the fact a
  future editor needs and cannot recover from the code.

Live shape of the corpus this path governs:

| | |
|---|---:|
| Personas | 78 (74 enabled/active) |
| Personas with a `structured_prompt` | 73 |
| Recorded executions | 2,188 |
| Executions with a logged prompt length | 2,982 (logs outlive rows) |
| Prompt bytes shipped, 1,433 reconstructed runs | 107,020,554 |
| `prompt_assembly` trace spans | 2,942 |
| Distinct metadata keys ever on a `prompt_assembly` span | **1** (`is_resume`) |
| Recorded cost across all executions | $2,036.26 |

### Convergence — five sibling checkouts, and the cohort is three

Established at composition time, per leaf, as the doctrine requires.

**Disqualified:**

- **`personas-cloud` — a PORT, re-verified.** `packages/shared/src/prompt.ts:268` still
  says `// Prompt assembly (ported from engine/prompt.rs)` in its own source, and carries
  the tells: the same 11 zero-width codepoints in the same order, the same six
  `DANGEROUS_TAGS` in the same order, the canary wording identical modulo an em-dash, the
  magic constant `0x517cc1b7` (a 32-bit truncation of our `0x517cc1b727220a95`), and two
  comment blocks copied verbatim. Structure can converge; prose cannot.
- **`personas-web` — a CONSUMER, and silent anyway.** Zero AI SDKs in `package.json`, zero
  provider clients, **0 files containing a model-bound prompt literal**. It also reads this
  repo's generated connector catalog by path. Nothing to compare.

**Independent cohort (3): `brainiac`, `vibeman`, `ascent`** — all three return zero port
markers in both directions.

| clause | result | verdict |
|---|---|---|
| **C1** One assembler, nothing appended after it | **1 of 3** (ascent) | SPLIT — and Personas is in the failing group |
| **C2** Untrusted content structurally fenced | **0 of 3** | **SILENCE — Personas ahead, house convention** |
| **C3** Anything records what was actually sent | **0 of 3 completely**, 3 of 3 partially | SPLIT |
| **C4** A cap on injected content exists | **3 of 3** | **PHYSICS** |
| **C4b** The drop is announced to the model | **0 of 3 fully** | SPLIT — Personas ahead on one of two copies |
| **C5** Retrieved memory fenced like user input | **0 of 3** | **SILENCE — and Personas converges *with* the gap** |
| **C6** The prompt is deterministic | **0 of 3 fully**; 1 pins the system half deliberately | SPLIT — Personas behind |
| **C7** Prompt tool list == enforced tool list | **0 of 3** | SILENCE — universal |
| **C8** Prompt templates centralised | **2 of 3** | SPLIT — **Personas behind** |

Four of these are worth stating in full.

**C2 is the result that changes what this document may claim.** Not one independent sibling
has a prompt fence: no boundary tag, no nonce, no canary, no data banner. `brainiac` injects
raw at `extract.rs:680` and `compose.rs:255-261`; its closest analogue is a *fixed,
guessable* `HINT_MARKER` (`manual.rs:26`) whose own doc comment concedes it cannot reject
colliding content. `vibeman` injects raw at `executionWrapper.ts:59-67` and
`builder.ts:31-34` (`String(value)`, zero escaping). `ascent` has only a forgeable markdown
fence at `prompt.ts:157`, and **tracks the gap as open item 27 in its own backlog**
(`.claude/ship-loop/backlog.md:54`, still unchecked). The one repo in the family that shares
the fence has it because it copied ours. **The structural fence is a Personas house
convention, correctly reasoned and externally untested. `external-source-ingestion` already
had to withdraw this exact claim once when the cloud port was found; this sweep confirms the
withdrawal from a second direction.**

**C5 is where the oracle and this repo agree, badly.** Zero of three fence retrieved memory
— and neither does Personas. `brainiac`'s `compose.rs:8-22` names three firewalls in its
module header and prompt injection is not among them (the threat model is hallucination and
cross-tenant leakage; every mitigation is output-side). `vibeman`'s
`knowledgeBaseService.ts:261` uses the phrase "prompt injection" in the benign
string-interpolation sense, with no defence. Personas is the only repo in the family that
*built* the fence, and routes its memory around it. **The gap the cohort has by omission,
this repo has by bypass, which is worse: a bypass implies the mechanism was available and a
judgement was made.**

**C4 is physics and should be cited as such.** All three cap something. `brainiac` has 8
caps, `vibeman` 8, `ascent` 3 layers. Every repo also has at least one *silent* drop —
`brainiac` 4 of 8 (including `divergence.rs:191`, where 40 teams silently become 8),
`vibeman` 7 of 8 and no cap on total prompt size at all, `ascent`'s whole-file `break` at
`prompt.ts:159`. So: **capping is universal; announcing the cap is not.** Personas is ahead
on announcement in one copy of its memory renderer and level with the fleet in the other.

**C6 has an answer worth adopting.** `ascent` composes its system prompt **once at module
load** (`prompt.ts:123-127`), returns it verbatim (`:190`), and **pins it byte-stable with a
test** (`prompt.test.ts:146`) — for a stated reason, provider prefix caching
(`prompt.ts:118-122`). That is the C1+C6 pattern this repo does not have. Personas is
nondeterministic by construction (§7 D7) and ships `--exclude-dynamic-system-prompt-sections`
(`cli_args.rs:111`) specifically to improve cache hit rate, which is the same goal reached
from the opposite end.

**C8 is where Personas is behind, and it is a large gap.** Files containing a model-bound
prompt literal: `ascent` **4**, `brainiac` **6**, `vibeman` **59**, **Personas ~100**. The
sibling that scattered its prompts is visibly the messiest repo in the family; this one has
more scatter than that.

> **Method caveat carried up from the sweep, because it matters more than the integer.** Two
> independent counting methods (instruction-phrasing cues vs literal length) disagreed on the
> per-repo file counts — personas 100 / vibeman 53 / ascent 3 / brainiac 1 by one, and
> vibeman 59 / ascent 4 / brainiac 6 by the other. Neither is a ceiling. Treat the order of
> magnitude as the finding. And one near-miss worth recording: a naive `nonce` grep in
> `vibeman` returns dozens of hits, **every one of them the substring inside `runOnce`** — had
> that count been reported unopened, C2 would have flipped from 0 to "present".

---

## 7. Deviations

Twelve, ordered by how much of a real prompt they touch. **None of these is applied** — the
app is in daily use and the campaign's standing rule is that a behaviour-changing fix is a
note, not an edit.

### D1 — 44.5% of every prompt is appended where the fence cannot be reached · P0

`runner/mod.rs:973` (persona memories), `:1014` (prior human reviews), `:1042` (team shared
knowledge), `:1062`/`:1065` (mixed-engine directives), `:1089` (team alignment block);
`prepared_run_cache.rs:134`; `test_runner.rs:895`.

Eight sites. Each is `format!("{prompt_text}{…}")` — the assembled prompt re-bound by
interpolation after `assemble_prompt` returned. `wrap_runtime_xml_boundary` and
`sanitize_runtime_variable` are `pub(super)` inside `engine::prompt` (`runtime_safety.rs:26`,
`:90`), so **these sites cannot fence their content even if they wanted to.** Six of the
eight carry runtime, non-literal text; two carry literals.

Measured contribution: **47,670,467 of 107,020,554 prompt bytes (44.54%)**, median 34,233
bytes per run on the 838 runs that took the team path, 38,566 on the 561 that took all four.

The content is not incidental. `persona_memories.content` is written by the model's own
`emit_memory` from whatever it processed that run; `persona_manual_reviews.reviewer_notes`
is human free text; `team_memories.content` is written by other personas. All three are
concatenated as `- **{title}** [{category}]: {content}` with no escaping, and all three land
**after** `RUNTIME_CANARY_INSTRUCTION` (`mod.rs:760`) — the instruction that tells the model
which regions are untrusted. The canary names `<untrusted_*>` tags; none of this content has
one.

**Live evidence that the channel is already dirty, without anyone attacking it:**
**1,031 of 6,535 memory rows (15.8%) contain a triple-backtick fence**, injected raw into
the prompt's markdown. `sanitize_runtime_variable` escapes exactly this (`runtime_safety.rs:155`)
for values that go through the front door. Zero rows currently contain a `##` heading at line
start, a role-override line, or a `DANGEROUS_TAGS` tag — so this is a **latent** channel, not
an exploited one. It is durable, which is the part that makes it a P0: a memory written once
is re-injected on every subsequent run of that persona indefinitely.

### D2 — the current memory budget drops 93% of candidates, and its "N omitted" line has never been emitted · P0

`runner/mod.rs:850-857` fetches **10 core + 120 active** candidates; `:889` caps the active
section at `ACTIVE_MEM_BUDGET_CHARS = 6000`; `db/src/memory_recall.rs:209` is the `continue`
that drops an over-budget entry.

Replayed over the live corpus for all 78 personas: **4,052 candidates → 285 injected, 3,767
dropped (93.0%)**; **21,930,048 candidate bytes → 334,453 injected (1.5% survives)**. Worst
single case: `T: QA Guardian`, **118 candidates → 2 injected**, 711,198 bytes of candidate
reduced to 5,564.

The cause is entry size, not the budget's intent: **2,456 of 6,535 memories (37.6%)
individually exceed the entire 6,000-char active budget**, and the `working` tier alone holds
2,026 rows totalling 15.5 MB — a mean of 7.6 KB per memory. `pack_by_budget` admits at least
one entry by design (`memory_recall.rs:209`, `&& !selected.is_empty()`), so one 20 KB memory
can consume the whole budget and evict everything else.

The runner *does* render the omitted count (`runner/mod.rs:929-932`) — and **that log format
appears in 0 of 2,982 execution logs**, because every logged run predates it. So the one
mechanism that would tell the model it is reasoning over 7% of its memory has never run in
production, and there is no live evidence it works.

### D3 — a second memory renderer with no budget, no omitted-count, and a cache key missing three fields · P0

`prepared_run_cache.rs:93-136` renders `## Agent Memory — Core Beliefs` and
`## Agent Memory — Recent Learnings` with the same headings and the same line format as the
runner — and iterates `for m in &tiered.active` with **no budget**. Its only caller,
`prepare_persona_execution` (`executions.rs:551-580`), fetches with `active_limit = 40`.
The runner fetches 120 and packs to 6,000 chars. **The same persona gets 40 unbounded
memories from the speculative path and ~2–5 budgeted memories from the runner path, and
which one it gets depends on whether the editor was idle in the last five minutes**
(`PREPARED_RUN_TTL = 5 * 60`, `prepared_run_cache.rs:10`).

The cache key (`:30-64`) hashes `id`, `system_prompt`, `structured_prompt`, `design_context`,
`model_profile`, workspace instructions, tools, input. It does **not** hash:

- `persona.name` — rendered twice, at `mod.rs:196` and `:890`
- `persona.description` — a whole fenced section, `mod.rs:269-275`
- `persona.parameters` — selects `EXECUTION_MODE_DIRECTIVE` vs `DELIBERATE_MODE_DIRECTIVE`
  (a 3,359 vs 2,782-byte swap) and the fan-out directive

So renaming a persona, rewriting its description, or flipping its discipline gives you the
**old** prompt for up to five minutes. And the reuse path (`runner/mod.rs:830-843`) takes
`blob.memory_ids` as given, increments access counts for those stale ids, and never
re-queries — so a memory written in the interval is invisible and a memory deleted in the
interval still has its access counter bumped.

### D4 — nothing records the prompt that was sent · P0

Three places could and none does:

- **`persona_executions`** — 38 columns, **0** naming the prompt. `execution_config`
  (`runner/mod.rs:538-573`) records model, engine, budget, turns, timeout, workspace id,
  **tool names**, **credential hint strings**, and `assembled_at`. Every key ever present
  across all 2,011 non-null configs: `assembled_at, compliance_rule, continuation_mode,
  credential_connectors, engine, has_workspace_instructions, max_budget_usd, max_turns,
  model_profile, routing_rule, timeout_ms, tool_names, workspace_id`. **None names the
  prompt, its length, or a hash.**
- **`execution_traces`** — 2,942 `prompt_assembly` spans across the whole store. The span is
  opened at `runner/mod.rs:731-736` with `{"is_resume": …}` and closed at `:1100` with
  `(None, None, None, None)`. **The only metadata key ever recorded on any of the 2,942 is
  `is_resume`.** Duration is there; size is not.
- **`chat_session_context.system_prompt_hash`** (`db/src/migrations/schema.rs:1460`) — the
  one column in a 244-table schema that could hold this. **The table has 0 rows.**

The single durable trace is `logger.log("Prompt length: {} characters")` at
`runner/mod.rs:1113`, written to a `.log` file under `AppData` that no query reaches. That
line is what made this document's measurement possible, which is the argument for making it
a column.

And `persona_executions.input_tokens` is **0 on all 2,188 rows** — so the prompt's cost is
not recorded either, only `cache_read_tokens` / `cache_creation_tokens` (populated on 585 of
2,188) and a total `cost_usd` of $2,036.26.

### D5 — the memory tier that is always injected is empty, and the preamble describes a table that does not exist · P1

`runner/mod.rs:861-871`: "Core beliefs — always present, define agent identity." Measured:
**0 core-tier rows in 6,535**, and **0 of 2,729 logged runs that injected memory injected a
core memory**. The header, its banner ("Treat them as strong defaults") and the fetch have
never described anything.

Meanwhile `MEMORY_SYSTEM_PREAMBLE` (`templates.rs:13-35`, 1,785 bytes, pushed at `mod.rs:743`
on **100%** of prompts) tells the model:

- that its memories are "stored in the `memories` table" — **there is no table named
  `memories`** in either database; it is `persona_memories`;
- that a memory "has a tier (`working` → `active`)" — omitting `core`, which is the tier the
  code says is always injected, and `archive` (1,377 rows);
- that a "Knowledge base (vector)" is available for retrieval — the vector store lives in the
  second database (`personas_data.db`) and nothing in `assemble_prompt` or the runner
  retrieves from it into the prompt.

1,785 bytes on every execution, describing a memory system that is not the one behind it.

### D6 — the tag stripper is not idempotent, and one pass is all it gets · P1

`runtime_safety.rs:137-141` removes `</?<tag>\b[^>]*>` for each of six `DANGEROUS_TAGS`, once.
Replayed through the transcription:

| input | after pass 1 | after pass 2 |
|---|---|---|
| `<<system>system>` | `<system>` | `` |
| `<sy<system>stem>` | `<system>` | `` |
| `<<prompt>prompt>x` | `<prompt>x` | `x` |

3 of 4 nested forms tested survive the single pass with a live tag. The production code runs
pass 1 only. This is the classic nested-tag bypass, and it is worth stating precisely what it
does and does not buy an attacker: the value is *also* wrapped in a nonce-tagged boundary
(§3), so a surviving `<system>` sits inside untrusted structure. The stripper is defence in
depth, and this is the depth failing, not the boundary.

`personas-cloud`'s port carries the same six tags in the same order and the same single-pass
loop, so the defect is duplicated — report only, per the standing rule on sibling repos.

### D7 — the same persona never assembles the same prompt twice · P1

**0 of 78** personas produce byte-identical output from two back-to-back assemblies over an
unchanged database. Sources, in order of size:

1. **The nonce.** `generate_runtime_nonce` (`runtime_safety.rs:13-21`) mixes the wall clock
   with a process counter. A mean of **4.9 boundaries per prompt** means ~78 hex digits of
   guaranteed per-call difference.
2. **`pack_by_budget(…, Utc::now())`** (`runner/mod.rs:917`) — decay scoring is a function of
   elapsed time. Measured over the live corpus: the injected memory set changes with **no data
   change at all** for **1 of 59** personas after one day and **5 of 59 (8.5%)** after seven.
   Small, but it means a regression can appear without an edit.
3. **`personas_core::drive_root::get()`** (`mod.rs:723`) — a `OnceLock`. The
   `**Sandbox snapshot.**` paragraph appears if and only if some *unrelated* `drive_*`
   command has run earlier in the same process. Same persona, same data, different prompt,
   decided by process history. This is doctrine §1's "types cannot reach through a global",
   in the prompt.
4. **`{{now}}` / `{{today}}` / `{{iso8601}}` / `{{weekday}}`** (`variables.rs:23-26`) — 0 of
   78 personas currently use one, so this is latent.

The nonce is deliberate and correct. Items 2–4 are not, and item 3 in particular makes the
prompt a function of something no reviewer would think to check.

**And the nonce is weaker than its docstring implies.** It is `nanos ^ counter ^ const`, so
all boundaries in one assembly derive from one clock read microseconds apart. Transcribing
the algorithm and emulating a 100 ns clock: the five nonces of a single prompt share a mean
of **11.95 of 16 hex digits**, worst case 9 — so **knowing any one tag leaves ~16 bits of the
others, not 64.** (The emulated clock granularity is not the production one; the *structural*
property — one clock read, five nonces — is a property of the code, not the emulation.) The
model is shown every tag, and its output is stored; `untrusted_` currently appears in **0 of
6,535** memory rows, so nothing has leaked yet.

### D8 — 27 of 78 personas ship unresolved `{{placeholders}}` to the model · P2

Assembling all 78 personas cold, **27** emit at least one `{{key}}` that resolves to nothing
and ships as literal template syntax. Examples: `{{verdict}}` (4 personas), `{{date}}` (6),
`{{count}}`, `{{APPROVE/REQUEST_CHANGES}}`, and eleven `{{param.*}}` names
(`param.ideas_per_source`, `param.severity_threshold`, `param.changelog_format`,
`param.release_note_length`, `param.version_strategy`, …) whose parameter exists but carries
no `value`.

`replace_variables` warns about exactly this (`variables.rs:127-133`) — and the warning goes
to `tracing`, not to the prompt and not to a row, so nothing surfaces it. The `{{param.*}}`
subset is the interesting half: `variables.rs:34-46` only registers a parameter when it has
a `value` key, so a parameter with only a `default_value` silently fails to interpolate while
`DisciplineMode::resolve` (`mod.rs:74-77`) *does* fall back to `default_value`. Two readers of
the same JSON, two different fallback chains.

### D9 — `assemble_prompt(p, t, i, None, None, None, None)` · P2

Four positional `None`s at the call site, three of them the same type
(`Option<&[&str]>`, `Option<&str>`, `Option<&[ResolvedConnectorHint]>`) plus
`Option<&str>` for ambient context. Live at `runner/mod.rs:774-783`,
`executions.rs:551-560`, `dry_run.rs:289`, `analysis.rs:589`, `cloud.rs:583/:890/:975`,
`gitlab/converter.rs:171/:239`, `personas.rs:201/:317`, `test_runner.rs:732`.

[`dry-run-preview`](./dry-run-preview.md) §7 already flagged this exact shape as "the residue
no type reaches" — same symbol, same types, nothing distinguishing a deliberate `None` from a
forgotten one. This path adds the consequence: `assemble_prompt_with_skills` has **ten**
parameters and **seven** are `Option`. Adding an eleventh is the normal way to extend this
function (§4 step 2), and every existing call site will keep compiling with a silent `None`.
The fix is an options struct with named fields — `#[non_exhaustive]` plus `Default` — which
turns "you forgot the new one" into "you got the default and it is named".

### D10 — the same protocol is specified three times, in three shapes, in every prompt · P2

Static prompt text, per execution:

| block | bytes | pushed at |
|---|---:|---|
| Communication Protocols (8 `PROTOCOL_*` constants) | 6,244 | `mod.rs:746-754` |
| `PROTOCOL_INTEGRATION_REQUIREMENTS` | 6,228 | `mod.rs:757` |
| Protocol Tools (inline literals) | 3,532 | `mod.rs:471-487` |

`user_message`, `agent_memory`, `emit_event` and `manual_review` are each documented in all
three, with **different names and different call shapes in each**: `emit_message` /
`user_message`; `emit_memory` / `agent_memory`; `request_review` / `manual_review`. The
Protocol Tools block presents them as `tool_use` calls and says to prefer them; the
Communication Protocols block presents them as JSON lines; the Integration block presents the
JSON lines again as mandatory. Three vocabularies, one set of eight actions, **~16 KB of every
prompt (23% of a median one)**.

Two asymmetries fall out of the same reading: `raise_incident` and `propose_backlog` are
documented **only** in Protocol Tools — and `PROTOCOL_RAISE_INCIDENT` exists in
`templates.rs:122`, is complete, carries `#[allow(dead_code)]`, and is **pushed nowhere**.
`propose_improvement` is documented **only** in the Integration block.

### D11 — dead prompt surface: sections that have never rendered · P2

Reconstructed across 1,433 real prompts and cross-checked against 2,188 stored `input_data`
values:

| section | site | live occurrences |
|---|---|---:|
| `## Triggering Event` | `mod.rs:233-266` | `_event` in **0 of 2,188** |
| `## Event Handlers` | `mod.rs:301-352` | `eventHandlers` in **0 of 78** personas |
| `## Time Filter` | `mod.rs:843-861` | `_time_filter` in **0 of 2,188** |
| `## Correction Required` | `mod.rs:951-1001` | fix re-entry in **0 of 2,188** |
| Advisory mode (whole prompt replaced) | `advisory.rs` (404 lines) | `_advisory`/`_ops` in **0 of 2,188** |
| `DELIBERATE_MODE_DIRECTIVE` (2,782 B) | `mod.rs:205` | `execution_discipline` in **0 of 78** |
| `FANOUT_DIRECTIVE` | `mod.rs:220-222` | `deep_fanout` in **0 of 78** |
| `## Learned Skills (your scratchpad)` | `mod.rs:516-541` | scratchpad dir holds **0 files** |
| `**Sandbox snapshot.**` | `mod.rs:723-735` | 0 of 1,433 reconstructions |
| Ambient desktop context | `mod.rs:763-770` | runner passes `None` (`:798`) |
| Capability generation policy | `mod.rs:822-839` | 0 of 1,433 |
| `## Custom Sections` / `## Web Search` | `mod.rs:390-423` | `customSections` **0 of 78**, `webSearch` **0 of 78** |
| `assemble_resume_prompt` | `resume_prompt.rs` | `continuation_mode='session_resume'` in **0 of 2,011** |

That is roughly **340 lines of `assemble_prompt` plus a 404-line sibling module** with no
live evidence. This is a finding, not a demand to delete: several are correct
forward-compatibility (`_event` wiring exists in `engine/background.rs`), and `## Current
Focus` — which sits in the same conditional family — *does* render, in **87 of 1,433** runs
(6.1%), so the pattern is not inert. But it changes what a reader may assume: **the
assembler's shape is mostly aspiration, and the 55% of a real prompt that comes out of it is
produced by a small, always-on subset.**

`assemble_resume_prompt` deserves its own line. It renders `## Input Data` inside a plain
triple-backtick `json` code fence (`resume_prompt.rs:58-62`) — **no boundary tag, no nonce,
no canary, no "treat as data" banner**. Every structural defence in `mod.rs` is absent there.
With 0 recorded session-resume executions it is latent, and it is one setting away from live.

### D12 — the fan-out directive promises a budget nothing sets · P3

`FANOUT_DIRECTIVE` (`mod.rs:89-94`) documents that "Cost is bounded by the persona's
`--max-budget-usd`, which a fan-out persona should set". Measured: **0 of 78 personas have
`max_budget_usd` set**, and **0 have `max_turns` set**, so `build_cli_args_inner:132-146`
pushes neither flag on any execution. [`headless-model-call`](./headless-model-call.md)
reached the same conclusion from the construction-site direction (Q3: one construction site,
zero headless calls reach it); this is the persona-row half of the same fact.

---

## 8. Gaps

**G1 — the fence cannot be exported, and that is why D1 exists.** `wrap_runtime_xml_boundary`
and `sanitize_runtime_variable` are `pub(super)` (`runtime_safety.rs:26`, `:90`) and the
module README states it as an invariant ("never call from outside `engine::prompt`"). That
decision is defensible — it keeps the nonce discipline in one place — but it makes the
correct behaviour *unavailable* to the five callers that hold 44.5% of the prompt. A rule
that concentrates a concern by making it unreachable has relocated the concern, not
concentrated it. The resolution is not to widen the visibility; it is to move the content
inside — the runner's five appends are five more parameters.

**G2 — no type can express "this is a prompt".** The assembler returns `String`. Rust cannot
distinguish it from any other `String`, so `format!("{prompt_text}{x}")` is as legal as any
other interpolation and no lint reaches it. **This is the gap that makes §9 a ratchet rather
than a fix**, and it is closable: a newtype closes it exactly (see §9's type proposal), which
is the rare case where doctrine §1's "prefer a type" applies cleanly and all seven
qualifications pass.

**G3 — no type reaches inside `structured_prompt`.** Identity, instructions, event handlers,
tool guidance, examples, error handling, custom sections and the web-search prompt all live
as JSON inside one `TEXT` column and are read with `serde_json::from_str::<Value>` +
`.get("key").and_then(|v| v.as_str())` (`mod.rs:279-423`). A missing key, a key holding an
array, and a key holding `""` are three different outcomes and two of them are silent. This
is doctrine §1's fourth item — no type reaches inside a serialized blob — and it is why D8's
`{{param.*}}` failures cannot be caught at compile time.

**G4 — the census cannot assert the absence that matters most.** D4 ("nothing records the
prompt") is an absence: no count of anything present detects it. The instrument for it is not
a ratchet but a column plus a test, and §9 says so rather than pretending otherwise. The same
is true of D5 (a tier with zero rows), D11 (sections that never render), and D2's headline
(93% dropped) — all four were found by *running* the system against real data, and none is
gateable by counting source text.

**G5 — a per-section budget cannot bound a prompt.** Every cap in this path is local:
`MAX_RUNTIME_VAR_LENGTH = 2000` per `{{var}}` (`runtime_safety.rs:4`),
`ACTIVE_MEM_BUDGET_CHARS = 6000` (`runner/mod.rs:889`), 15 team memories (`:1035`), 5 reviews
in 14 days (`:991`), `MAX_ROSTER` teammates (`team_context.rs:128`), and `## Input Data`
deliberately uncapped (`mod.rs:863-875`). No code anywhere reads the assembled length and
decides anything. Live spread: **1,812 → 228,409 bytes**, a factor of 126. The convergence
oracle says capping is physics (3 of 3 siblings) — but so is the local-cap failure mode:
`vibeman` has 8 caps and no total either.

**G6 — the model is told about drops through a channel it cannot read.** `variables.rs:127-142`
warns on unresolved and truncated keys; `runner/mod.rs:938-944` logs the injected/omitted
counts; `runtime_safety.rs:180-185` *does* put its truncation marker in-band. Two of three go
to `tracing`, and the model — the entity whose reasoning is affected — sees only the third.

---

## 9. The missing gate

**What condition the signal is a proxy for:** *a model prompt receives content at a place
where the fence that governs untrusted content cannot be called.* In this repo that condition
manifests as an assembled prompt being re-bound by string interpolation outside
`engine::prompt`. **An adopting repo must re-derive its own proxy** — the manifestation is
Rust `format!` here, would be `+=` in TypeScript, and would not exist at all in a repo whose
assembler returns an immutable structure.

**Why a gate at all:** all twelve deviations above shipped under a green `npm run check`, and
D1's eight sites are invisible to every one of the 79 committed Rust census rules (measured
below). The condition has no compiler, no lint, and no test.

### The rule

```json
{
  "id": "prompt-extended-outside-its-assembler",
  "goldenPath": "docs/concepts/golden-paths/prompt-assembly.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "format!\\(\\s*\"\\{(?:prompt|prompt_text|base_prompt|system_prompt)\\}",
    "flags": "g",
    "description": "An assembled model prompt is re-bound by interpolation after the function that owns its untrusted-content fence has returned. `wrap_runtime_xml_boundary` / `sanitize_runtime_variable` are `pub(super)` inside `engine::prompt`, so text added at one of these sites CANNOT be fenced even in principle — it is appended raw, after the runtime canary."
  },
  "baseline": { "files": 3, "matches": 8 },
  "floor": 800
}
```

### The positive control

```json
{
  "id": "prompt-extended-outside-its-assembler-positive-control",
  "goldenPath": "docs/concepts/golden-paths/prompt-assembly.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "push_str\\(&wrap_runtime_xml_boundary\\(",
    "flags": "g",
    "description": "CONTROL — the compliant way to add runtime content to a model prompt: through the nonce-tagged boundary, inside the module that owns it. Same concern (a prompt receiving runtime text), opposite verdict."
  },
  "floor": 800
}
```

### Validation

Run standalone in a private scratch registry (`gp-pa-rules-c910acc6.json`), never against the
full registry:

```
prompt-extended-outside-its-assembler                    3 files    8 matches   963 walked
prompt-extended-outside-its-assembler-positive-control   1 file    14 matches   963 walked
census OK — 2 rule(s), 1926 file-visits
```

**Violating (8 sites, 3 files), each hand-verified:**

| site | what it appends |
|---|---|
| `src/engine/runner/mod.rs:973` | persona memories (core + active), unfenced |
| `src/engine/runner/mod.rs:1014` | prior human-review decisions incl. reviewer notes, unfenced |
| `src/engine/runner/mod.rs:1042` | team shared knowledge ledger, unfenced |
| `src/engine/runner/mod.rs:1062` | mixed-engine directive (literal) |
| `src/engine/runner/mod.rs:1065` | local-first contract (literal) |
| `src/engine/runner/mod.rs:1089` | team alignment block (roster, goals, incidents, directives), unfenced |
| `engine/src/prepared_run_cache.rs:134` | the second, unbudgeted memory renderer |
| `engine/src/test_runner.rs:895` | sandbox section |

Precision on *"extends an assembled prompt outside its assembler"*: **8/8**. On *"…with
runtime, non-literal text"*: **6/8 (75%)** — the two mixed-engine sites append compile-time
literals and are false positives for the narrower reading. Both counts are published because
the rule gates the broader condition (the fence is unreachable regardless of what you append)
and a reader deserves the narrower one.

**Compliant control (14 sites, 1 file):** `engine/src/prompt/mod.rs` lines 272, 284, 294,
358, 370, 382, 403, 417, 427, 436, 767, 847, 883, 999. The control **partitions the concept,
not the regex** — both patterns answer "a prompt is receiving runtime content", one through
the fence and one where the fence cannot be reached. A further **4** fence uses
(`mod.rs:783, 794, 854, 855`) go through `format!` rather than `push_str` and are outside the
control pattern, so the true compliant population is **18**, not 14; the control understates
itself by 22% and is reported that way rather than widened, because widening it would let it
match the `format!` family the violating pattern also lives in.

### Overlap — measured at SITE level against the FINAL pattern

Of the **157** committed census rules, **79** are rooted at `src-tauri` with `.rs`. Each
rule's own committed pattern was re-run over this path's three matched files:

| | |
|---|---:|
| Committed rules that match *any* line in my 3 files | **9** |
| Committed rules that match *within ±1 line* of any of my 8 sites | **0** |
| **Site-level overlap** | **0%** |

The nine file-level co-occurrences (`unregistered-tauri-event-name`,
`model-struct-without-rename-all`, `unqueryable-log-record`, `settings-bool-by-string-compare`,
`secret-as-bare-string-field`, `hand-rolled-emptiness-refusal`, `unverified-effect-dispatch`,
`partial-terminal-status-set`, `unobservable-detached-task`) are unsurprising —
`runner/mod.rs` is 3,137 lines and `test_runner.rs` is a large module — and every one of them
lands at a different line. File overlap would have read as 9 collisions; site overlap reads
as zero, which is the number that matters.

Three neighbouring rules were checked by name for concept overlap and none competes:
`model-output-persisted-without-preview` (ai-draft-preview-apply) keys on what happens
*after* a model call and matches `team_synthesis.rs`, `template_adopt.rs`,
`kpi_derivation.rs` — disjoint files, opposite side of the call.
`handrolled-llm-envelope-scan` and `model-reply-parser-without-a-reason` both key on
*parsing* model output. **Nothing in the registry asks what goes into a prompt.**

### How it fails loudly if its own precondition is absent

Inherited from the runner and sufficient: the walk must see ≥ **800** `.rs` files (it sees
963) or the run exits 1 with "matcher broken, not codebase clean"; a rule matching zero files
exits 1; a rise exits 1 under `--check`; and a **silent drop also exits 1**, which is the
mode that matters here, because the natural way to "fix" D1 is to rename `prompt_text` and
keep appending.

### Prefer the type — and it passes all seven qualifications

The gate is a ratchet. The fix is a type, and this is the uncommon case where doctrine §1's
qualifications all clear:

```rust
pub struct AssembledPrompt(String);

impl AssembledPrompt {
    /// The only way to add runtime content. Fences internally.
    pub fn push_untrusted(&mut self, label: &str, content: &str) { /* wrap_runtime_xml_boundary */ }
    /// Consume for the spawn. No Deref, no DerefMut, no Display, no `+`.
    pub fn into_stdin(self) -> String { self.0 }
}
```

- **Q1 (carries only what it encodes):** it encodes exactly "this string is a model prompt
  and additions to it must be fenced" — which is the whole condition, not a proxy for it.
- **Q2 (requiredness ≠ closedness):** the win is closedness — removing `Deref`/`Display` —
  not requiring anything new.
- **Q3 (someone constructs it):** one construction site, `assemble_prompt_with_skills`, with
  **13 live callers** across `runner`, `executions`, `dry_run`, `analysis`, `cloud`,
  `gitlab::converter`, `personas`, `test_runner`.
- **Q4 (nobody else can construct it):** private field in `engine::prompt`; the eight
  violating sites are in *other* crates and modules, so they physically cannot rebuild one.
- **Q5 (withholding beats requiring):** it withholds `String`'s concatenation surface rather
  than demanding a new argument. All eight §9 sites become compile errors.
- **Q6 (withhold the dangerous freedom, not the answer):** it withholds *raw* append and
  hands back `push_untrusted`, so the runner's five sections still ship — fenced.
- **Q7 (the requirement was forcing the bad value):** yes — `String` is what makes
  `format!("{prompt_text}{x}")` the obvious move. Nothing else pushes callers there.

**And say what a gate cannot.** D4 (nothing records the prompt) is an absence and is not
gateable by counting. The instrument for it is a schema change plus a test:
add `prompt_sha256 TEXT` and `prompt_bytes INTEGER` to `persona_executions`, write both in
the same statement that writes `execution_config` (`runner/mod.rs:538-573`), and assert in a
Rust unit test that a config write without them fails to compile — which the same
`AssembledPrompt` type buys, if `into_stdin` also returns the hash. Until that lands, the
honest §9 for D4 is: **there is no gate, and this is the finding.**

---

## 12. Corrections to the brief

The brief carried five primed leads and two spine labels. **Four leads hold, one is off by
three, and both labels fail** — one of them in a way the corpus has not recorded before.

### 12.1 — `sides: "client"` is wrong again, and this is the seventh

Not one finding in this document is on the client. Every deviation, the census rule, the
positive control, and all 107 MB of measured prompt bytes are Rust:
`src-tauri/engine/src/prompt/**` (4,863 lines), `src-tauri/src/engine/runner/**`,
`src-tauri/db/src/memory_recall.rs`. The frontend's entire relationship to prompt assembly is
`src/lib/personas/promptMigration.ts:228`, a comment *describing* what
`assemble_prompt()` does.

The brief itself flagged this ("contradicted on 6 of 6 leaves that tested it"). Reporting the
seventh: the honest label is **`server`**. At 7 of 7 the field is not weak evidence, it is
inverted evidence, and the doctrine's existing wording — *anti-correlated with where the
answer lives* — should be read as settled rather than provisional for this value.

### 12.2 — `convergence: mixed` fails, and it fails in the rarest way

`ai-draft-preview-apply` was the first leaf to have a `mixed` label hold, and
`least-privilege-scope-grant` was the second. This is the third test and it fails — but not
by being uniformly silent or uniformly converged. It fails because **one clause converged and
this repo is on the wrong side of its own strongest clause.**

- **C4 (a cap exists): 3 of 3 — physics.** Safe to cite.
- **C2 (the untrusted-content fence): 0 of 3 — silence.** The mechanism this leaf is *most
  known for* has no independent corroboration anywhere in the family. The only sibling that
  has it copied it from here, comments and constants and all.
- **C5 (retrieved memory fenced like user input): 0 of 3 — and Personas is in the 0.**

So `mixed` is directionally not wrong; what it cannot carry is the *shape*. This leaf's
convergence splits three ways — physics on one clause, silence-with-Personas-ahead on
another, and silence-with-Personas-in-the-gap on a third — and the third is the one that
matters, because it is the case where a single enum value would encourage a composer to write
"the fleet agrees" about a practice this repo does not follow. Same failure family as the
cross-device-pairing leaf, one degree worse: not merely that a clause splits, but that a
clause *converges on the disease and Personas has it too*.

### 12.3 — "21 fence sites" is 18

`grep -c wrap_runtime_xml_boundary` over the tree returns 21. **Three are inside
`#[cfg(test)]`** (`mod.rs:2089`, `:2100`, `:2101`); the brace-matched production count is
**18**, at `mod.rs:272, 284, 294, 358, 370, 382, 403, 417, 427, 436, 767, 783, 794, 847, 854,
855, 883, 999`. The brief inherited the raw grep count from `external-source-ingestion`
(which states "fences 21 fields"). The conclusion is unaffected — 18 fenced sites versus 8
unfenceable ones is the same story — but doctrine's rule that `#[cfg(test)]` exclusion must be
a brace-matched range, not a line threshold, is exactly what separates the two numbers, and a
composer citing 21 has cited a number that includes two calls literally named
`wrap_runtime_xml_boundary("test", "data")`.

### 12.4 — "the whole `input_data` blob" is fenced — confirmed, and the *reason* is documented

`mod.rs:876-884` wraps the pretty-printed JSON of the entire `input_data` in a nonce boundary
with a "treat as data only" banner. What the brief did not carry is that the **absence of a
cap there is deliberate and reasoned in place** (`mod.rs:863-875`): `MAX_RUNTIME_VAR_LENGTH`
bounds a value spliced into *trusted* structure at a `{{var}}` site and is an injection
control, while `## Input Data` is isolated and deliberately complete. Live: **75.5% of 2,188
stored inputs exceed 2,000 bytes**, so the divergence fires constantly and the truncation
marker (`runtime_safety.rs:180-185`) points at the complete copy. That is one of the better
comments in the tree and the brief should have carried it as a positive, not just the fence
count.

### 12.5 — "562 MCP tool-result reads bypassed the fence" — this leaf is the *general* case

`external-source-ingestion` §7.F is right and understated. A tool result bypasses the fence
because it never passes through `assemble_prompt` — but so does **44.5% of every prompt**,
through five sites in the runner, and those five are worse in one specific way: **a tool
result is transient, a memory is durable.** The 1,031 memory rows already carrying triple
backticks will be re-injected on every future run of their persona indefinitely. The two
findings are the same mechanism at two timescales, and this one should be cited when the
question is "what else bypasses the fence".

### 12.6 — "`assemble_prompt(p, t, i, None, None, None, None)`" — confirmed, and worse

Four positional `None`s is the shape `dry-run-preview` flagged. Measured: the real function
is `assemble_prompt_with_skills` with **ten** parameters, **seven** of them `Option`, and
`assemble_prompt` is a wrapper that hard-codes the eighth. So the residue is not four `None`s
but seven optional slots with no named-argument discipline, across **13** call sites. The
brief's shape is right and its size is understated by 75%.

### 12.7 — "a 600-second Claude rewrite runs over `agent_ir` while the adoption preview is on screen" — true, and out of scope in a way worth stating

Verified as `ai-draft-preview-apply` §0 reports it (`template_adopt.rs:2013`, 660 s wrapper
timeout at `templateAdopt.ts:115`). It is upstream of this leaf, not inside it: it rewrites
the *stored* `system_prompt`/`structured_prompt`, which this path then reads. The connection
worth recording is a number: that rewrite changes the **10.75%** of the prompt that is
persona-authored, and nothing anywhere records which version of it any given execution
actually used — `persona_prompt_versions` holds **25 rows** against **2,188** executions. So
the two leaves compose into a single unanswerable question: *which prompt produced this run?*
Neither half can answer it alone.

### 12.8 — "the `core` tier is empty (0 of 6,535)" — confirmed, and it is worse at runtime than in the table

Confirmed exactly: 3,132 active + 2,026 working + 1,377 archive = 6,535, **core 0**. The
runtime half the brief asked for: **0 of 2,729 logged executions that injected any memory
injected a core one**, and the `## Agent Memory — Core Beliefs` header has therefore never
appeared in a production prompt. Two adjacent facts found while checking it:
**1,505 of 6,535 memories (23%) are capability-scoped** (`use_case_id NOT NULL`) and are
invisible to the **93.3%** of executions that carry no `_use_case`; and **0 memories carry
`home_team_id`**, so the home-team sharing clause the scope builder implements
(`memories.rs:1337-1344`) has never had a row to share.

### 12.9 — a correction to my own instrument

My first accounting subtracted `DATA_HONESTY_INVARIANT` from *every* reconstruction because
two June-11 runs came out exactly 1,712 bytes high and 1,712 is exactly that constant's size.
That was a coincidence-shaped inference and it was wrong for 239 of 1,433 runs: diffing the
June-26 `assemble_prompt` body against today's shows them **textually identical**, and the
constant is present in the June-26 tree. Only bisecting the actual commit dates
(`git rev-list -1 --before=…`, probing 2026-06-12 → 2026-06-20) established that it landed
on 2026-06-19, *between* the two append-free runs and the rest of the corpus. Applying the
correction by execution date rather than globally moved the accounted share from 55.07% to
**55.46%** and — the part that mattered — left the two exact matches exact while keeping
overshoot at zero.

The lesson is doctrine §2's: **a measurement that agrees with the number you were expecting
is the one to re-run.** 1,712 matched a constant I had just read. It was the right constant
for the wrong reason, and the only thing that separated them was a date probe I nearly
skipped.
