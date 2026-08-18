---
layer: technique
subject: connector-catalog
technique: schema-driven-forms
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target, creation-names-reaper]
shared_with: []
---

# Schema-driven forms

Credential acquisition is the catalog's highest-traffic UI, and the technique
that keeps it maintainable is rendering **every** connector's form from the
row's declared auth schema — one generic renderer, N declarations — instead
of one hand-built form per service. With dozens of connectors, hand-built
forms guarantee drift: the form asks for a field the schema dropped, or the
schema gains a field no form collects. The declaration is the single
authority ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to a field vocabulary), and the form is a *reader*.

## What the declaration must carry

A field entry needs enough for the renderer to do the whole job:

- **key** — the machine name the stored credential will carry; stable,
  never derived from the label.
- **type/widget** — text, secret, multiline, choice, numeric, toggle; the
  renderer maps type → widget, so a new widget benefits every connector.
- **secret flag** — drives masking, storage sealing, and redaction; a
  mis-flagged field is a disclosure, so default to secret when unsure.
- **required flag and validation** — format hints (prefix, length, pattern)
  catch paste errors *before* a network round-trip; keep them advisory
  enough to survive provider format changes.
- **label, placeholder, help** — the acquisition moment is where users are
  most lost; a one-line "where to find this" with a deep link outperforms
  any documentation page. These are translatable presentation, distinct
  from the key.
- **options** — for choice fields: value + label pairs, values being machine
  tokens with the same stability obligation as keys.

Ordering matters more than it looks: declaration order is presentation
order, so the schema author — not the renderer — owns the narrative of the
form ("token first, then the workspace it belongs to").

## Overrides are registered, never forked

Some connectors genuinely need more than generic rendering: a guided
walkthrough for finding a token, a discovery step that fetches selectable
workspaces once a key is entered, a field that reveals itself conditionally.
The disciplined shape is a **per-connector override registered under the
catalog identity** — a slot the generic renderer consults ("does this
connector register a custom step for this field / this phase?") — with two
hard rules:

1. **The declaration remains the authority on shape.** An override changes
   *how* a declared field is collected, never *which* fields exist. The
   moment an override collects an undeclared field, storage, redaction, and
   probing are blind to it — the drift the technique exists to prevent,
   reintroduced through the escape hatch.
2. **Overrides are enumerable.** A registry of overrides can be audited
   ("which connectors deviate, and why"); ad-hoc conditionals inside the
   renderer cannot. When the registry grows past a small fraction of the
   catalog, that is the signal the *declaration language* is missing a
   feature (conditional visibility, discovery steps) that should be promoted
   to a declarative attribute all rows can use.

## Three more readers of the same declaration

The form is only the most visible consumer. The declaration must demonstrably
feed:

- **Validation at the storage door** — required/format rules enforced where
  the credential is admitted, not only in the UI, because the UI is never
  the only writer (imports and automation create credentials too).
- **Redaction** — the secret flags are the redaction policy's source of
  truth; surfaces render metadata freely *because* the flags say which
  fields never leave the sealed store.
- **The probe** — the connection test substitutes declared fields into the
  probe recipe. This is where the technique has its sharpest measured
  failure: the **vacuous green**.

## The vacuous green

A probe template that references **no declared field** — no substitution, no
auth header derived from the credential — succeeds for any typed value: it
tests the provider's uptime, not the user's credential
([gate-sees-target](../../_laws.md#gate-sees-target): the gate exists to
verify the credential, so the credential is what it must exercise). The
failure is quiet and compounding when saving is gated on probe success: the
green tick becomes the mechanism that admits broken credentials, with the
user's trust attached. The defense is a **seed-time cross-check of the pair**
(declared fields, probe recipe): every connector that declares fields must
reference at least one of them — or an auth construct derived from them — in
its probe, and a connector that legitimately has no fields is explicitly
marked unauthenticated rather than passing by accident. This is an intra-row
consistency rule; no per-field validation can express it, which is why it is
so commonly missing.

## When acquisition mints a row, failure must reap it

Operator-defined connectors invert the usual order: the form's save creates
*both* a new catalog row and its first credential, as one logical act. The
pair has a failure seam — row created, credential save fails — and the seam
must be closed at design time: the failed save deletes the just-minted row,
and because that rollback is itself fallible, its failure is at least
recorded rather than swallowed. Otherwise every transient save error strands
an orphan row in the catalog: a type with zero instances, offered forever in
pickers, indistinguishable from a curated entry. The reaping is named at the
creation site
([creation-names-reaper](../../_laws.md#creation-names-reaper), applied to
registry rows born as a side effect).

## The acquisition moment is a trust ceremony

Last, the non-mechanical part. The credential form is where a user hands the
product a live secret, and the form's demeanor is the product's security
posture as far as they can see. Secrets are masked as typed with a deliberate
reveal; nothing is echoed back after save (confirmation is by identity and
health, never by value); a failed probe distinguishes "the provider rejected
this credential" from "the provider could not be reached" so the user is not
sent to rotate a key that was fine. These behaviors are cheap individually;
their consistent presence across every connector is exactly what the
schema-driven approach buys.
