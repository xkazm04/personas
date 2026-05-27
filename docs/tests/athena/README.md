# Athena Quality Suite

A regression suite that exercises every Athena chat capability shipped on
`master` and grades each turn on two axes:

1. **Did Athena take the right action?** — programmatic assertions on the
   op stream, dispatcher output, recall preview, turn summary, chat-cards,
   approval list, and background jobs. Deterministic, no model in the loop.
2. **Was Athena's answer actually useful?** — graded by **Claude Code
   itself** (CLI session, not an SDK call) reading a per-turn bundle and
   writing a verdict JSON against the scenario's rubric. Catches the
   "sounds plausible but wrong / vague / leaks the wrong source" class of
   regressions hard assertions can't see.

The suite runs in two passes so each pass owns one job cleanly:

- **Pass 1** — the Python runner drives every fixture through a real Athena
  chat session, captures per-turn state, runs the hard assertions, writes
  bundle markdown files.
- **Pass 2** — Claude Code reads each bundle, applies the
  [judge playbook](judge-playbook.md), writes a verdict JSON. The runner's
  `--aggregate` mode then merges hard assertions + verdicts into the final
  report.

No `ANTHROPIC_API_KEY`, no `anthropic` Python package — the judge is
whichever Claude Code session is open when pass 2 runs. That session has
full access to the recall preview, the codebase, the doctrine corpus, and
any prior session memory, which is strictly more context than a stateless
API call would have.

The suite is designed to be re-run on demand — every time the model behind
Athena changes, every time her prompt or doctrine corpus moves, every time
a new capability ships. A green run is the contract that the chat quality
is at-or-above the last green run.

---

## Why this exists

The capability surface in
[`docs/features/companion/athena-usecases.md`](../../features/companion/athena-usecases.md)
grew faster than the prompt that drives it. Concretely:

- The constitution went **v7 → v18** while shipping 13 design-family ops,
  4 connector handlers, 7 fleet ops, 3 background-job kinds, 11 proactive
  trigger kinds, and 4 MCP tools.
- Each addition was tested in isolation. Nobody re-ran every prior scenario
  after each ship — so subtle decision-making regressions slipped in
  (e.g. "scan repo for bugs" answered with `build_oneshot` instead of
  `enqueue_dev_job`, design-family ops chosen out-of-order, doctrine quotes
  drifting from the allowlist).
- Manual chat testing scales linearly with capabilities; the constitution is
  past the point where one person can hold the full matrix in their head.

This suite is the contract that fixes that drift early. Run it after any
non-trivial Athena change. If a scenario fails, fix the **prompt, tool
definition, dispatcher rule, or doctrine doc** — not the test — until it
passes again.

---

## Suite layout

```
docs/tests/athena/
  README.md                       ← you are here
  quality-rubric.md               ← axis definitions ("useful" / "grounded" / ...)
  judge-playbook.md               ← contract Claude follows in pass 2
  scenarios/                      ← human-readable scenario specs
    scan-vs-build.md
    template-vs-build.md
    design-family-cards.md
    build-oneshot-vs-interactive.md
    memory-doctrine-grounding.md
  fixtures/                       ← machine-readable scenario JSONs
    scan-vs-build.json
    template-vs-build.json
    design-family.json
    build-oneshot-vs-interactive.json
    memory-doctrine.json
  results/<stamp>/                ← run output (gitignored, per-run dir)
    manifest.json                 ← phase tracking + scenario index
    bundles/<scenario>/           ← what Claude reads in pass 2
      scenario.json
      t<n>-<turn_id>.md
    verdicts/<scenario>/          ← what Claude writes in pass 2
      t<n>-<turn_id>.json
    report.json                   ← final aggregate (after pass 2)
    report.md                     ← optional markdown summary

tools/test-mcp/
  athena_quality_suite.py         ← runner (pass 1 + pass 2 aggregator)
```

Scenario files (`scenarios/*.md`) describe **what** is being tested and
**why** — they are the human-readable contract. Fixture files
(`fixtures/*.json`) carry the same scenarios in a structure the runner
consumes (turns, hard assertions, judge rubric). When you change behavior,
update both.

---

## What's covered in the first pass

This pass focuses on the two slices flagged as highest-quality risk:

| Slice | Why it's first |
|---|---|
| **Conversational decision-making** — scan vs build, route to template, design-family card ordering, build_oneshot vs interactive | Most-trafficked path; subtle regressions hide in "Athena picked the right op for this user intent" |
| **Memory & doctrine grounding** — citations match recall preview, no hallucinated quotes, doctrine sourced only from allowlisted docs | Foundational. If Athena cites a memory she didn't consult, every downstream slice degrades |

