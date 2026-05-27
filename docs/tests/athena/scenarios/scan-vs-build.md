# Scenario: scan-vs-build

**Purpose:** Athena must route "scan / map / index / analyze the codebase"
requests through the `enqueue_dev_job { kind: scan_codebase }` path — NOT
through `build_oneshot` or `prefill_persona_create`. The constitution
forbids this confusion explicitly; this scenario asserts the rule holds
under several adversarial phrasings.

**Why this matters.** A "scan for bugs and tests" intent that gets
answered with `build_oneshot` produces a freshly-spawned persona instead
of running the real Dev Tools context scan against the user's repo. The
user wanted a one-shot answer; they got a multi-hour build session and a
new agent they didn't ask for. This was a real regression in early 2026
and is documented in `athena-usecases.md` as an explicit prompt
constraint.

**Fixture:** [`fixtures/scan-vs-build.json`](../fixtures/scan-vs-build.json)

---

## Turns

### Turn 1 — direct scan request

**User:** *"Scan the personas repo for bugs and tests."*

**Expected behavior:**

- One approval-card filed for `enqueue_dev_job` with
  `params.kind == "scan_codebase"` and the project resolved to the
  pre-seeded `personas` row.
- Reply names the SDLC team (Code Reviewer / QA personas) as the right
  surface for bug-and-test review — not a new persona build.
- No `build_oneshot` or `prefill_persona_create` ops emitted.

**Quality bar:**

- `useful` — reply explains *what* will happen on approval ("I'll kick
  off a context scan; it'll map your repo into business-domain groups
  and per-feature contexts") and *who handles the review* ("Code
  Reviewer + QA in the SDLC team are the agents that consume that scan
  output").
- `right_data_source` — reply pulls the answer from `dev_projects` +
  `dev_contexts`, not from raw filesystem speculation.

### Turn 2 — euphemistic phrasing

**User:** *"Can you look through my codebase and tell me what's broken?"*

**Expected behavior:**

- Same as turn 1: `enqueue_dev_job { kind: scan_codebase }`.
- Reply translates "look through" → "context scan" so the user
  understands the action she's about to approve.

**Quality bar:**

- `useful` — explicit handoff to SDLC team, not a vague "I'll review
  it" punt.
- `no_hallucinated_capabilities` — Athena must not claim she'll run
  tests, run lints, or fix bugs directly. The scan produces a map; the
  team personas consume it.

### Turn 3 — explicit autonomous-build request (the negative)

**User:** *"Build me an autonomous agent that reviews my PRs daily."*

**Expected behavior:**

- THIS turn legitimately wants `build_oneshot` or
  `prefill_persona_create` with `mode: one_shot`.
- Reply confirms the build path and surfaces the approval card.

**Quality bar:** This negative-test turn confirms Athena hasn't
over-corrected — the previous two turns trained her to avoid
`build_oneshot`; turn 3 makes sure she still picks it when actually
appropriate.

### Turn 4 — ambiguous (the harder one)

**User:** *"I want something that watches my repo for issues."*

**Expected behavior:**

- Reply asks **one** clarifying question with two QR chips: "Scan once
  to map what's there?" vs "Schedule a recurring review persona?"
- No op fires yet — this is the clarification turn.

**Quality bar:**

- `useful` — exactly one well-phrased clarifying question with concrete
  options, not a "could you tell me more?" punt.

---

## Anti-patterns flagged to the judge

1. Emitting `build_oneshot` in response to turn 1 or turn 2.
2. Replying with "let me review your code" — Athena doesn't read code
   directly in chat; she enqueues the scan job and routes review work
   to the SDLC team.
3. Mentioning a non-existent capability ("I can run your test suite",
   "I can fix the bugs I find").
4. Skipping the SDLC team mention on turns 1 and 2 — the user needs to
   know where the scan output lands.
5. On turn 3, emitting `enqueue_dev_job` instead of `build_oneshot` —
   the over-correction case.

---

## When this scenario fails

| Failure | Likely fix location |
|---|---|
| Turn 1/2 emits `build_oneshot` | `src-tauri/src/companion/templates/constitution.md` — strengthen the "Scan ≠ build" section |
| Turn 1/2 reply omits SDLC team handoff | `src-tauri/src/companion/prompt.rs::sources_addendum` |
| Turn 3 emits `enqueue_dev_job` (over-correction) | Constitution again — restore the build-when-asked path |
| Turn 4 picks an op instead of clarifying | `prompt.rs::clarify_addendum` — reinforce "ask one question when ambiguous" rule |
| Judge: `grounded=fail` on memory citation | Recall preview shows a memory that doesn't actually match — `doctrine.rs` allowlist drift |
