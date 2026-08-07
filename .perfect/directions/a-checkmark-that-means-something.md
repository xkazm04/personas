---
slug: a-checkmark-that-means-something
type: perfect/direction
context: "[[engine-build-session]]"
lens: robustness
status: shipped
size: M
proposed: 2026-08-07
accepted: 2026-08-07
shipped: 2026-08-07
commit: b093127a9, 5f9431bd1, a13c922f0, 510aa7a7a
---
## What & why

A build can be promoted to `active` — armed with a schedule trigger and a public webhook,
executing against the user's real credentials — **without a single connector call ever having
been made**. Four separate paths produce `tools_failed: 0` without executing anything, and the
predicate that reads that number fails open on a malformed report.

The codebase already named this exact failure, in `tool_tests.rs:521-525`:

> *"a trust-destroying false green (UAT 2026-07-20: 'a checkmark that means nothing is worse
> than no checkmark')."*

## Evidence

**The promote predicate fails open** — `oneshot.rs:411-422`:
```rust
let tools_failed = report.get("tools_failed").and_then(|v| v.as_u64()).unwrap_or(0);
if tools_failed == 0 { Ok(TestPassOutcome::Passed) }
```
Missing key, `null`, a string `"2"`, or a float → `0` → promote. No schema check on `report`.

**Four ways to reach `tools_failed: 0` with nothing executed** (`tool_tests.rs`):
| path | line | mechanism |
|---|---|---|
| empty `curl` → `skipped` | `:541-555` | `skipped` is counted and then ignored by the gate |
| `cli_native: true` | `:493-496`, `:520-529` | LLM-authored boolean; counted `passed` with no call |
| no parseable plan | `:322-460` | falls back to fuzzy substring match on vault credential names (`:413-421`), stamps `"Credential available — connector verified"` (`:431`) |
| zero tools | `:80-89` | unconditional `tools_failed: 0` |

**The structural part.** `runner.rs:246-251` switches `gates.rs` **off** in `one_shot` — the
autonomous mode that promotes — on the stated grounds that *"the test phase will surface real
failures"*. Bypasses at `:983`, `:1087-1102`, `:1572-1580`. `gates.rs` is the one well-tested
file here (44 tests). The test phase it delegates to is `tool_tests.rs`: 1,051 LOC, **zero
tests**, the four fail-open paths above.

**Coverage on the promote path:** `runner.rs` 1779 + `tool_tests.rs` 1051 + `parser.rs` 801 +
`oneshot.rs` 704 = **4,335 LOC, zero tests**. (`oneshot.rs` — which holds the actual promote
predicate — was not even in the triage claim.)

**Blast radius, verified.** `promote_build_draft_inner` sets the persona `active`
(`build_sessions.rs:2134`), computes `next_trigger_at` and arms the scheduler, auto-creates
webhook ingress and secrets, and creates tools + subscriptions — all in one transaction. A
falsely-promoted persona **fires autonomously** against credentials resolved by
`resolve_credential_env_vars` (`tool_tests.rs:100`).

## The decision — what counts as a pass

Settled with the user 2026-08-07, after a polarity check:

| path | verdict | why |
|---|---|---|
| zero tools | **PASS** | Nothing to exercise. Genuinely defensible. |
| empty `curl` → skipped | **PASS** | The prompt explicitly invites *"non-testable → emit an entry with empty curl"* (`:919-920`). Keep it non-blocking. |
| `cli_native: true` | **FAIL — no longer a pass** | An LLM-authored boolean is not evidence. The code itself calls this *"a gate-affecting decision left to a follow-up"*. This is that follow-up. |
| no plan → credential substring | **FAIL — no longer a pass** | The only path that calls something *verified* when nothing ran. A vault row sharing a substring with a connector name is not a test. |

`one_shot` keeps gates off — the original design intent (autonomous mode should not need an
interview round-trip) stands. **The fix is to make the delegation true**: harden the test phase
so it actually catches what the gates would have.

## Acceptance criteria

- [ ] A missing, null, non-integer or otherwise malformed `tools_failed` **holds**, with a
      distinct reason — it must never read as pass.
- [ ] `cli_native: true` no longer counts toward `passed`. It is reported as unverified, and
      unverified entries hold promotion.
- [ ] The no-parseable-plan fallback stops counting as a pass **and stops using the word
      "verified"** for something that never ran.
- [ ] Zero-tool personas still pass — explicit carve-out, with a test naming it as intentional.
- [ ] Empty-`curl` entries still count as `skipped` and still do not block — tested.
- [ ] `parser.rs` no longer silently drops multi-line JSON. `extract_test_plan`
      (`tool_tests.rs:968`) already parses multi-line; `parser.rs:156-167` is line-oriented and
      is the weaker of the two. Unparseable input must be surfaced, not returned as `vec![]`.
- [ ] Characterization tests on the promote path. `oneshot.rs`'s predicate and
      `tool_tests.rs`'s counting are the priority — they decide promotion and have no tests at all.

## Risks / non-goals

**This will stop some builds that currently promote.** That is the point, but it must fail
*loudly* — a hold needs a reason the user can act on, not a silent non-promotion.

