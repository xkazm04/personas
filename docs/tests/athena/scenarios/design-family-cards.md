# Scenario: design-family-cards

**Purpose:** When a user asks "help me design a persona for X", Athena
walks them through the design decomposition using the design-family
chat-cards, in the right **order** and with the right **content shape**.
The family is large (`show_persona_walkthrough` → `show_use_case_set`
→ `show_trigger_set` → `show_model_tier_choice` →
`show_observability_plan` → `show_decision_log` → `show_persona_ready`)
and the constitution gives Athena discretion about which to emit and
when. This scenario asserts she picks a coherent sequence and not a
random subset.

**Why this matters.** Each card answers one of the seven readiness
items from persona-design best-practices doctrine. Skipping the
use-case decomposition produces personas that break on their first
edge-case input; skipping the observability plan produces personas
nobody can debug. The whole point of the design-family family is that
no single card is enough.

**Fixture:** [`fixtures/design-family.json`](../fixtures/design-family.json)

---

## Turns

### Turn 1 — open-ended design ask

**User:** *"Help me design a persona that triages incoming customer
support emails."*

**Expected behavior:**

- Athena emits **either**:
  - `show_persona_walkthrough` with a full markdown plan covering
    intent line, system prompt outline, use cases, tools, triggers,
    model tier, observability — the seven readiness items, OR
  - `show_design_capabilities` if she wants to scope first (acceptable
    if the user's intent is genuinely ambiguous; for this intent it's
    not, so prefer walkthrough).
- Recall preview MUST include
  `concepts/persona-design-best-practices.md` — the doctrine driving
  this whole family.

**Quality bar:**

- `useful` — walkthrough has all 7 readiness items, not just 2-3.
- `grounded` — walkthrough quotes phrases that appear in the
  best-practices doctrine; the judge has the doc in context to verify.

### Turn 2 — drill into use cases

**User:** *"Good. What use cases should it handle?"*

**Expected behavior:**

- Athena emits `show_use_case_set { intent, use_cases: [...] }` with
  3-5 use cases tagged `golden | variant | out_of_scope`. Best
  practice (and dispatcher validation): at least one of each role.

**Quality bar:**

- `useful` — concrete use cases tied to the email-triage intent
  ("billing inquiry → route to billing team"), not generic
  ("respond to user message").
- `op_correctness` — exactly one card, kind `use_case_set`, with
  use_cases array of length 3-5 and at least one of each role.

### Turn 3 — drill into triggers

**User:** *"What triggers it?"*

**Expected behavior:**

- `show_trigger_set { intent, triggers: [...] }` with 1-4 triggers.
  For this intent the obvious answer is an inbox-poll trigger; a
  manual trigger for testing is a defensible second.

**Quality bar:**

- `right_data_source` — triggers reference Athena's actual trigger
  registry (`events` page; `triggers` table in DB), not generic
  webhook examples.

### Turn 4 — model tier

**User:** *"Which model should it use?"*

**Expected behavior:**

- `show_model_tier_choice { intent, recommended, tiers: [haiku, sonnet, opus] }`
  with `recommended` set per the doctrine heuristic: Haiku for
  high-volume triage with structured output is the *expected* recommendation
  for this intent.

**Quality bar:**

- `grounded` — rationales match the doctrine heuristics
  ("haiku for high-volume routing/triage with structured output").

### Turn 5 — observability

**User:** *"How will I know if it's working?"*

**Expected behavior:**

- `show_observability_plan { intent, error_handling, success_metric }`
  with `success_metric.kind` in
  `count_by_status | cost_per_run | latency | custom` and
  `error_handling` listing at least one named failure mode + escalation
  target.

**Quality bar:**

- `useful` — both sections populated; `success_metric.target` set to
  a concrete number, not "should be high".

### Turn 6 — the recap

**User:** *"Okay, I'm ready. Recap what we decided."*

**Expected behavior:**

- `show_decision_log` (the audit-trail surface) OR
  `show_recent_decisions` (the chip-strip shorthand) followed by
  `show_persona_ready { intent, recommended_action, summary }`.
- `recommended_action` should be `interactive` for an email-triage
  agent of this complexity (one_shot would be too uncertain; template
  doesn't apply since this is bespoke).

**Quality bar:**

- `useful` — the recap actually summarizes the prior turns; doesn't
  invent decisions that were never made.
- `op_correctness` — both cards fire (audit trail + ready), in that
  order.

---

## Anti-patterns flagged to the judge

1. Emitting two design-family cards on the same turn (except the
   recap turn) — they're meant to be one-per-question.
2. Emitting `show_decision_log` with entries that don't match what
   was actually discussed in prior turns.
3. Recommending `build_oneshot` as the `recommended_action` for an
   intent with this much un-validated complexity.
4. Skipping `show_use_case_set` (most common failure mode) — the
   doctrine treats it as mandatory.
5. Replying in free prose on any of turns 2-5 instead of emitting
   the structured card. Free prose loses the audit trail.

---

## When this scenario fails

| Failure | Likely fix location |
|---|---|
| Wrong card kind on turn 2-5 | constitution.md — re-tighten op→intent mapping |
| Card validation rejection (oversize array, missing role) | dispatcher.rs validators — check `companion::dispatcher::validate_*` |
| `grounded=fail` on rationale text | `docs/concepts/persona-design-best-practices.md` not in doctrine corpus or stale; rerun `companion_reingest_doctrine` |
| Multiple cards per turn | constitution.md — "one design-family card per question" rule |
| Recap invents un-discussed decisions | prompt.rs::recap_addendum + decision_log dispatcher hook (rows should auto-persist; recap should query, not invent) |
