---
layer: technique
subject: health-checks
technique: remediation-affordances
status: forged
laws: [deletion-is-not-repair]
shared_with: []
---

# Remediation affordances

A health check's product is not the color; it is the *next action*. The
operator standing in front of a red light has exactly one question — "what do
I do?" — and a check that cannot answer it has merely relocated the
diagnosis work from the machine (which knew, at probe time, exactly what
failed) to a human (who must now rediscover it). The rule: **every check is
authored with its remediation, at the same moment, by the same author** —
because the person writing "verify X responds" knows, right then, what it
means when X does not, and that knowledge does not survive to a later
sprint.

## The remediation ladder

Fixability is a spectrum, and each check declares where its failures sit:

1. **Instruction** — the floor. A concrete, imperative, human-executable
   sentence: not "dependency unavailable" but "install X version ≥ N and
   ensure it is on the search path". Specific enough that the operator's
   next keystroke is obvious.
2. **Guided fix** — the instruction plus the exact artifact: the command to
   run, the setting to change, a link that lands *on* the setting rather
   than near it.
3. **Applied fix** — the system can perform the remediation itself, on
   request. The check carries a fix handle; the surface renders a fix
   affordance next to the red.
4. **Declared unfixable-from-here** — the failure requires action outside
   the product's reach (an account upgrade, a physical cable, an
   administrator). Declaring this honestly is itself an affordance: it
   tells the operator to stop looking for the button.

The declaration is structural — a per-check property (fixable, installable,
guided, external) the surface can branch on — not prose the renderer must
parse. A list of reds where some rows carry buttons, some carry commands,
and some carry "this needs your administrator" is a to-do list; a list of
bare reds is a mood.

## Applied fixes are mutations, and get mutation rules

The moment a check can *change* the environment, it stops being a probe and
inherits every rule probes were exempt from by being read-only:

- **Consent per application.** A fix runs when asked, never as a side
  effect of rendering, refreshing, or re-checking. Auto-repair on probe is
  the anti-pattern: the diagnostic layer silently mutating environments on
  its own schedule converts "checking must not become the load" into
  "checking became the incident".
- **Confirmation scales with blast radius.** Installing a missing tool into
  a sandbox may be one click; anything that touches shared state, spends
  money, or is hard to reverse says what it will do *before* doing it.
- **The fix's success claim is the re-probe.** After an applied fix, the
  system re-runs the check and reports the new verdict; the fix's own exit
  status is a claim about the fix, not about health. "Fixed, and here is
  the green probe to prove it" — or "the fix ran, and the check still
  fails", which is a first-class outcome, not an embarrassment to hide.
- **Fixes are idempotent or refuse to repeat.** The operator *will* click
  twice.

## Suppression is not remediation

Every health surface eventually grows a "dismiss" or "ignore this check"
affordance, and it has legitimate uses — a check genuinely inapplicable to
this environment is noise, and noise erodes the currency of red. But
silencing a check is governed by
[deletion-is-not-repair](../../_laws.md#deletion-is-not-repair): it removes
the *visibility* of the defect at exactly the place visibility existed.
So suppression is explicit (a recorded decision with an author, never a
default), scoped (this check, this environment, ideally this version — not
"forever"), and visible in the rollup (a summary that counts suppressed
checks as green without disclosure has been quietly edited by everyone who
ever clicked dismiss). The suppressed row renders as suppressed, not as
absent.

## Remediation text is user-facing copy

Fix instructions are shown to humans and obey the product's user-facing
failure-copy discipline — honest about what is known, concrete about the
next step, translated where the product is, and maintained in the same
registry rhythm as other failure copy (the
[error-handling](../../error-handling/error-handling.md) subject's
user-facing mapping). The classification that *selects* the remediation is
the same classification the verdict branched on: one classifier, two
consumers — never a second, remediation-local guess at what went wrong.
