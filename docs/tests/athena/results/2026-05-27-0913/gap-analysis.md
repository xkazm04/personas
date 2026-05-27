# Athena Quality Suite — Run 3 Gap Analysis (post v21)

**Run:** `docs/tests/athena/results/2026-05-27-0913/`
**Constitution version:** v21
**Hard-assertion pass rate:** **78%** (18/23 turns) — up from 56% (run 1) and 70% (run 2)

This run validates the v20/v21 constitution patches against the run-1
baseline. Net: 6 turns fixed, 1 turn regressed, 16 turns stable. memory-doctrine
hard=PASS in two consecutive runs.

---

## What landed (run 1 → run 3 wins)

| Fix | Where | Turn(s) cured | Evidence |
|---|---|---|---|
| **`enqueue_dev_job` op grammar** | constitution v20 (new grammar lines + "Scanning a codebase" section) | scan-vs-build t0 | Athena emits `OP: enqueue_dev_job{kind:scan_codebase}` instead of malformed `use_connector` wrap |
| **`design_capabilities` card** | constitution v20 ("Capability listing" section) | memory-doctrine t0 | Card emits on "what can you do?" instead of prose enumeration |
| **Connector-availability check** | constitution v20 ("Non-wired connector" section) | memory-doctrine t3 (already PASS, now substantively cleaner) | Athena leads with "Notion isn't wired" instead of design Q's |
| **Explicit-autonomy override** | constitution v21 (universalized "OP IS the action" + gallery-first carve-outs) | build-oneshot t0 | "Just build it" no longer pivots to template_suggestions |
| **Doctrine recall skip on lite build** | runner (`ATHENA_SUITE_HAS_ML` env gate) | memory-doctrine t2, scan-vs-build t0, design-family t0 | Assertions correctly mark skip instead of false-fail |

---

## What's still failing (5 turns)

### A. Narration without `OP:` emission — 3 turns (the persistent pattern)

| Turn | Symptom |
|---|---|
| `design-family/t0_open_design_ask` | Athena: "Before we design from scratch, let me check the gallery…" — but emits **no** `show_template_suggestions` OP. No card renders. |
| `design-family/t5_t6_recap` | Athena: "Here's the audit trail…" — but emits **no** `show_decision_log` OP. |
| `template-vs-build/t0_clear_gallery_match` | Athena: "Letting me check the gallery first…" — but emits **no** `show_template_suggestions` OP. |

**Pattern:** Athena keeps verbalizing the intent ("let me check / here's the
audit trail / before we design") without emitting the `OP:` JSON line that
actually creates the side-effect.

**Why two passes haven't fixed it:** v21 universalized the
"narrating-is-not-action" rule, but the rule comes ~220 lines into a 832-line
constitution. Athena's *narrative* instinct for intro-framing wins over the
*emission* discipline buried later in the prompt.

**Candidates for v22:**

- **Pre-reply OP-emission gate.** Add a one-line tail rule near the end of the
  constitution: *"Before you send your reply: if your prose says you're going
  to fire / check / surface / render anything, scan the same reply for an
  `OP:` line. If it's missing, you have done nothing — emit the OP."*
- **Move the universal "OP IS the action" rule to the TOP** of the constitution
  rather than buried under "Building agents". It should be Rule Zero, not Rule
  N+1.
- **Inline the rule into each design-family op grammar line.** Append "(an
  `OP:` line is required — narrative reference does not render the card)"
  directly to the grammar entries Athena reads first.

### B. QR chips disappeared on clarification turn — 1 turn

`build-oneshot/t2_underspecified_but_confident` — v21 made Athena more
willing to commit, but she stopped offering the alternative chips when she
correctly refused to one-shot. Lost 4 chips → 0 chips.

**Fix in v22:** strengthen the existing "Quick replies" section to
explicitly cover *underspecified-but-confident* turns — these need 2-4
concrete chips even when refusing to commit.

### C. Soft routing decision — 1 turn

`scan-vs-build/t1_euphemistic_scan` — user asks "what's broken?", Athena
correctly diagnoses from operational state + offers to enqueue the scan
+ routes to SDLC team Code Reviewer. The fixture expects `enqueue_dev_job`
to auto-fire; Athena waits for confirmation.

**This is a fixture choice, not an Athena bug.** Two ways to close:

- (a) Adjust fixture to accept either auto-fire OR question-with-chip path.
- (b) Strengthen the "Scanning" section to say "fire enqueue_dev_job
  immediately for any scan/look-through phrasing; do not gate on user
  confirmation."

Either works. (a) is more user-friendly; (b) is stricter.

---

## Recommendation for next steps

The suite is now in a useful state — three runs in, the framework is
debugged, the runner has resilience built in, and behavior trends are
visible across versions.

**Options for next iteration:**

1. **Stop here, declare 78% the new baseline.** Document the 5 remaining
   gaps, freeze the constitution, and treat the suite as a regression
   monitor. New ships have to maintain ≥78%, fix-or-acknowledge any
   regression below baseline. **Pros:** the suite is now useful as a
   regression watch. **Cons:** 22% known-failure surface.

2. **One more iteration (v22).** Try the Pre-reply OP-emission gate + the
   QR-chips-for-clarification fix. The narration-without-OP pattern is the
   highest-leverage fix; one targeted edit may flip 3 turns. **Pros:**
   could plausibly reach 90%+ pass rate. **Cons:** diminishing returns;
   risks new regressions.

3. **Relax fixtures where Athena's behavior is defensible.** Turn the
   "expected card kind = X" assertions into "expected card kind in [X, Y]"
   when both are reasonable user-facing responses for the intent. **Pros:**
   suite measures useful behavior, not prescribed behavior. **Cons:**
   weakens the regression signal on real op-mistakes.

A blend of (2) + (3) is probably the right answer — one more v22 patch
focused on the narration-without-OP pattern, plus a fixture audit that
accepts `template_suggestions` on the `design-family/t0` turn (it's a
defensible response to a connector-shape design ask).
