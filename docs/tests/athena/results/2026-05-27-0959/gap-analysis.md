# Athena Quality Suite — Run 5 Gap Analysis (post v23)

**Run:** `docs/tests/athena/results/2026-05-27-0959/`
**Constitution version:** v23
**Pass rate:** **96%** (22/23 turns)
**Full-green scenarios:** **4 of 5**
**Stale-project_id silent-fail bug:** resolved (dispatcher fallback)
**Auto-approve executions:** 8 fired, all clean (`exec_failed=0`)

---

## Trajectory across all 5 runs

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| Hard PASS | 13 (56%) | 16 (70%) | 18 (78%) | 20 (87%) | **22 (96%)** |
| Full-green scenarios | 0 | 1 | 1 | 3 | **4** |
| Hard fails | 10 | 7 | 5 | 3 | **1** |

Monotonic improvement, no regressions across the v20→v23 chain.

---

## What landed in run 5

### Constitution v23

| Change | Effect |
|---|---|
| **"Design-family cards fire UNCONDITIONALLY"** section with user-says → you-emit table | design-family t2 use_cases PASS, t6 recap PASS — both were stuck on prose-without-OP for runs |
| **enqueue_dev_job grammar** prefers `project_name` / `path` over `project_id` (which rots across sessions) | Pairs with backend fix below |
| **"Reading approval-failed system episodes"** rule — Athena now knows to self-correct when she sees `[Athena action approved but failed]` in observability | Defensive — proactively closes the silent-fail loop |

### Backend

| Change | Effect |
|---|---|
| `execute_enqueue_dev_job` now falls back to most-recently-registered project when project_id doesn't match (with a "note: requested X didn't match, used Y instead" message) | Closes the run-4 silent prod failure: scan now happens regardless of whether Athena's project_id is stale |

### Suite hardening

| Change | Effect |
|---|---|
| New `evaluate_approval_assertions` — hard-fails on `approved_failed` outcomes by default | Catches the post-emission execution gap that op-emission tests can't see |
| New `expect_approval_status` fixture knob (`approved` / `approved_failed` / `rejected`) | Lets a scenario explicitly assert a known-bad approval (for negative tests) |
| Auto-approve trace now reports `approved` / `exec_failed` / `ipc_failed` separately | Clearer signal in the log |

---

## What's still failing — 1 turn

### template-vs-build t0 — persistent prose-without-OP

The lone remaining failure. User says:

> "I need an agent that watches my Sentry project and pings me in Slack when new critical issues land."

Athena replies:

> "Both Sentry and Slack are wired, so this is a clean shape. Let me check the gallery first — there's likely a close match we can adopt instead of designing from scratch."

But emits **zero ops**. No `show_template_suggestions` card.

This is the **same pattern** Rule Zero + Pre-reply Emission Checklist +
v23's "Design-family cards fire UNCONDITIONALLY" table were all
designed to prevent — and Athena STILL narrates the intent without
emitting the OP for this specific phrasing.

**Why it persists:** the v23 table explicitly lists this case:

```
| "I need an agent that watches X and pings Y" (no autonomy cue) | `OP: show_template_suggestions` |
```

But the model is reading **"I need an agent that…"** as a build
intent rather than a suggest intent. The phrase "an agent that…"
triggers her build-mode pattern matcher, which fires first and skips
the suggest table entry.

**Two paths forward (deferred):**

1. **Few-shot at top of constitution.** A literal "USER SAYS X, YOU
   EMIT Y" worked example showing the exact Sentry/Slack phrasing
   and the matching `OP: show_template_suggestions` JSON. The
   table-form rule isn't pattern-anchored enough for the model.
2. **Soft-fail this specific case.** Athena's behavior IS defensible
   — she could honestly route this to `prefill_persona_create`
   because Sentry+Slack are wired and the intent is concrete enough
   to build. Accept either `template_suggestions` OR
   `prefill_persona_create` in the fixture. The whole point of the
   audit pass we did in run 4 was acknowledging that some routings
   have multiple defensible answers.

Either is fine for a follow-up.

---

## Notable UX hardening landed beyond test pass-rate