Deliberately deferred to a follow-up:

- **Connector grounding** — Sentry / GitHub / Slack / Gmail call quality
  (right pinned connector picked, results actually used in reply). Needs
  test credentials wired in CI; tracked at
  [`docs/plans/athena-async-ux.md`](../../plans/athena-async-ux.md).
- **Approval discipline** — fleet ops, memory writes, persona run. Each
  needs a way to gate side-effects in test mode (auto-approve / auto-reject
  flag) that doesn't yet exist on the bridge.
- **Voice / TTS** — out of scope: orthogonal to chat decision quality.
- **Stubs** — see `athena-usecases.md` §J.

---

## How a scenario is structured

Every scenario has the same shape:

```
1. Setup — preconditions the harness applies before turn 1
   (e.g. pinned connectors, plugins enabled, identity content,
   seeded facts).
2. Turns — ordered list of user messages. Each turn captures:
   - The chat reply text
   - The recall preview event for that turn
   - The turn summary (ops, approvals, cards, navigations)
   - Background jobs queued during the turn
3. Hard assertions — deterministic checks against the captured turn
   state (e.g. "turn 1 emitted exactly one card of kind
   template_suggestions").
4. Judge rubric — natural-language criteria the LLM judge scores the
   reply against:
   - useful  — does the reply move the user forward on their stated intent?
   - grounded — every factual claim traces to a memory the recall
     preview actually consulted, or to a connector result, or to
     doctrine. No training-data drift.
   - right_data_source — when the user asked about X, did Athena pull
     from the surface that owns X? (e.g. "what projects are you
     tracking?" should query dev_projects, not list pinned connectors)
   - no_hallucinated_capabilities — Athena did not claim a capability
     that the dispatcher would reject.
5. Anti-patterns — explicit failure modes the judge is told to flag.
```

The runner emits one verdict per scenario:

```
PASS    — all hard assertions passed AND judge returned ok on every axis
WARN    — hard assertions passed BUT judge flagged at least one axis
FAIL    — at least one hard assertion failed
```

A WARN is not a hard fail — sometimes the model picked a different but
equally-reasonable phrasing. Maintainers triage WARNs by re-reading the
captured reply against the rubric and either tightening the rubric (false
positive) or fixing the prompt (true positive).

---

## Running the suite

### Prerequisites

1. Dev app running with test-automation feature:

   ```bash
   npm run tauri:dev:test
   ```

   Confirms the HTTP server on `localhost:17320` is up:

   ```bash
   curl http://127.0.0.1:17320/health
   ```

2. **Companion plugin enabled** in Settings → Plugins. The companion
   panel is opened programmatically by the harness via `openCompanion`,
   so the user does not need to expand it manually.

3. **No active Claude CLI session in the chat.** The harness sends real
   messages; mid-session state from a previous chat will pollute the recall
   strip. Call `companion_reset_conversation` (the harness does this in
   `setup`) before the first turn.

4. A Claude Code CLI session ready to act as the judge in pass 2. If you
   are reading this from a Claude Code session, that's you.

### Pass 1 — drive turns + capture

```bash
# All scenarios
uvx --with httpx python tools/test-mcp/athena_quality_suite.py

# One slice
uvx --with httpx python tools/test-mcp/athena_quality_suite.py --filter scan-vs-build
```

Output lands at `docs/tests/athena/results/<YYYY-MM-DD-HHMM>/`. Pass 1
exits `0` if every hard assertion passed, `1` if any failed, `3` on
preflight error.

### Pass 2 — judge (Claude Code reads each bundle)

For every `bundles/<scenario_id>/t<n>-<turn_id>.md` in the run dir,
Claude Code follows [`judge-playbook.md`](judge-playbook.md) and writes a
verdict JSON to the sibling path
`verdicts/<scenario_id>/t<n>-<turn_id>.json`. The playbook has the
schema, axis semantics, anti-patterns checklist, and the walkthrough for
judging one turn.

A practical heuristic: judge scenario-by-scenario rather than
turn-by-turn. Read every turn in a scenario before scoring any of them —
turn 2 often relies on context from turn 1.

### Pass 2 — aggregate

```bash
python tools/test-mcp/athena_quality_suite.py \
    --aggregate docs/tests/athena/results/<stamp> --markdown
```

This reads every verdict JSON, rolls up per-scenario + overall status,
and writes:

```
docs/tests/athena/results/<stamp>/
  report.json   ← machine-readable
  report.md     ← human-readable
```

Use `--partial` if you want to aggregate before every verdict file
exists; ungraded turns roll up as `ungraded` (the overall is then also
`ungraded` rather than `pass`).

