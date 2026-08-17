# Deterministic verification loop

> Situation node: `ai-and-agents/prompt-and-output/deterministic-verification-loop` ·
> [situation spine](../situation-spine.json) · `sides: "server"` (**upheld —
> mechanism named in §12.1**) · `twoSided: false` · recurrence 4 · risk medium ·
> `convergence: "converged"` (**contradicted — §12.2**) · dimensions: function ·
> cost · resilience.
> Spine `why`: *"Running a real check after a model run and looping the failure
> back in."*
>
> **Short form** (Mode 2 batched tail): spine header, §0 headline, §2 the one
> way, §7 deviations, §9 rule-or-decline, §12 corrections. Every count carries
> two independent implementations and a hand-verified precision.
>
> Composed 2026-08-17 against `master @ 2a874e692`. Sweep: the three verification
> loops in the tree (`src/engine/build_session/oneshot.rs`,
> `src-tauri/engine/src/fix_loop.rs`, `evals/`), all 963 `.rs` files
> ([`shared-facts.json#rust.files`](../shared-facts.json)), 4,727 `.rs`/`.ts`/`.tsx`
> files for model identifiers, and a read-only copy of the **2026-08-17 purge
> backup**. Row counts are historical as of 2026-08-17.

---

## 0. Headline

**The `evals/` lane is six files, 124 `expect()` assertions, and zero `await`.
Not one of them calls a model.** Five of the six are named `*.golden.test.ts`,
live under `evals/prompts/`, and assert that a **prompt builder** put the
fixture's data into the prompt string. `research-synthesis.golden.test.ts:26-50`
checks that every hypothesis statement, every experiment name and every finding
title reaches the prompt; `:55-56` checks the anti-hallucination sentence
survives; `:60-61` checks the output *contract is declared*. All of it is true
and none of it is a check on behaviour. **The lane verifies the input to the
model and never the output of the model** — and it runs on every `git push`
(`lefthook.yml:81-82`).

That is the trap `.claude/CLAUDE.md` records in its own words — *"the check
confirmed numbers round-tripped into the asset, never that the result was
meaningful… **a gate that asserts data is not a gate on behavior**"* — committed
by this repo's own eval harness. Its `README.md:16-20` is honest about it
(*"Golden-output evals — the next step… This needs recorded transcripts"*), but
the honesty lives in a README and the file names say `golden`.

**The one verification loop that has ever executed is excellent, and it is worth
copying before anything here is criticised.** `build_session/oneshot.rs` runs
real tool tests, evaluates them through a gate that **fails closed**, and loops
the failure back into a bounded LLM fix pass. Its gate,
`evaluate_promote_gate` (`oneshot.rs:392-513`), carries its own history in a doc
comment: it *used to be* one line —

```rust
report.get("tools_failed").and_then(|v| v.as_u64()).unwrap_or(0) == 0
```

