---
layer: technique
subject: hitl-approval
technique: consent-gates
status: forged
laws: [gate-sees-target, identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Consent gates

The review flow gates what a machine *made*; the consent flow gates what a
machine *wants to do*. Here the machine is the asking party: before acting, it
presents the intended action to a human and proceeds only on authorization.
Consent gating is what separates an agent that is trusted from an agent that
is merely unsupervised — and its three instruments are first-use consent,
informed consent with impact disclosure, and the autonomy dial.

## First-use consent

The first time an agent exercises a capability — a new connection, a new
action class, a new target system — is categorically different from the
hundredth. The human has never seen this agent do this thing; no track record
exists; the trigger is *novelty itself*, independent of the action's inherent
risk. First-use consent formalizes that:

- **The first use asks. The grant is recorded. Subsequent uses within the
  granted scope proceed silently.** This is the single best fatigue trade in
  the subject: one question purchases an unbounded stream of ungated repeats,
  and the human's answer is given at the moment their attention is genuinely
  warranted.
- **The scope of "subsequent" is the design decision.** A grant is keyed to a
  tuple — which agent, which capability, which target — and the width of each
  axis is chosen deliberately. Granting *this agent, this capability, any
  target* is very different from *this agent, this capability, this target*;
  collapsing the tuple to just the capability quietly licenses every agent
  forever. Record the tuple with the grant so the check is mechanical.
- **Grants can expire and be revoked.** A standing grant is created state and
  names its reaper
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)): an expiry,
  a revocation surface, or both. Revocation takes effect at the gate — the
  next attempted use finds the grant gone and asks again — never at the
  machine's discretion or on its next convenient boundary.

## Informed consent: disclosure in units of consequence

Consent to a vague description is not consent. The disclosure shown at ask
time must be specific enough that a "yes" is a decision about *this action*:

- **What will be done** — the operation, with its actual parameters bound,
  not a category name. "Send a message" is a genre; "send this text to these
  three recipients" is an action.
- **To what and whom it is visible** — the targets, and whether the effect
  leaves the boundary (external visibility is one of the mandatory-gate
  categories, and the disclosure is where it becomes concrete).
- **What it costs** — spend, quota, capacity, in the units the human budgets
  in.
- **Whether it can be undone** — reversible, reversible-at-cost, or
  irreversible, stated plainly. Irreversibility changes what a reasonable
  person approves.

Two structural rules keep disclosure honest:

1. **The disclosure derives from the bound action, not from the asker's
   self-description.** The gate renders what will actually execute — the
   staged parameters — because a narrative written by the party seeking
   consent is exactly the artifact that drifts from the truth when drift
   pays ([gate-sees-target](../../_laws.md#gate-sees-target)).
2. **Consent binds to the disclosed parameters.** If anything material
   changes between consent and execution — a recipient added, an amount
   raised, a target swapped — the consent is void and the gate re-asks
   ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
   check is mechanical: capture the parameter fingerprint at ask time,
   re-verify at execution.

## Consent already spoken

The cheapest question is the one that never needs asking: **when the human's
own instruction unambiguously names the answer, the gate may open on that
instruction** — "do this without asking me" is consent to not being asked;
"send it every morning" is consent to a schedule. This is legitimate fatigue
reduction, not a bypass, under two disciplines. First, **conservative
reading**: the instruction must name the answer, not merely gesture at it —
when in doubt, ask. Second, **ambiguity re-closes the gate even when the
words match**: if the named action resolves to several possible targets (two
credentials for one service, two destinations with one name), a keyword match
is not an answer, and proceeding on an arbitrary pick means the human learns
which one was chosen only from the audit trail. The same principle covers the
manual path: a human directly invoking an action *is* the approval of that
invocation — gating a hand-fired action asks the person to consent to their
own click.

## Re-asking is not first-asking

A one-time consent question has **three states, not two**: never-asked, yes,
and no — and the storage must keep all three distinct, with *absence meaning
ask, never proceed*. The state matters most at the re-ask: when a gate
legitimately re-opens (the disclosure changed, the scope widened), the human
has already spoken, and the surface must **pre-fill from the stored answer**.
A re-opened gate that initializes its controls from defaults does not collect
a new answer — it overwrites the old one, and a person who once refused finds
their refusal converted to a grant by a single click on a button that never
mentioned the subject. Every read of a stored consent fails closed, error
paths included: the conditions under which storage breaks must not be the
conditions under which a refusal silently becomes permission.

## The autonomy dial

Between "ask before everything" and "ask before nothing" lies a graduated
setting, and making it an explicit dial — rather than an emergent property of
scattered flags — is what makes autonomy governable:

- **Positions are enumerated contracts.** Each position names which action
  classes proceed silently, which ask, and which are refused outright. The
  human reads the position and knows what the machine may do tonight; vague
  intermediate settings ("balanced") that no one can enumerate are trust
  theater.
- **The dial ratchets asymmetrically.** Turning autonomy *down* takes effect
  immediately and unconditionally. Turning it *up* is itself a consequential
  action — disclosed, recorded, and ideally scoped or time-boxed rather than
  permanent (a full opening of the dial is [unattended-mode](unattended-mode.md),
  which carries its own contract).
- **The dial is read at the gate.** The setting is stored where the
  checkpoint reads it, so a change applies to the very next action. A dial
  the machine caches at start-up is a dial that revocation cannot reach.

## Consent does not creep

The quiet failure of consent systems is scope inflation: a grant given for
one thing, honored for a category. The rule is the decision-record reuse
boundary applied to the forward flow — **a consent is a fact about the tuple
it names, and any wider reading is a new question**. Approval to act on one
target is not approval for the target class; consent granted to one agent
does not transfer to another agent using the same capability; a grant made in
one context (a project, a workspace, a session type) stops at that context's
edge. When the machine is unsure whether an existing grant covers the current
action, the answer is structural, not judgmental: if the tuple does not
match, ask. One redundant question costs a click; one assumed consent costs
the trust the entire mechanism runs on.

## Refusal is an answer

A consent gate that only knows "yes" and "not yet" trains the machine to
re-ask until it wins. "No" is a durable verdict: recorded like any decision,
suppressing re-asks for the same tuple (permanently, or until the human
revisits), and — when the refusal carries a reason — feeding the trigger
tuning that keeps the ask rate honest. An agent that re-asks a refused
question on every run is performing fatigue-farming, and the gate, not the
agent's manners, is where that gets stopped.