### Per-turn cost

Each turn = one real Athena chat round-trip (Claude CLI process), so a
6-turn scenario takes ~60-120s and burns Claude API credits at whatever
Athena's tier is configured to. Pre-flighting against `--filter` for
just the slice you changed is the fast inner loop.

---

## The fix loop when a scenario fails

When the suite goes red, the fix is **never** in the test — it's in the
artifact under test. Find the failing layer first:

| Symptom | Likely root cause | Fix lives in |
|---|---|---|
| Hard assertion: wrong op kind emitted (e.g. expected `enqueue_dev_job`, got `build_oneshot`) | Constitution allows the wrong path; prompt nudges toward it | `src-tauri/src/companion/templates/constitution.md` + `prompt.rs::compose` |
| Hard assertion: dispatcher rejected a valid op | Dispatcher allowlist drifted; new op needs registration | `src-tauri/src/companion/dispatcher.rs::ALLOWED_ACTIONS` |
| Hard assertion: chat card emitted with wrong kind | Athena confused two design-family ops; prompt vocabulary unclear | constitution.md + design-family doctrine in `docs/concepts/persona-design-best-practices.md` |
| Hard assertion: recall preview empty when memory expected | Doctrine doc moved without updating `doctrine.rs::include_str!` arms | `src-tauri/src/companion/brain/doctrine.rs` (see memory `project_doctrine_include_str`) |
| Judge: `grounded=false` with quote that doesn't match any consulted memory | Athena pulled from training data instead of doctrine; prompt's "cite or stay silent" rule not strong enough | `prompt.rs::doctrine_addendum` + the persona-design best-practices guide |
| Judge: `useful=false` despite right op | Op was correct but supporting prose was generic / didn't reference user's intent | usually a chat-card config issue (missing `intent` line) or `prompt.rs::reply_shaping_addendum` |
| Judge: `right_data_source=false` (asked about projects, got pinned connectors) | Athena confused two related surfaces; prompt's surface-map needs a clarifying line | `prompt.rs::sources_addendum` + `athena-usecases.md` table |

After fixing, re-run the failing scenario in isolation:

```bash
python tools/test-mcp/athena_quality_suite.py --filter <slice> --markdown
```

When that scenario is green, re-run the full suite once to confirm no
regression elsewhere.

---

## When to extend the suite

Add a scenario when:

- A new constitution op ships (any v-bump in `dispatcher.rs::ALLOWED_ACTIONS`).
- A new doctrine doc is added to `doctrine.rs::DOCTRINE_DOCS`.
- A new chat-card kind ships.
- A new background-job kind ships.
- A user-reported quality bug is closed.

The new scenario lives in `scenarios/<slug>.md` + `fixtures/<slug>.json`.
Mirror an existing pair as the template — the JSON shape is documented at
the top of [`fixtures/scan-vs-build.json`](fixtures/scan-vs-build.json) and
in [`docs/tests/athena/quality-rubric.md`](quality-rubric.md#fixture-schema).

Do **not** extend the suite by adding more turns to an existing scenario
unless the new turns test the same decision-making slice. Each scenario
should have one purpose stated in its first paragraph.

---

## Known limitations

- **Judge is non-deterministic across sessions.** Same bundle, judged
  by Claude Code today vs next week, may produce different verdicts on
  borderline cases. The playbook's "decision rubric" + per-axis notes
  exist to make borderline calls auditable; re-judging a WARN on a
  fresh session before treating it as a regression is the
  reproducibility path.
- **No two-instance isolation.** The suite hits the dev app on `:17320`.
  Don't run it concurrently with a manual chat session — both will mutate
  the same companion DB. See
  [`docs/tests/parallel-cli-workflow.md`](../parallel-cli-workflow.md).
- **Background jobs may not have completed by turn capture.** The harness
  records whichever state jobs were in at turn-finish. A `running`
  `scan_codebase` is correct queueing, not a broken scan — the judge
  knows not to penalize on this.
- **Approval-gated actions** are auto-rejected by the harness today, so
  scenarios that depend on the post-approve side-effect (e.g.
  `register_project` actually creating the dev_projects row) are out of
  scope. Tracked in `docs/plans/athena-async-ux.md`.

---

## See also

- [`docs/features/companion/athena-usecases.md`](../../features/companion/athena-usecases.md) — the capability inventory this suite mirrors
- [`docs/features/companion/README.md`](../../features/companion/README.md) — Athena architecture
- [`docs/development/test-automation.md`](../../development/test-automation.md) — the HTTP bridge the harness drives
- [`docs/tests/coverage-strategy.md`](../coverage-strategy.md) — where this suite sits in the broader test pyramid
