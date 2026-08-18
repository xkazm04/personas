---
layer: technique
subject: templates-scaffolding
technique: template-portability
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Template portability

A template is authored in one environment and adopted in many. Portability
is the discipline that keeps the author's environment from leaking into the
payload — because every leaked particular is a defect with a delay fuse: it
works perfectly where it was written (which is where it gets tested) and
detonates only elsewhere (which is where it gets adopted). The three big
leak classes each have a named rule.

## Roles, not named services

A payload that needs to "notify the team" declares a **generic messaging
role**; it never names the author's chat product. The reasoning is both
practical and commercial:

- **Practical**: the adopter runs whatever they run. A template hard-wired
  to ServiceX is broken for every ServiceY shop — not degraded, *broken*,
  because the named integration doesn't exist in their environment.
- **Commercial**: naming a service brands the template. A catalog whose
  entries each assume a different vendor stack reads as a pile of other
  people's setups, not a library of starting points. Generic roles make
  one template serve every stack — the role binds to the adopter's actual
  service at adoption, through the readiness matcher (see
  [readiness-prerequisites](readiness-prerequisites.md), which consumes
  exactly the role declarations this rule produces).

The same applies inside prose the payload carries — prompts, descriptions,
step instructions. "Post the summary to the messaging channel" survives
adoption anywhere; "post the summary to #eng-updates" is the author's
office furniture shipped in the box.

## No manual triggers, no author's hand

Payloads that define automation must not ship the author's **manual
trigger** — the "run now" affordance, the test firing, the debug schedule
left from development. The failure mode is precise: after adoption, that
trigger exists in the adopter's environment *with the adopter's authority
and nobody's intention*. It fires because the author once needed it to; it
acts as the adopter; and its output arrives with no human who remembers
creating it. The rule generalizes: **a template ships intentions the
adopter will own, never actions the author once took.** Test fixtures,
sample runs, seeded demo events — all are the author's hand, and all strip
before admission. (The adopter can add a manual trigger in one click if
they want one; the template cannot remove one it wrongly shipped from
every instance already adopted — the asymmetry decides who adds it.)

## Environment bindings resolve at adoption or don't exist

Concrete identifiers of the author's world — credential ids, account
names, machine paths, workspace ids, personal names in assignee fields —
have exactly two legitimate fates:

1. **Become a declared parameter or role**, resolved at adoption from the
   adopter's environment (a credential role the readiness matcher binds; a
   target the interview asks for).
2. **Not exist in the payload at all.**

There is no third option in which the binding ships and "usually works".
An author-environment id in an adopted instance either dangles (points at
nothing in the adopter's world — visible failure, the good outcome) or
**collides** (points at something that happens to exist — the adopter's
credential #3 is not the author's credential #3, and now an automation
acts through the wrong account: the bad outcome, and the reason this rule
is a security rule, not a tidiness rule).

## The strip pass and the leak test

Portability is enforced, not hoped for, at two points:

- **A strip-and-lint pass at the admission door**: mechanical scanning of
  the payload for the known leak signatures — service names from a
  denylist, id-shaped fields whose referents are environment-local,
  trigger definitions of manual kind, personal identifiers. Mechanical
  checks are a floor; they catch the recurring classes, and each new leak
  class found in the wild extends the list (never narrows it to make a
  template pass).

  A warning earned by measurement: **the strip pass is itself a bulk edit,
  and bulk edits break invariants their authors aren't looking at.** The
  reference system's de-branding pass rewrote branded names to generic
  roles in question *defaults* but not in the matching *option lists*,
  leaving ten choice questions across eight live templates defaulting to
  values outside their own options — the portability discipline manufactured
  an anatomy defect (see [template-anatomy](template-anatomy.md)). The rule:
  a strip pass rewrites a *vocabulary*, so it must enumerate **every copy**
  of that vocabulary in the artifact — and the admission door's structural
  checks re-run after it, because a cleanup that can't break the template is
  a cleanup that was actually verified, not merely intended.
- **The bare-environment leak test** — the real gate: adopt the template
  into a **fresh environment containing nothing of the author's** and
  enumerate what breaks or dangles. This is the transplant test in
  miniature, and it obeys
  [gate-sees-target](../../_laws.md#gate-sees-target): the thing being
  gated is "behavior in an environment unlike the author's", so the gate
  must actually run in one. Testing portability in the author's own
  environment tests nothing — every leaked binding resolves there, which
  is precisely why leaks survive authoring in the first place.

## Portability is why generic reads as unfinished — resist the backfill

A well-stripped template can feel bland next to a demo: roles instead of
logos, placeholders instead of real channel names. The pressure to
"concretize" for demo appeal — re-adding a named service here, a sample
binding there — is the pressure to un-port the template, and it should be
answered at the right layer: demos get **demo environments** (where the
roles bind to real-looking services at adoption, as they would for any
adopter), not concretized payloads. The catalog's browse layer can carry
screenshots and copy per integration story; the payload stays generic.
That division — vivid catalog card, portable payload — gets both audiences
served without shipping anyone's office furniture.
