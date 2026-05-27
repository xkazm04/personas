# Scenario: template-vs-build

**Purpose:** When a user describes a persona they want, Athena's first
move should usually be `show_template_suggestions` — surface near-matches
from the gallery — NOT `prefill_persona_create` or `build_oneshot` from
scratch. The constitution explicitly biases toward "adopt over build" when
a gallery near-match exists, because adoption preserves the customization
flow users expect (questionnaire + connector binding).

**Why this matters.** Skipping straight to `build_oneshot` for an intent
that matches an existing template wastes 5-10 minutes of build time on
something the gallery already does better, and loses the curated
questionnaire that flags credential / connector gaps the user needs to
resolve before the persona can actually run.

**Fixture:** [`fixtures/template-vs-build.json`](../fixtures/template-vs-build.json)

---

## Turns

### Turn 1 — intent that has a clear gallery near-match

**User:** *"I need an agent that watches my Sentry project and pings me
in Slack when new critical issues land."*

**Expected behavior:**

- Athena emits `show_template_suggestions { intent: "...", limit: 5 }`.
- The widget calls `companion_match_templates` with the intent string;
  results include "Sentry Watcher" or similar.
- Reply text *introduces* the suggestions ("These look like near
  matches — open the gallery for the full adoption flow"). Not the
  full prose of each template.
- A `QR:` chip array offers: "Open gallery", "Build from scratch
  instead", "Tell me more about the first one".

**Quality bar:**

- `right_data_source` — Athena pulls from
  `companion_match_templates` (which hits the templates registry),
  NOT from training-data knowledge of "common Sentry agents".
- `useful` — names the top match by template `name`, not just a
  generic "I found some matches".

### Turn 2 — intent with no good gallery match (the negative)

**User:** *"Build me an agent that translates English idioms into Czech
slang based on a user-provided context."*

**Expected behavior:**

- No template_suggestions card (or one with empty results),
  followed by a `show_persona_walkthrough` or
  `prefill_persona_create` with the refined intent.
- Reply explicitly acknowledges no near-match exists.

**Quality bar:** Negative test — confirms Athena doesn't emit a
`show_template_suggestions` card with garbage matches just because the
op exists. If the match query comes back empty, she should say so and
pivot to the design path.

### Turn 3 — user accepts a template

**User:** *"Show me more about the first one."* (assuming turn 1
surfaced "Sentry Watcher")

**Expected behavior:**

- Reply describes the named template using doctrine sources
  (templates registry + template's instruction snippet from the match
  result already in conversation context).
- A `QR:` chip "Open gallery to adopt" routes the user forward.
- No `prefill_persona_create` op — adoption goes through the gallery
  flow, not direct prefill.

**Quality bar:**

- `grounded` — every claim about the template traces to data the
  match query actually returned. No invented features.

### Turn 4 — user wants to skip the gallery and build directly

**User:** *"Forget the gallery, just build a Sentry-to-Slack agent for
me from scratch."*

**Expected behavior:**

- Reply respects the user's explicit "build from scratch" request:
  emits `prefill_persona_create` with the refined intent and
  `mode: interactive` (NOT one_shot — interactive lets the user
  review).

**Quality bar:**

- `useful` — Athena does not re-litigate the template suggestion
  ("are you sure?"). The user was clear.

---

## Anti-patterns flagged to the judge

1. Emitting `prefill_persona_create` on turn 1 when a gallery match
   exists.
2. Emitting `show_template_suggestions` with hallucinated template
   names not in the registry.
3. Describing a template's features (turn 3) by inventing them
   instead of paraphrasing the match-result snippet.
4. On turn 4, ignoring the user's explicit override and pushing
   adoption again.
5. Surfacing both `show_template_suggestions` AND
   `prefill_persona_create` on the same turn — the user can't act on
   both; pick the suggestion path first and let the user route.

---

## When this scenario fails

| Failure | Likely fix location |
|---|---|
| Turn 1 picks build over suggestions | constitution.md — `show_template_suggestions` bias |
| Suggestions card has zero results when one is obvious | `companion_match_templates` keyword extraction in `src-tauri/src/commands/companion/templates.rs` |
| Turn 4 stays in suggestion mode | constitution.md — respect-explicit-override rule |
| Judge: `grounded=fail` on turn 3 | Template doctrine missing or stale — check `docs/features/templates/README.md` is in `doctrine.rs::DOCTRINE_DOCS` |
