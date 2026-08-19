---
layer: technique
subject: authorization
technique: scope-design
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Scope design

A scope is a named capability attached to a grant: "holders of this grant
may perform actions of class X" or "…on resource instance Y". Scopes are the
fine-grained axis of authorization — tiers grade how trusted a channel is;
scopes bound what a particular grant may cause. This technique is about
making scope strings behave like what they are: **contracts whose
enforcement point is known, whose vocabulary is owned, and whose combination
rule is intersection**.

## The vocabulary is owned

Every scope string that can appear on a grant is defined in one registry
with a stated meaning and a stated enforcement point
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The registry is the defense against the two standard decay modes:

- **Orphan scopes** — defined, issued on grants, checked nowhere. An orphan
  scope is worse than no scope: reviewers, integrators, and the UI all
  believe a restriction exists that the runtime does not enforce. The
  registry makes this auditable — every scope names the gate that checks
  it, and a scope with no named gate fails the registry's own review.
- **Improvised scopes** — a string invented at a call site because the
  vocabulary didn't have the right word. Enforcement of a vocabulary nobody
  can extend through a front door produces extension through the back door.
  The registry must therefore be cheap to extend *deliberately*: adding a
  scope is a small reviewed change, not a design summit — but it is a
  change to the registry, never a string literal born in a handler.

Shape the vocabulary hierarchically — `domain:action` at minimum,
`domain:action:instance` where grants bind to individual resources — so
that a grant can carry either a class capability or an instance pin, and a
reader can tell which without a lookup table.

## Matching is exact, or it is a vulnerability

Scope comparison is **exact string equality** on canonical forms — no
substring matching, no case folding, no prefix convenience. Every
softening that has ever been added to a scope matcher for ergonomics has
the same failure signature: an identifier that *contains* another
identifier, or differs only in case, silently satisfies a check it should
fail. Instance-scoped grants make this concrete: a pin on resource `7` must
not authorize resource `70`, which is exactly what suffix-free substring
matching yields. If hierarchy is needed ("this scope implies that one"),
implication is declared **in the registry** as data and expanded at check
time by the one matcher — never inferred from string shape at N call sites.

Wildcards deserve the same suspicion as matcher softening. A wildcard grant
("all instances of class X, present and future") is sometimes the honest
requirement, but it is a different *contract* than a list of pins — it
covers resources that did not exist when the grant was reviewed — so it is
a distinct registry form, visibly different on the grant record, never the
degenerate case of an empty pin list. The empty list must mean *nothing*,
not *everything*; a parser that collapses "no pins recorded" into
"unrestricted" has built the widening bug into the data layer.

## Intersection is the only combination rule

Effective capability for an action =
**what the caller's grant carries ∩ what the resource's own policy
permits.** Both sides are ceilings; neither is a floor:

- A broad grant meeting a resource pinned to a narrower use gets the pin.
- A narrow grant meeting a permissive resource gets the grant.
- Anything outside the intersection is refused **at the gate**, with an
  error that names the missing side — a scope failure diagnosed at the door
  costs a log line; the same failure surfaced as a generic downstream
  rejection two systems later costs a support session.

The check evaluates against **current recorded capability**, not a copy
captured when the caller was wired
([gate-sees-target](../../_laws.md#gate-sees-target)). Grants narrow over
their lifetime — users revoke, policies tighten, re-issuance resets to
defaults — and a check against the stale copy passes precisely when the
grant has narrowed, which is the moment the check existed for.

## Minimization at grant time

Every scope on a grant is standing risk: the cost of a leaked or confused
grant is exactly its scope set. The issuing discipline:

- **Grants are requested with a purpose, and the purpose bounds the set.**
  A consumer wired for reading one resource class requests — and receives —
  that scope, not the issuer's full palette. Default-broad issuance is
  default-allow with a delay fuse.
- **The broad grant is the exception that carries its justification.** An
  "everything" grant sometimes has a real job (a trusted first-party
  surface). It is issued as its own visible form, not as the quiet default,
  so the audit question "which grants could do anything?" has a short,
  intentional answer.
- **Narrowing is routine; widening is review.** A grant's scope set
  shrinking should be a no-ceremony operation (encouraging cleanup);
  widening one is a security decision with the same weight as issuing a new
  grant. In practice mature systems converge on **immutable grant records**
  — narrowing is "mint narrower, revoke old", widening is "mint a different
  grant" — and that shape is fine: what the rule demands is that the
  *narrowing operation* be cheap and the *widening operation* be visible
  and recorded, not that grant rows mutate in place. The trap to reject is
  the middle state where neither exists and the only expressible change is
  revocation — then nobody narrows anything, ever, because the only tool is
  a hammer.
- **Grant issuance is itself a scoped power.** The operation that mints
  grants or derives narrowed handles is the most sensitive scope in the
  vocabulary, and a derived handle must never carry it — a handle that can
  mint further handles is not narrowed, it is a self-replicating copy of
  the issuer.

## Scopes at the brokered boundary

Where the application exercises stored credentials on behalf of callers,
scopes are the language both subsystems speak: the caller's grant carries
scopes, the credential's own record carries its capability and any
per-resource pins, and the brokered door computes the intersection before
any secret is touched. The door and the custody discipline belong to the
credential-vault subject
([brokered-egress](../../credential-vault/techniques/brokered-egress.md));
the vocabulary, the matcher, and the intersection rule the door applies are
this technique. One matcher serves both — a second matcher implemented
inside the door is the
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
violation that eventually lets the two doors disagree.
