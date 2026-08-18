---
layer: technique
subject: schema-driven-ui
technique: action-consent-wiring
status: forged
laws: [gate-sees-target, one-authority-per-vocabulary]
shared_with: []
---

# Action consent wiring

A spec may propose actions; a spec may never perform them. This technique is
the wiring that keeps that sentence true from the document format down to the
click handler.

## Actions are references, not code

An action in a spec is a **reference into an allowlisted action vocabulary**
plus typed parameters: `{ action: "retry-job", params: { jobId } }`. It is
never code, never a command line, never a request the renderer issues, never
an expression evaluated at render. The action vocabulary is registered
host-side exactly the way node kinds are registered — one authority, closed
set, typed parameter contract per action — and it is documented to the emitter
from that same registration, so the emitter proposes only what exists.

What an action reference may carry as parameters is deliberately narrow:
entity identities and enum choices — things the spec legitimately knows.
Parameters that are themselves instructions (a shell string, a query to run, a
path to write) do not belong in the parameter contract at all; an action whose
parameters are a program is code execution with a consent sticker on it.

## Rendering never executes

The renderer's realization of an action node is entirely inert: a control that
*describes* the proposal. Three rules enforce inertness:

- **No execute-on-mount kinds.** No node runs anything by appearing —
  no auto-firing action, no "run this when shown" hook. The moment rendering
  can cause execution, every influence on the emitter (including content the
  emitter read from outside) becomes a remote-execution vector, and the
  entire injection analysis of the subject collapses.
- **Resolution before arming.** At validation time the action reference is
  resolved against the registry: unknown action, malformed parameters, or a
  parameter referencing a dropped node renders the control **disarmed** —
  visible as a proposal, inoperable as a control, with the reason available.
  Disarm-by-default means a half-valid proposal degrades to information, not
  to a button that does something other than its label.
- **The handler comes from the host.** The renderer does not know how to
  perform any action; it surfaces the user's intent ("this proposal was
  accepted") to a handler injected by the host
  ([host-capability-injection](host-capability-injection.md)). A renderer
  with no ambient authority has nothing for a hostile spec to steal.

## Consent is the host's gate, and the gate sees the target

Between "user activated the proposal" and "the action runs" sits the host's
consent machinery — the same gates every other machine-initiated action in the
product passes, owned by
[hitl-approval](../../hitl-approval/hitl-approval.md) /
[consent-gates](../../hitl-approval/techniques/consent-gates.md). The wiring
requirement this side owes that gate: **what is displayed for consent is what
will execute.** The confirmation renders from the *resolved registered action
and its validated parameters* — not from the spec's display text. A spec that
labels a button "dismiss" over an action reference that deletes must be
impossible by construction, which it is exactly when the consent surface is
derived from the resolution, not the proposal's self-description. A gate shown
a proxy of the action passes precisely when proxy and action diverge — the
case it exists for.

Proportionality belongs to the gate, not to this technique: reversible
low-stakes actions may be configured to flow with lightweight confirmation,
destructive ones demand explicit review. The spec side's obligation is only
that every action carries enough typed identity (action id, parameter values,
provenance of the spec that proposed it) for the gate to make that call and
for the decision record to be attributable.

## Audit and provenance

Every executed action records: which spec proposed it (document identity and
version), which node, what the user was shown, and the decision. Spec-proposed
actions are machine-suggested by definition, and when one turns out to be
wrong the question "what did the surface claim at the moment of consent?" must
have a stored answer. This is the same decision-record discipline the consent
subject owns; the spec side's contribution is stable node identity, so the
record can point at the exact proposal even after the document is recomposed.
