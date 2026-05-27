# Scenario: build-oneshot-vs-interactive

**Purpose:** When a user is ready to commit to a build, Athena picks
between three commit paths: `build_oneshot` (autonomous, no questions),
`prefill_persona_create` with `mode: interactive` (user reviews each
matrix question), or `use_template` (gallery adoption). The right pick
depends on (a) how decided the user sounds, (b) how complex the intent
is, and (c) whether a near-match template exists.

**Why this matters.** Picking `build_oneshot` for an under-specified
intent produces a confidently-wrong persona the user then has to undo.
Picking `interactive` for a well-specified intent wastes 20-30 minutes
of clicking through obvious answers. The cost asymmetry favors
`interactive` as the default, but the constitution explicitly allows
`build_oneshot` for users who say "just build it".

**Fixture:** [`fixtures/build-oneshot-vs-interactive.json`](../fixtures/build-oneshot-vs-interactive.json)

---

## Turns

### Turn 1 — confident, "just build it" phrasing

**User:** *"Just build me an agent that watches Sentry and posts new
critical issues to my #alerts Slack channel. Decide everything yourself,
I'll review when it's done."*

**Expected behavior:**

- `propose_action: build_oneshot { intent, name? }`.
- Reply explicitly acknowledges the autonomous-build path ("I'll
  decide tier, prompt, triggers — you'll see a draft when it
  promotes").
- A `QR:` chip offers "Make it interactive instead" as the off-ramp.

**Quality bar:**

- `useful` — confirms what the user will see when build completes
  (OS notification; new persona in roster).
- `no_hallucinated_capabilities` — does NOT promise to "watch for
  any issue type, not just critical" or expand scope beyond what the
  user said.

### Turn 2 — same user, more cautious phrasing

**User:** *"I want an agent that watches Sentry. Walk me through what
you'd build."*

**Expected behavior:**

- Either `show_persona_walkthrough` (preferred — user explicitly asked
  to be walked through) OR
  `propose_action: prefill_persona_create { mode: interactive }` (also
  acceptable — interactive mode IS the walkthrough surface).
- NOT `build_oneshot`.

**Quality bar:**

- `useful` — reply distinguishes the two paths so the user can pick.

### Turn 3 — confident again, but the intent is under-specified

**User:** *"Just build me something that helps with my email."*

**Expected behavior:**

- Athena should NOT emit `build_oneshot` for an under-specified intent
  even when the user says "just build". The right move is a single
  clarifying question with QR chips ("Triage incoming?", "Draft
  outgoing?", "Summarize by sender?").
- After clarification, the next turn can commit.

**Quality bar:**

- `useful` — clarifying question is *specific* (not "tell me more")
  and the chip set lets the user pick without typing.
- The reply explicitly acknowledges "I want to make sure I build the
  right one" — owns the friction.

### Turn 4 — clarified intent

**User:** *"Triage incoming. Just build it."*

**Expected behavior:**

- Now `build_oneshot` is appropriate — intent is specific, user is
  confident. The op fires.

**Quality bar:**

- Reply does NOT re-litigate. The user clarified; commit.

---

## Anti-patterns flagged to the judge

1. Turn 1: emitting `prefill_persona_create` despite "decide
   everything" — that's overriding the user's explicit choice.
2. Turn 3: emitting `build_oneshot` for an under-specified intent
   ("help with my email" is not enough).
3. Turn 3: asking three clarifying questions in a row instead of one
   well-chosen one.
4. Turn 4: re-asking for clarification after the user already
   committed.
5. Any turn: claiming the build will "do more" than what was asked
   (scope creep).

---

## When this scenario fails

| Failure | Likely fix location |
|---|---|
| Turn 1 emits interactive instead of one_shot | constitution.md — "respect explicit autonomy preference" |
| Turn 3 emits one_shot for vague intent | constitution.md — under-specification trap |
| Turn 3 asks vague "tell me more" | prompt.rs::clarify_addendum — strengthen the "one specific question with chips" rule |
| Turn 4 stalls | constitution.md — commit-when-clarified rule |
