---
layer: technique
subject: alerting
technique: rule-authoring-validation
status: forged
laws:
  - one-validation-door
  - gate-sees-target
shared_with: []
---

# Rule-authoring validation

An alert rule is a small program written by someone who will not be present
when it runs. The authoring surface is therefore the one moment where a
human with intent, context, and recent data in front of them can be asked
"is this really what you mean?" — and the only moment where a structurally
broken rule can be rejected cheaply. Every class of brokenness caught here
costs one error message; the same class discovered in production costs
either a burned channel (the rule that always fires) or an invisible
coverage hole (the rule that never can).

## The rule's anatomy, and what each part can get wrong

A threshold rule is at minimum: a **signal reference** (which metric), a
**comparator** (above/below), a **threshold value**, a **window** (over what
span or how many samples), and a **severity**. Each field has its own
failure class:

- **Signal reference** — must resolve to a metric that exists and is being
  collected. A rule bound to a retired or renamed metric evaluates against
  nothing; depending on how "nothing" coerces, it either never fires
  (silent coverage loss) or always fires (nulls comparing as zero). The
  reference is validated against the live signal catalog at save time, and
  the system re-validates on catalog change — a rule orphaned by a metric
  rename is surfaced to its author, not left evaluating vapor.
- **Comparator direction** — the single most common authoring error is the
  inverted comparison: "alert when free space is *above* 10%". Direction
  errors are not statically detectable in general, but the preview (below)
  makes most of them obvious: an inverted rule previews as firing
  constantly or never.
- **Threshold vs the metric's domain** — every metric has a known domain: a
  percentage lives in [0, 100], a count is non-negative, a ratio sits in
  [0, 1]. A threshold outside the domain produces a rule that is **always
  true or never true by construction**, and this is decidable at the door.
  "Error rate above −5" and "success percentage below 150" are not unusual
  configurations to warn about; they are invalid programs to reject. The
  rejection message names the domain, because the author who typed 150
  usually meant a differently-scaled metric.
- **Window** — a window shorter than the metric's collection interval
  evaluates single samples while claiming to evaluate a span; a window of
  zero is an instantaneous spike detector wearing a duration's clothes.
  Minimum window is derived from the signal's actual cadence, not assumed.
- **Scope** — which subset of the world the rule watches (one source, one
  tenant, the whole fleet). A scope reference is validated like a signal
  reference: it must resolve, and a rule whose scope entity is later
  deleted is surfaced as broken, not silently widened to everything.
- **Severity** — drawn from the closed routing vocabulary, never free text.

## The whole predicate lives in the rule

The window and the scope are **part of the predicate, stored on the rule** —
never constants inside an evaluator. "Error rate above 10" is not a
condition; "error rate *over the last hour, for this source,* above 10" is.
A window that lives in evaluator code is a window the author cannot see,
cannot tune, and — the killing consequence — cannot reconcile with the
chart they read the threshold off: an author who tunes a threshold against
a thirty-day view and saves a rule that some evaluator silently applies to
a one-day window has authored a miscalibrated rule with no visible defect.
Worse, when more than one component evaluates rules, any part of the
predicate left implicit becomes a part on which the evaluators can
disagree — the same rule row meaning three different questions in three
places. The authoring surface therefore displays the full predicate,
window and scope included, and previews against exactly that predicate.

## One door

All of this lives in **one validation door**
([one-validation-door](../../_laws.md#one-validation-door)) that every
writer passes through — the interactive editor, any import path, any
programmatic or automated rule creation, and any edit of an existing rule.
Validation implemented only in the pretty editor is validation minus the
bulk-import added next quarter. The door is at the storage boundary, and
the storage layer rejects — the editor merely explains the rejection
earlier and more kindly.

## Preview-before-save: the empirical check

Static validation catches the impossible; **preview catches the
unintended**. Before a rule is saved, it is evaluated retroactively against
the recent history of its signal — the same data, through the same
evaluation semantics, that the real evaluator will use
([gate-sees-target](../../_laws.md#gate-sees-target); a preview computed by
different code over a different window is a rehearsal of a different play).
The output is one sentence: *"this rule would have fired N times in the
last seven days."*

That sentence is the highest-value line in the entire editor:

- **N = 0** over a period that included known incidents → the rule is
  probably too loose or inverted.
- **N in the hundreds** → the author is about to install a fatigue engine;
  the surface says so plainly and suggests the threshold at which N drops
  to a workable number.
- **N in single digits, landing on the days the author remembers as bad**
  → the rule is calibrated, and the author saves it with earned confidence
  rather than hope.

Preview requires history; a brand-new signal has none. The honest fallback
is to say "no history to preview against", never to skip the preview
silently — an unpreviewed rule should feel unfinished.

## Decision rules

- Reject, don't warn, when the rule is impossible (out-of-domain threshold,
  unresolvable signal). A warning on an always-true rule is a fire alarm
  sold with a "may ring continuously" sticker.
- Warn, don't reject, when the rule is merely suspicious (very high preview
  count, very short window). The author may know something the validator
  does not.
- Every rejection names the fix: the valid domain, the closest matching
  signal name, the minimum window.
- Edits pass the same door as creations; there is no "just tweak the
  threshold" path that skips validation.