### 1. Stale-`project_id` silent-fail mode is closed

Before: Athena emits `enqueue_dev_job { project_id: "proj_<old>" }`.
User clicks Approve. Dispatcher: "No Dev Tools project matched X.
Register it first." Action does nothing. User sees "kicking off a
scan" + no follow-up.

After:
1. Constitution tells Athena to **prefer `project_name` + `path`**
   (durable across resets) over `project_id` (rots).
2. Dispatcher **falls back to most-recently-registered** when the
   project_id Athena emitted doesn't match. The success message
   names the fallback: *"Context scan started for X (path) (note:
   requested 'proj_old' didn't match any project — using the
   most-recently-registered one)"*.
3. The failure message Athena would see (if no projects exist at
   all) now says: *"No Dev Tools projects registered yet. Register
   one first."* — clear, actionable.

Both layers fire: Athena's preference (prevention) + dispatcher
fallback (resilience). Even if Athena ignores the constitution and
emits a stale ID, the scan still happens.

### 2. Approval-failed self-correction loop documented

When `companion_approve_action` returns `approved_failed`, the
backend writes a system episode `[Athena action approved but failed]
<action> — <error>` that Athena reads on her next turn. The new
constitution section "Reading approval-failed system episodes" tells
Athena exactly how to react: acknowledge, name the error class,
propose the fix, don't re-emit the same broken OP.

This is the **end-to-end loop**:
- Athena emits OP →
- User (or harness) approves →
- Executor runs validation; on failure, writes system episode →
- Athena reads it next turn, self-corrects.

### 3. Suite catches both layers

The hard-assertion layer catches "did Athena emit the right op?".
The new approval-outcome layer catches "did the approval actually
execute?". A turn fails if EITHER layer fails — which means a
constitution-correct op can still flag if the params Athena chose
don't validate at execute-time.

---

## Where we stand

The suite has reached its **graduation point** as a regression watch:

- **96% pass rate** consistently producing useful signal.
- **4 of 5 scenarios fully green** — these now serve as the
  regression baseline. Any future drop is a real regression.
- **Auto-approve loop** is the second-level test gate that catches
  post-emission silent failures.
- **End-to-end loop** is now observable: emit → approve → execute →
  self-correct.

The 1 remaining failure (template-vs-build t0) is well-understood
and has two clear paths to closure — neither is urgent for using
the suite as a baseline.

This is a good checkpoint to **freeze the chain** at v23 and pivot
to the next workstream (3rd-party connectors), with the suite now
in place as a quality gate for the new work.

---

## Open items for follow-up

| Item | Priority | Why |
|---|---|---|
| Close template-vs-build t0 (few-shot or fixture relax) | Med | Last regression-suite gap |
| LLM-as-judge pass (was deferred from earlier runs) | Med | Catches the "useful but right-shape" axis we can't currently grade |
| Re-run on `tauri:dev:test:full` to validate doctrine recall (ml feature) | Low | Currently skipped on lite |
| Wire suite to CI as gate / nightly | Low-Med | Once new connector work begins, the suite catches regression risk |

---

## Hardening principles that emerged from these 5 runs

For the design / UX brainstorm coming next on 3rd-party connectors:

1. **Op-grammar is contract.** Every action Athena can take needs an
   explicit op-grammar line in the constitution; missing grammar →
   model invents shape → dispatcher rejects → silent failure. This
   is what bit us with `enqueue_dev_job` initially.
2. **Prefer durable identifiers.** Anything Athena might emit across
   sessions (project_id, persona_id, credential_id) is risky;
   prefer human-readable names + paths when both are accepted by
   the backend.
3. **Backend fallbacks are non-optional.** Don't trust LLM to
   always emit the right ID; have the dispatcher recover gracefully
   when possible.
4. **Narration is not action.** This is the single rule that bit
   us most across the chain. The constitution now repeats it 3×
   (Rule Zero + per-section + Pre-reply checklist) for a reason.
5. **The auto-approve loop is the second-level test.** Op emission
   says "Athena tried"; auto-approve says "the action worked". Both
   are needed for honest regression coverage.

These principles will guide the connector work.
