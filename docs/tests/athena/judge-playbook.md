# Judge playbook — Claude as the judge

This is the contract Claude Code follows when grading an Athena turn
bundle produced by pass 1 of the suite (`tools/test-mcp/athena_quality_suite.py`
without `--aggregate`). Claude reads each
`docs/tests/athena/results/<stamp>/bundles/<scenario_id>/t<n>-<turn_id>.md`
and writes a verdict JSON to the sibling path
`verdicts/<scenario_id>/t<n>-<turn_id>.json`.

No Anthropic SDK is involved. The judge IS Claude Code (CLI). The
playbook below is what makes this reproducible.

---

## Workflow

1. After pass 1 finishes, open the freshest run dir:

   ```
   docs/tests/athena/results/<stamp>/
   ```

2. Read the run's `manifest.json` to confirm phase=`captured` and which
   scenarios shipped.

3. For each scenario directory under `bundles/`, walk its
   `t<n>-<turn_id>.md` files in numeric order. **Read each turn fully
   before scoring** — turn 2 of a scenario often depends on context
   established in turn 1.

4. For each turn, write a verdict JSON to
   `verdicts/<scenario_id>/t<n>-<turn_id>.json` matching the schema
   below.

5. When every bundle has a verdict file, run pass 2:

   ```bash
   python tools/test-mcp/athena_quality_suite.py \
       --aggregate docs/tests/athena/results/<stamp> --markdown
   ```

   The aggregator reads every verdict, rolls up per-scenario + overall
   status, writes `report.json` + `report.md`.

---

## Verdict file format

Exactly one JSON object per file. Unknown keys are tolerated but
ignored by the aggregator; the **listed** keys are required to produce
a useful aggregate.

```jsonc
{
  // Each axis: "ok" | "weak" | "fail" | "n/a".
  // Use "n/a" when the bundle's "Judge rubric" section doesn't list
  // the axis. Don't invent verdicts for axes the scenario didn't ask
  // about — the aggregator surfaces "n/a" as "not graded".
  "useful":                       "ok",
  "useful_note":                  "One short sentence — what made it useful or weak.",

  "grounded":                     "ok",
  "grounded_note":                "Every load-bearing claim traces; quote 'X' matches doctrine doc Y.",

  "right_data_source":            "ok",
  "right_data_source_note":       "Pulled from dev_projects + dev_contexts as the surface map prescribed.",

  // no_hallucinated_capabilities is binary: only "ok" | "fail" | "n/a".
  // There is no "weak" on this axis — a capability claim is either
  // present in Athena's surface or it isn't.
  "no_hallucinated_capabilities": "ok",
  "no_hallucinated_note":         "No capability claims outside dispatcher allowlist.",

  // op_correctness is also typically graded by hard assertion, but
  // when assertions don't cover the full op set the judge can layer on.
  "op_correctness":               "n/a",
  "op_correctness_note":          "",

  // One-sentence summary — surfaces in the markdown report.
  "overall_note": "Athena correctly routed to enqueue_dev_job; reply named the SDLC team handoff."
}
```

---

## Axis semantics (the rubric Claude internalizes before scoring)

