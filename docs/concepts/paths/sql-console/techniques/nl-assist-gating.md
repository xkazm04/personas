---
layer: technique
subject: sql-console
technique: nl-assist-gating
status: forged
laws: [gate-sees-target, one-validation-door]
shared_with: []
---

# NL-assist gating

A natural-language lane — "show me last week's failed orders" becoming SQL —
is the console feature with the best demo and the worst default
architecture. The model is a fluent, confident, occasionally wrong author
with no model of *this* database's stakes. The technique is one sentence
applied ruthlessly: **the model is a second author, never a second path.**
Everything below is that sentence meeting a design decision.

## Same schema source

The model needs schema context to write grounded SQL. It gets that context
from the **same introspection cache** the browser and completion read — the
one door ([one-validation-door](../../_laws.md#one-validation-door) extended
to reads: one *schema truth*, N consumers). A second, private schema-fetch
path for the assistant re-creates the drift the door exists to kill: the
assistant confidently querying a column the browser knows was dropped.
Context building selects, not dumps — the relevant tables' shapes, not the
whole catalog — both for model accuracy and because schema names and
comments are user data that should travel no further than the lane already
discloses.

## Same gate, same door

The generated statement executes through the **same authoritative safe-mode
guard and the same execution call as a typed one**
([gate-sees-target](../../_laws.md#gate-sees-target): the gate must see the
exact string that runs, whoever wrote it). No privileged service call, no
"the model only generates reads so we skip the check" — that assumption is
one adversarial prompt or one model regression away from false, and the
guard is precisely the component built to not care about the author's
reputation. The corollary rules:

- **No auto-execution of mutations, ever.** Whatever auto-run convenience
  the lane offers for reads (and even that deserves a setting), a generated
  mutation always stops at the user.
- **Safe mode applies at its current state.** The lane does not get a
  side-channel toggle; if the session is read-only, generated mutations are
  refused exactly like typed ones, with the same first-class refusal.
- **Injection through the question.** The user's natural-language text and
  any schema comments fed to the model are untrusted prompt input; the lane
  assumes the generated SQL may serve someone else's instructions. This is
  why the gate does not distinguish authors: the guard's verdict is the
  only opinion that survives a compromised generation.

## Visible, editable, attributed

The lane's output is **SQL in front of the user**, not results in front of
the user:

- **Shown before run** — in the editor or an equivalent surface, with the
  same highlighting, against the same visible connection/safe-mode chrome.
  The user must be able to read what is about to run; the console must
  never train them that reading is optional.
- **Editable** — the generated statement is a draft the user owns. The
  edit-then-run flow goes through the ordinary editor path; there is no
  "modified generated query" special case, because after the first
  keystroke it is simply the user's query.
- **Attributed** — results and history entries record generated provenance.
  Weeks later, "did I write this?" has a true answer; provenance also makes
  the lane's quality auditable (which generated queries errored, which were
  edited before running — the lane's real scorecard). Attribution has a
  live form too: when a transcript holds several generated statements and
  a consent gate is pending on one of them, the statement, its consent, and
  the message that will receive the result travel *together* — bound as one
  unit at submit time. Tracking "which message is the run target" in a
  separate mutable slot lets a second run move the slot while the first
  consent is still pending, and the confirmed statement's result lands on
  the wrong message.

The practical shape that satisfies all three: the lane reuses the console's
own guard component and its own execute call — not a re-implementation with
the same idea, the *same code path*, so that every hardening the editor
receives (a stricter classifier, a new bound, a cancel handle) is inherited
by the lane the day it ships rather than ported later.

## Extraction is upstream, honesty is here

Getting well-formed SQL out of model output — fenced-block parsing, schema-
validated structure, repair loops — is the structured-output subject's
machinery, upstream of this technique. What this lane owns is the honesty of
the handoff: a response from which no confident statement could be extracted
is presented as *no query* — a visible "couldn't produce a query for this"
— never as an empty result or a silently-run best guess. And when the model
supplies prose alongside the statement ("this assumes orders has a status
column"), that caveat is part of the answer; a lane that strips the model's
own hedges ships more confidence than the author had.

## The trust loop

Gating sounds like friction, and the reverse is true: users adopt the lane
*because* every generated statement is visible, editable, guarded, and
attributed — the same reasons they trust a human colleague's suggested
query. An ungated lane produces one bad mutation story, and the story does
not end with the lane being fixed; it ends with the console losing the user
to a tool that never generates anything — the containment failure this
entire subject exists to prevent.
