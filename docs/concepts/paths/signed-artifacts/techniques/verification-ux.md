---
layer: technique
subject: signed-artifacts
technique: verification-ux
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Verification UX

Verification is not a backend fact; it is a **user-facing outcome**, and the
moment a person sees a verdict about an artifact, the verdict's vocabulary
becomes a security control. This technique owns that vocabulary and the
surfaces that render it.

## Three states, or the UI lies

A verification outcome has exactly three honest states:

- **Verified** — the signature checks out against a key this install trusts,
  and the content matches what was signed. Green, with the signer's name —
  *from the trust store, not the envelope*.
- **Tampered** — a trusted signer's signature exists, and the content or
  signature check failed against it. Red, loud, with which check failed:
  content changed since signing, or signature not sound.
- **Unverifiable** — no claim can be tested: there is no signature, or the
  signer is unknown to this install, or the check itself could not run. Its
  own visual state — muted, "unknown", question-marked — never green, never
  red.

This is the same discipline health-checks proved as
[three-state-outcomes](../../health-checks/techniques/three-state-outcomes.md),
transplanted to a boundary with one crucial difference: there, the third
state is a degraded prober; here, **unverifiable is the default first-contact
experience**. Every artifact from a signer you have not yet paired with lands
in it. That makes both collapses more expensive than usual
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

- **Unverifiable → tampered**: every stranger's legitimate artifact renders
  as an attack. Users are trained within days that red means "probably just
  someone I haven't paired with", and the one red that is a real tamper
  arrives into a room that has stopped believing red.
- **Unverifiable → verified**: a green check vouches for a stranger, and the
  attacker's self-declared display name is rendered under it. This is the
  worse collapse, because it converts the system's most trusted pixel into
  the attack surface.

## The verdict type is upstream of every pixel

A UI cannot render a distinction the result type does not carry. If the
verdict crossing the boundary is one boolean, the dialog has two colors and
two strings, and no amount of frontend care recovers the third state — the
fix is a type fix first. The verdict type carries: each component fact as its
own field (content unchanged? signature mathematically sound? signer known
and trusted?), the signer identity *as resolved by the verifier*, and a
reason string for the could-not-run case. Model the three states as one
closed vocabulary that every consumer — badge, dialog, list row, log line —
derives from
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The copy deck is a consumer too: a translation catalog holding only
"valid" / "invalid" tokens has hard-coded the collapse at the string layer,
and whoever adds the third state must add its words in the same change.

## Decompose the verdict for the human

Beyond the headline state, show the component facts as separate labeled rows:
content integrity (unchanged / modified), cryptographic signature (sound /
failed), signer (trusted name / unknown identity). Two reasons. First,
mixed outcomes are diagnostic — "content modified, signature sound" means the
file changed after signing; "content intact, signature failed" smells like a
splice or a wrong-key check; the combination tells the user which repair to
reach for. Second, decomposition keeps the headline honest: a UI forced to
render each fact separately cannot quietly AND them into one optimistic
boolean.

## Consent to proceed must name the specific danger

Sometimes the user may legitimately proceed past a non-verified verdict —
importing from a colleague they trust out-of-band, restoring their own old
backup. The consent affordance for that has three rules:

1. **It names the danger, specifically.** "This artifact appears tampered"
   and "this signer is unknown" are different risks with different rational
   responses; one acknowledgment must not unlock the other. The consent is
   *kind-matched*: the user confirms the exact condition the current preview
   surfaces.
2. **It re-arms when the facts change.** If the artifact, the signer's trust
   state, or the verdict changes under an open dialog, any prior
   acknowledgment is dropped. Consent given to one danger context must never
   carry over to a freshly-rendered different one.
3. **It is visually the exception.** The proceed-anyway control renders as
   the dangerous path (destructive styling, disabled until acknowledged),
   never as the default button a rhythm-clicking user hits.

## Badges: provenance at a glance, silence done honestly

Lists and file browsers surface provenance as badges — signed, verified,
unknown — so provenance is ambient rather than buried in a dialog. Two
disciplines: a badge derives from the same closed vocabulary as the dialog
(no parallel hand-rolled mapping that drifts to a fourth meaning), and the
*absence* of a signature renders as calm absence, not as warning — most files
are unsigned, and crying wolf over every one of them spends the alarm budget
the tampered state needs. Absence of a badge must also be distinguishable
from "badges have not loaded yet": an empty set during loading means
*unknown*, and consumers that treat it as *unsigned* will flash every file as
unsigned on each mount.