Not in scope, deliberately:
- `DraftReady → Promoted` is a legal transition (`build_session.rs:83`) and the UI force-promote
  (`useLifecycle.ts:216-218`) is a documented escape hatch. Both bypass testing by design.
  **Flag them in the build record; do not remove them** — removing an escape hatch is a
  deletion, which needs the user.
- Re-enabling gates in `one_shot`. Decided against; see above.
- The `PERSONAS_SCRIPTED_TOOL_TESTS=1` alternate verdict source (`tool_tests.rs:222-224`),
  whose own note admits it is unverified on Windows. Record it, don't fix it here.

## Build record

**Shipped** `b093127a9` (gate) · `5f9431bd1` (parser) · `a13c922f0` (frontend + i18n) ·
`c2f390804`, `a395155e7` (docs/label) · `510aa7a7a` (builtin allow-list follow-up).
Director verdict: **merge**, after one follow-up. `build_session` tests **96 → 149**.

### The four decision-table rows, each pinned

Driven from the real producers in `tool_tests` through `evaluate_promote_gate`:

| row | test | outcome |
|---|---|---|
| zero tools | `zero_tool_persona_still_promotes` | passes, intentional |
| empty curl | `empty_curl_entry_is_skipped_and_still_promotes` | passes, intentional |
| `cli_native` | `cli_native_claim_holds_promotion` | **holds** |
| no plan → credential substring | `no_plan_credential_substring_holds_promotion` | **holds** |

Plus 12 fail-open shapes (missing / null / stringly-typed / float / negative `tools_failed`,
non-object report) and `real_failures_are_failed_not_held_so_the_fix_pass_still_runs`, which
pins that a genuine failure keeps its self-repair loop while a hold skips it — neither a
malformed report nor "we never called it" is fixed by rewriting `agent_ir`.

### What a held build now says

One notification-sized line (tested ≤280 chars, no newlines), naming up to 4 subjects:

> *"Promotion held: 2 tool(s) were reported as available but never actually called
> (web_search, gmail). Nothing was executed against them, so this build was not verified and
> was not promoted automatically."*

Rides the existing `finalize_failed` channel: session `error_message`, OS notification,
companion-chat episode, and a `Progress` event for the live Glyph view.

### Three things this note got wrong

1. **Row 3 was too literal.** `:520-529` is `if is_cli_native || is_builtin_platform` — two
   paths, not one. `is_builtin_platform` is a **code-authored** allow-list (no external
   service, no credential); `cli_native` is an LLM-authored boolean assertable about anything.
   Implementing the sentence would have held every persona using `personas_database`. The
   builder split the branch and implemented the *principle*: **the line is who authored the
   claim, not whether a call happened.**
2. **A fifth hole neither of us named.** `connector.starts_with("personas_")` let a model
   invent `personas_gmail` and mint itself an auto-pass — the same defect spelled differently,
   and the obvious reroute once `cli_native` closed. Now an exact allow-list, pinned by
   `a_model_invented_personas_connector_cannot_mint_itself_a_pass`.
3. **The frontend was not optional.** `useLifecycle.ts:150` computes `allPassed` independently
   of the backend, and `TestReportModal`'s status chains have no default branch — the new
   `unverified` state would have rendered as *"Failed — Could not connect to the service"* and
   vanished from `ResultCards` entirely. **Backend-only would have replaced a false green with
   a false red.**

### The follow-up, and why

`web_search`/`web_fetch` initially held, because they are `cli_native` and were not on the
allow-list. Added in `510aa7a7a` — the consistent application of the principle above, not a
widening of it: the list is code, a model cannot add to it, and there is genuinely nothing
behind those two names for a curl to exercise. Holding the canonical case the prompt itself
names (`tool_tests.rs:914`) is the exact mirror of the false green, and a gate that holds
honest builds gets muted.

Two tests name it as deliberate and each asserts the other half, so the allow-list cannot drift
into an amnesty: the same `cli_native: true` on `web_scrape_pro` still holds. Two decision-table
tests were re-based off `web_search` onto `gmail` — they had used it as their non-builtin
example and would have quietly inverted.

### Correction to a scout claim, for the record

`POST /api/build/{id}/promote` is **not** unauthenticated. It sits inside
`.layer(require_api_key)` and `authorize()` requires the `personas:build` scope for every
`/api/build` path (`management_api.rs:341-346`), with CORS restricted to the app's own
webview/loopback origins rather than `Any`. The accurate statement is: **three of four
`promote_build_draft_inner` call sites are ungated with respect to *testing*; all four are
authenticated.** Recorded so a future session doesn't chase a phantom hole.

### Flagged, not touched

`DraftReady → Promoted` and the UI force-promote remain — documented escape hatches, and
removing one is a deletion (needs the user). `PERSONAS_SCRIPTED_TOOL_TESTS=1` recorded; its two
report shapes gained `tools_unverified: 0` so the new gate doesn't hold on it. One residual
asymmetry noted in-code: in the no-plan fallback `web_search`/`http_request` still auto-pass as
infrastructure conduits, reachable only when the model returns nothing parseable *and* the
persona has no external connectors.