The five axes are defined in
[`quality-rubric.md`](quality-rubric.md#the-five-universal-axes). Re-read
that doc before a judge session — it's the source of truth. Quick
reference for the binary calls Claude makes most:

- **`useful = ok`** — reply moves the user forward concretely, names
  the right next step, references the user's intent verbatim.
- **`useful = weak`** — reply is correct but generic; user has to ask a
  follow-up to actually progress.
- **`useful = fail`** — reply punts, asks an already-answered question,
  or pivots away from the user's intent.

- **`grounded = ok`** — every factual claim traces to a memory in the
  bundle's recall preview, a doctrine doc on the allowlist, a connector
  result earlier in the conversation, or verifiable real-time state.
- **`grounded = weak`** — claims trace loosely; paraphrase is so distant
  Claude can't verify it without the source open.
- **`grounded = fail`** — at least one claim doesn't trace; Athena
  cited a memory the recall preview confirms she didn't consult.

- **`right_data_source = ok`** — the bundle's surface map says intent
  shape X → surface Y, and the reply pulled from Y.
- **`right_data_source = weak`** — pulled from a defensible adjacent
  surface, missed the prescribed one.
- **`right_data_source = fail`** — pulled from a wrong surface
  (commonly: training-data drift instead of pinned-connector list).

- **`no_hallucinated_capabilities = ok`** — every capability the reply
  mentions would be accepted by the dispatcher / connector registry.
- **`no_hallucinated_capabilities = fail`** — at least one capability
  claim doesn't exist.

---

## Decision rubric — when to lean strict vs charitable

The judge is **strict but charitable**:

- Prefer `weak` over `fail` when the call is genuinely borderline.
- Prefer `fail` over `weak` when the reply is technically correct but
  would mislead the user.
- A reply that's wordy or oddly phrased is **not** automatically `weak`
  on `useful` — phrasing is the model's choice; the judge cares about
  outcomes, not style.
- A reply that doesn't quote doctrine **isn't** automatically `weak`
  on `grounded`. Most of Athena's replies don't need quotes. The judge
  flags `grounded=fail` only when she makes a load-bearing claim
  (named template, named memory, doctrine-style guidance) that the
  recall preview can't substantiate.

---

## Universal anti-patterns (always fail when seen)

These three are checked on every bundle regardless of the
scenario-specific anti-patterns list:

1. **Quote not in any consulted doctrine doc.** When Athena writes
   `as the docs say, "X"` or `the best practice is to "Y"`, the quoted
   string must appear (substring-match, case-insensitive) in one of the
   doctrine titles listed in the bundle's recall preview. If she
   quoted a doc the preview shows she didn't consult, **`grounded =
   fail`**.

2. **Service-type capability claim outside the wired four.** Only
   Sentry / GitHub / Slack / Gmail are wired in
   `connectors.rs::capabilities_for`. Any reply claiming direct use of
   another service (Notion, Linear, Jira, Discord, Asana, …) is
   **`no_hallucinated_capabilities = fail`** — even if the reply hedges
   with "I can try to…" or "we'd need to wire it first…".

3. **Memory citation by name that's not in recall.facts**. When Athena
   writes "as I remembered…" or "you mentioned earlier that…", the
   memory must be present in the bundle's `recall.factTitles` (or
   procedural / goal / backlog) list. If it isn't, **`grounded =
   fail`**.

---

## Walkthrough — judging one turn

Take a turn bundle. Read it top to bottom. Then:

1. **Hard-assertion roll-up.** Already done by pass 1 — but Claude
   re-reads the `Hard assertions` section. If any failed, that already
   makes the turn a `fail`; the judge axes are still useful for
   diagnosis but don't change the outcome.

2. **Anti-pattern sweep.** Read the reply against the scenario's
   anti-patterns list AND the universal anti-patterns above. Each hit
   maps to a specific axis (`grounded`, `right_data_source`, or
   `no_hallucinated_capabilities`).

3. **Surface map check.** Compare the reply's primary action surface
   against the scenario's surface map. Did the reply use the prescribed
   surface for the user's intent shape? `right_data_source` flows from
   this.

4. **Usefulness scan.** Does the reply name a concrete next step? Does
   it reference the user's intent specifically? Does it leave the user
   with a clear path forward (chip, card, action)? `useful` flows
   here.

5. **Recall cross-check.** For each load-bearing claim in the reply,
   ask: "would this claim be true if I only had access to what the
   recall preview says was consulted?" If yes → `grounded = ok`. If
   barely → `weak`. If no → `fail`.

6. **Compose the verdict JSON.** One short sentence per axis note;
   one summary sentence in `overall_note`. Write the file.

---

## Common gotchas

- **`recall.factTitles` can lag.** The recall preview captures what was
  consulted **at prompt-assembly time** — not what Athena wrote into a
  fact during the same turn. A `write_fact` approval filed this turn
  doesn't appear in the recall preview for this turn (it'll appear in
  the next turn's preview if Athena re-reads it).

- **Empty recall is not automatically a fail.** Many turns legitimately
  don't need to consult a memory (a clarifying-question turn, a pure
  chat-card emission). Empty recall + a useful reply is fine.

- **Background jobs may not have completed.** The bundle captures jobs
  in whichever state they were in at turn-finish; a `running`
  `scan_codebase` job means Athena correctly queued it, not that the
  scan is broken. Don't penalize the judge axis on this.

- **Chat-card kinds vs. card config.** Hard assertions check the kind
  and (sometimes) config shape. The judge axes do not — they care
  about the reply prose and whether the cards Athena chose match the
  user's intent. A turn with the right card and wrong prose is still
  `useful = weak` at minimum.

- **Quick replies.** Empty `quick_replies` on a clarifying-question
  turn is usually `useful = weak` (the rubric prefers chips over
  prose-only follow-ups), unless the question is so specific that
  chips would be redundant.

---

## When the bundle is broken

A bundle whose `Athena's reply` section reads `(no reply captured...)`
or whose `drive_error` is set is a **pass-1 failure**, not a judge
failure. Write a verdict JSON anyway with every axis set to `n/a` and
`overall_note` describing the drive failure. The aggregator will roll
it up as `fail` via the hard-assertion path; the verdict file just
keeps the run-dir layout uniform.

---

## When you (Claude) are unsure

The judge is **deterministic at the axis level**: same bundle should
produce the same verdict next session. If a turn is genuinely
borderline:

- Prefer `weak` over a coin-flip `ok`/`fail`. `weak` is the rubric's
  uncertainty bucket.
- Note the uncertainty in the axis note ("borderline — claim X
  paraphrases doctrine Y at the edge of recognizability").
- Surface a maintainer follow-up in `overall_note` ("flag for review:
  this reply pattern recurs in 2 scenarios; rubric may need
  tightening").

The runner aggregates `weak` verdicts as `WARN` — not a fail, but a
signal to the suite owner to triage the borderline pattern.

---

## See also

- [`README.md`](README.md) — suite overview, run instructions
- [`quality-rubric.md`](quality-rubric.md) — axis definitions, judge
  prompt contract (now applied directly by Claude rather than via API)
- [`scenarios/*.md`](scenarios/) — per-scenario rationale
- [`fixtures/*.json`](fixtures/) — machine-readable scenario specs