— *"which failed OPEN on every malformed shape: a missing key, `null`, the string
`"2"`, a float, or a report that was not an object at all all collapsed to `0`
and promoted."* Today it is three rules in order — **shape**, **integrity**
(*"a report claiming `tools_failed: 0` while carrying a failed entry is lying
about itself"*), **verdict** — with a fourth outcome, `Held`, that refuses to
promote a build nothing was actually run against. **12 build sessions exist in
the backup; 10 promoted, 2 reached `test_complete`.** It is the only loop in
this repo with a run history.

**The other two loops have never fired.** `engine/src/fix_loop.rs` is a
well-designed pure decision core with a per-persona cap clamped to 1..=5, a
failure-signature circuit breaker, and a default of **off** — and **0 of 78
personas ever enabled it** (no `fix_loop_enabled` key appears in any persona's
`parameters`, over 21 personas that had parameters at all). `output_assertions`
holds **11 rules, every one `severity: 'critical'` and every one
`on_failure: 'log'`**; `assertion_results` holds **106 evaluations across 72
executions between 2026-05-25 and 2026-06-14, and 106 of 106 passed.** A
critical assertion whose failure action is *log* is not a gate, and one that has
never failed is not evidence that nothing is wrong.

**And nothing here is deterministic in the way the leaf's name implies.** The
determinism is not available on the model side and this repo should stop
pretending otherwise: the Claude CLI exposes no seed, and `--temperature` appears
nowhere in 963 `.rs` files. What *is* available is determinism in the **checker**
and the **bound**, and that is where it must live. Attribution is the part that
is genuinely missing: across 4,727 source files there are **51 occurrences of a
dated build id (4 distinct)** against **156 occurrences of an undated family id
(19 distinct)** plus **299 bare `"sonnet"`/`"opus"`/`"haiku"` string literals**;
and in the backup, **1,184 of 2,188 executions (54.1%) record no `model_used` at
all**, with the rest recording a floating alias. **No recorded verification
verdict in this app is attributable to an exact model build.**

---

## 2. The one way

**Make the model the only non-deterministic part, and make everything around it
reproducible: a mechanical check, a bounded loop, a fail-closed gate, and a
verdict stamped with what produced it.** In order:

**(a) The check is mechanical, and an LLM judge is advisory.** The thing that
decides pass/fail runs a real command, a real query, a real assertion — never a
model. If a model writes prose about the outcome, that prose may be *shown*, and
may be pasted into the fix prompt, but it must not be read by the code that
decides. This repo already gets this exactly right and should not lose it:
`generate_test_summary` (`tool_tests.rs:1033`) is an LLM that writes a
human-readable report, and `evaluate_promote_gate` never reads it — the verdict
comes from `tools_failed` / `tools_unverified` / the `results` array.

**(b) The gate fails closed, and reads its input as a *verdict*, not as
fields.** Three rules in order — **shape** (every field required to decide is
present and of the right type, or hold), **integrity** (the declared counts do
not contradict the listed items, or hold), **verdict**. Never
`.unwrap_or(0) == 0`: a report that cannot be read is not a passing report.
Copy `oneshot.rs:392-513` literally.

**(c) There are four outcomes, not two, and the fourth is the one people
forget.** *Pass*, *Fail*, **Held**, and *Error*. `Held` is "nothing failed and
nothing was proven" — a tool counted but never called, a report that will not
parse, a check that could not run. It must terminate the loop **immediately and
loudly**, not consume the retry budget, because a fix pass cannot chase it:
`oneshot.rs:145-172` refuses to promote and finalises on the *first* hold,
because *"the fix-pass LLM would burn the full retry budget arriving back here."*
Silently promoting on `Held` is how a green pipeline certifies an unrun test.

**(d) The loop is bounded by a named constant with a written reason, and the
bound is a fixed budget — not something the input can enlarge.**
`MAX_TEST_RETRIES: u32 = 3` (`oneshot.rs:57`) and its comment — *"a chattier
intent does not earn extra retries. If a build can't survive three correction
passes, the failure is structural"* — is the shape. Pair it with a
failure-signature breaker (`engine/src/failure_signature.rs`) so an
*identical* failure short-circuits before the count runs out; a bound alone
still pays for three identical attempts.

**(e) Stamp the verdict with what produced it, at the moment it is produced.**
A recorded score is a claim about a model, and a score whose model is unknown is
unfalsifiable six weeks later. Record the **exact build id** (not the family
alias), the effort/thinking level, the fixture-set revision, and the attempt
number, in the same row as the verdict. Then pin: name a dated build in the
constant that reaches `--model`, so a re-run of the same fixtures is comparing
two things and not three.

**(f) Freeze the fixtures and check that the frozen set is still the set.**
Fixtures beside the tests they feed are a third copy, not a check — the doctrine's
`client-rule-mirroring` result applies directly. Version the corpus and assert
its size, the way `brainiac` does at
`crates/brainiac-fixtures/tests/load_v1.rs:16` (`assert_eq!(fx.transcripts.len(), 9)`).

**(g) A golden test that never invokes the thing it is named after is a fixture
test — call it one.** Assertions over a prompt builder are valuable and cheap
and should exist. They must not be filed under a name that makes a reader
believe the model's output was checked.

**Reach for:** `evaluate_promote_gate` (`src/engine/build_session/oneshot.rs:392`)
for the gate; `MAX_TEST_RETRIES` + `run_fix_pass` (`oneshot.rs:57`,
`build_session/fix_pass.rs:60`) for the loop; `FixLoopConfig`
(`src-tauri/engine/src/fix_loop.rs:23`) for the per-entity opt-in;
`engine/src/failure_signature.rs` for the breaker. **The one site to copy is
`oneshot.rs:118-282`** — the whole loop, including the `Held` arm and the
"fix-pass itself failed, stop rather than retry" arm.

---

## 7. Deviations

**D1 — six eval files, 124 assertions, zero model invocations.** Measured per
file: `athena-chat-seed` 13/0, `passport-deploy-dispatch` 22/0,
`passport-wall-dispatch` 29/0, `prompt-injection-defense` 27/0,
`research-synthesis` 24/0, `agent-specs.eval` 9/0 (`expect(` / `await `). The
`prompt-injection-defense` case is the sharpest: it asserts over
`evals/fixtures/prompt-injection/attacks.json` that the *fence* is present in
the assembled prompt — never that a model resisted the attack. Runs at
pre-push (`lefthook.yml:81-82`) via `vitest.evals.config.ts`.

**D2 — 0 of 78 personas enabled the fix loop.** `fix_loop.rs` parses
`fix_loop_enabled` out of the persona `parameters` JSON and defaults to
disabled. `SELECT COUNT(*) FROM personas WHERE parameters LIKE '%fix_loop_enabled%'`
returns **0** in the pre-purge backup (78 personas, 21 with any parameters). The
module is 431 lines, has its own tests, and has never run in production. Its own
header explains the posture — *"the loop is opt-in per persona and OFF by
default"* — which is correct for safety and means the feature's real adoption
signal is not the code but the parameter, and nobody measured the parameter.

**D3 — 11 `critical` assertions whose failure action is `log`.**
`output_assertions`: 11 rows, `severity='critical'`, `enabled=1`,
`on_failure='log'`, all of `assertion_type='not_contains'` — one assertion kind,
no others. `SUM(pass_count)=106`, `SUM(fail_count)=0`.

**D4 — 106 of 106 assertion evaluations passed, over 20 days, and then stopped.**
`assertion_results`: 11 distinct assertions × 72 distinct executions,
2026-05-25 → 2026-06-14, `passed=1` on every row. A gate that has never
produced its failing outcome has never been shown to be able to. **This is not a
claim that the assertions are broken** — 11 `not_contains` rules over clean
output plausibly all pass. It is a claim that nothing in this repo distinguishes
that case from a broken evaluator, which is the same shape as the contract's
*"prove it can fail"* requirement.

**D5 — no verdict is attributable to a model build.** Two implementations of the
model-identifier census disagreed and the disagreement was the finding (§12.3).
Settled: **51 dated-build occurrences** (`claude-haiku-4-5-20251001` 23,
`claude-sonnet-4-20250514` 21, `claude-opus-4-20250514` 6,
`claude-sonnet-4-5-20250514` 1) — all in catalog/pricing tables, none reaching a
spawn — against **156 undated family ids** (`claude-sonnet-4-6` 78,
`claude-opus-4-8` 27, …) and **299 bare `'sonnet'`/`'opus'`/`'haiku'` literals**.
`FIX_PASS_MODEL = "claude-sonnet-4-6"` (`fix_pass.rs:47`) is a floating alias,
and its comment — *"Named so the same string reaches the CLI `--model` flag and
the `dev_llm_spend` ledger row"* — describes internal consistency, which is
exactly the property that says nothing about the outside world.

**D6 — 54.1% of executions record no model.** `persona_executions.model_used`:
NULL on 1,184 of 2,188 rows; `claude-sonnet-4-6` on 852; `claude-opus-4-8[1m]`
on 152. Every non-null value is a floating alias.

**D7 — the tool-test report crosses into the fix prompt with no redactor, and
the value it carries is a live API response body.**
`api_outcome_from_http` (`tool_runner.rs:700`) puts the response body (500 chars)
into the error; `build_failure_summary` (`oneshot.rs:658-701`) copies
`result.error` (400 chars) into the summary; `fix_pass.rs:144-155` sends the
summary to Anthropic. Cross-referenced in
[`tool-result-contract`](./tool-result-contract.md) §7 D8 as the fourth,
previously unmeasured tool-result sink.

**D8 — the fix pass is bounded, but the *hold* path is bounded by a different
policy than the *fail* path, and only one of them is documented.**
`MAX_TEST_RETRIES = 3` governs failures. A `Held` terminates on the first
occurrence, and a fix pass that itself errors terminates immediately
(`oneshot.rs:230-255`). Both are correct; neither has a named constant, so the
three policies are one constant and two inline `return`s.

**D9 — `lab_eval_runs` / `lab_eval_results` are 0 rows.** A second evaluation
apparatus — persona versions × models × scenarios, with its own
`models_tested` column that would have solved D5 — exists in schema and has
never run. `persona_test_runs` and `persona_test_results` are also 0.

**D10 — nothing records the fixture-set revision beside a verdict.**
`evals/fixtures/` is five JSON files under git and there is no assertion that
the count or the content is what a recorded result was measured against.

---

## 9. The gate — DECLINED, with the numbers

**No census rule is proposed, and the decline is the finding.** The obvious
signal is the exact defect `evaluate_promote_gate`'s own docstring names: a
verdict read out of an untyped report and **defaulted to the passing value** when
the field is missing or the wrong type. It does not survive measurement.

**Broad form** — `.and_then(|v| v.as_u64()).unwrap_or(0)` and siblings, scoped to
`src-tauri`, `.rs`: **88 files / 303 matches**, and site-level intersection
against all 191 existing census rules found **zero overlap**, so the rule is
available. It is also unusable: these are ordinary field reads out of JSON
payloads (`dispatcher.rs` 29, `build_session/parser.rs` 25, `connector_use.rs`
20, `mcp_server/tools.rs` 16), and nothing in the syntax says which of them
decides anything.

**Narrowed form** — the defaulted value must immediately participate in a boolean
test (`.unwrap_or(0) == 0`, `> 0`, `!= 0`): **15 files / 22 matches.**
**Hand-verified precision: 1–2 of 20 opened (5–10%).** Of the 20:

- **3 are correct fail-closed defaults** (`core/src/crypto.rs:139,464,479` —
  `std::env::var("PERSONAS_ALLOW_FALLBACK_KEY").unwrap_or_default() == "1"`;
  an absent variable means *not permitted*, which is the safe answer).
- **6 are column reads with a legitimate default**
  (`row.get::<_, i32>("headless").unwrap_or(0) != 0` ×5, `pinned` ×1).
- **2 are read loops** (`read_line(...).unwrap_or(0) > 0`) — a different defect.
- **3 are correct absence semantics** (`counts.get(&sig).copied().unwrap_or(0) >= limit`;
  `confidence.unwrap_or(0.0) < FALLBACK_THRESHOLD`; a JSON number→bool coercion).
- **1 is a doc comment quoting the old broken code** (`oneshot.rs:392`) — caught
  by my bespoke scan and correctly skipped by the census engine's
  `ignoreCommentLines`, which is the two-implementation disagreement earning its
  keep.
- **1 is a genuine fail-open size gate** — `schema_vocabulary.rs:183`,
  `entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES`: if
  `metadata()` errors the file is treated as zero bytes and passes the cap.

**A gate that fires on correct content is worse than no gate.** At 5–10%
precision this would report 20 false alarms per real finding, and three of the
false alarms are *the safest code in the file*.

**The structural reason, which generalises past this leaf:** a safe default and
an unsafe default are **the same bytes**. Whether `unwrap_or(0)` is a bug depends
entirely on what zero *means* downstream — "no occurrences yet" (safe), "not
permitted" (safe), "nothing failed" (catastrophic). This is the doctrine's
*"a check cannot distinguish an absence from a deliberate identity"* in a new
costume: there, an unchanged translation and an intentional do-not-translate term
are identical; here, a defensive default and a fail-open verdict are identical.
**If your instrument's negative case is "a default was supplied", say what else
supplying a default looks like.**

**Prefer the type, and this one is cheap.** The fix is already written in this
repo: `evaluate_promote_gate`'s `read_count` closure returns
`Result<u64, String>` and every caller must handle the error arm. Generalise it —
a `fn verdict_field(report: &Value, name: &str) -> Result<u64, HoldReason>` in
one place, with `unwrap_or` unspellable on a verdict path — and the condition
becomes a compile error rather than a count. Per the contract, **a declined rule
with a good reason is a better §9 than a weak rule**, and per the doctrine the
right instrument for the residue is an inventory (*which decisions in this tree
are verdicts?*), not a ratchet.

**Also declined, for a different reason: a gate on the eval lane.** *"An
`evals/**/*.golden.test.ts` that never invokes a model"* is a real condition with
a 6-file population and 100% precision today — and it is an **absence** assertion
over a set of six files, which the census cannot express and which a
`--max-warnings`-style threshold would trivially game by adding a seventh
prompt-assembly test. The right instrument is a one-line assertion inside
`vitest.evals.config.ts`'s own suite: *at least one file under `evals/` awaits a
model call*, failing loudly when the count is zero. That is a fix, and it changes
what a pre-push hook does, so it is specified here rather than applied.

### Deferred fixes registered

None new. D3 (`critical` + `on_failure: 'log'`) and D2 (`fix_loop` at 0/78
adoption) are configuration the operator may have chosen deliberately, and D1's
fix changes what `git push` does — all three fall on the "note, don't apply" side
of the standing rules.

---

## 12. Corrections

**12.1 — `sides: "server"` is UPHELD, and the mechanism is worth naming.** Every
part of this leaf that decides anything is server-side Rust: the gate, the loop,
the bound, the breaker, the fixture corpus. The reason is structural and matches
the two `client` upholdings' logic in reverse — **the client never sees the
run.** A verification loop's whole value is that it happens without a human
watching, so a browser-side half would defeat it. The frontend's only
contribution is rendering `BUILD_TEST_TOOL_RESULT` progress events. Ledger:
`server` now **2 upheld, 0 contradicted**.

**12.2 — `convergence: "converged"` FAILS, and it fails in the most useful of the
recorded modes: the fleet agrees on the *principles* and Personas is behind on
one of the three.** Cohort measured at composition: `personas-cloud` is a port
with no grader, no fix loop, no golden fixtures and no pinned model
(`validation.ts` is env-var sandboxing, not output verification);
`personas-web` has no LLM path at all. **Effective independent cohort: 3.**

Three clauses, tested against `brainiac`, `ascent` and `vibeman`:

| clause | brainiac | ascent | vibeman | Personas |
|---|---|---|---|---|
| the grader is mechanical; an LLM judge is advisory | **yes**, explicitly — `faithfulness.rs:9` *"never a gate — a judge that could block…"* | mixed (60% LLM judge / 40% mechanical MAE) | yes (build errors) | **yes** — `evaluate_promote_gate` never reads the LLM summary |
| the loop is bounded | **yes** — `MAX_REPAIR_ATTEMPTS = 2`, dead-letter at 5 | shallow (one retry, then a mock floor) | **no bound on any fix loop** | **yes** — `MAX_TEST_RETRIES = 3` + a signature breaker |
| the verdict records which model produced it | **yes** — `model_ref` on every verdict, and the extraction cache keys on it | **yes** — `provider`, `model`, `degraded`, `coverage` per record | no | **no** |

So it is not one verdict. **A single enum field cannot carry a verdict that
splits by clause** — the exact failure mode the doctrine records for
`cross-device-pairing`, reproduced here on a different leaf. Clause 1 is 3/3
plus us: physics. Clause 2 is 2/3 plus us, with the one dissenter being our own
ancestor. Clause 3 is 2/3 and **we are the ones missing it**, which is the
finding worth acting on. **Ledger: 15 tested, 15 failed.**

Two details worth carrying forward. `brainiac`'s judge-is-advisory line is the
strongest single sentence any repo in this fleet has written about verification,
and it was reached independently — its redaction and its gating share no prose,
constants or error strings with ours. And `ascent` sets `temperature: 0`
(`bedrock.ts:228`) — the only repo in the cohort that reaches for model-side
determinism at all, and it can only do so because it calls an API rather than a
CLI. **Personas cannot adopt that clause**: the Claude Code CLI is the execution
substrate and exposes no temperature or seed, which is why §2 puts all of the
determinism in the checker and the bound. That is a constraint, not a choice,
and it should be stated rather than left as an apparent gap.

**12.3 — my own two implementations of the model-id census disagreed 0 vs 50, and
the disagreement was mine.** The first pass matched dated builds with
`claude-[a-z0-9.]+-\d{8}` and returned **0**, which is a striking and completely
false headline ("nothing in this repo pins a model"). The character class omits
`-`, so `claude-haiku-4-5-20251001` never matched. The second pass, which
enumerated model ids generally and *then* partitioned on a trailing date,
returned 51. **A regex that returns zero should be assumed broken before it is
believed** — it is exactly the `check-csp-hosts.mjs` failure the doctrine
records, in a scratch script where no exit-2 guard was watching.

**12.4 — the brief's framing was right and its emphasis was off by one.** It
asked which of "fixed seeds, pinned models, frozen fixtures, a stable grader"
this repo holds. Measured: seeds are **unavailable** (not missing — the CLI has
no such knob, so listing it invites a fix that cannot be written); models are
**unpinned**; fixtures are **frozen but unversioned**; the grader is **stable and
genuinely good**. The item the brief did not list is the one that turned out to
matter most: **the fourth outcome**. `Held` — "nothing failed and nothing was
proven" — is what separates `oneshot.rs` from every other loop in the fleet, and
no other repo in the cohort has it.

**12.5 — a claim I expected to make and could not.** I went looking for the
`generate_test_summary` LLM output leaking into the pass/fail decision, because
an LLM-written verdict is the classic form of this defect. It does not: the
summary is appended to the *failure message* (`oneshot.rs:727-731`, under a
`### LLM-summarized verdict` heading) and the gate reads only numbers and
statuses. **The repo already separates the judge from the referee**, and the
heading's word "verdict" is the only misleading thing about it.

**12.6 — the register entry #24 lesson applies to my own headline and I split
it.** "The eval lane never calls a model **and** the assertions never fail" reads
as one finding; it is two, with two sources (`await` counts in six files;
`assertion_results.passed`), and D1 and D4 are stated separately so either can be
falsified on its own.
