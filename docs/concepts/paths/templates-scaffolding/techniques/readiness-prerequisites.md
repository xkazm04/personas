---
layer: technique
subject: templates-scaffolding
technique: readiness-prerequisites
status: forged
laws: [gate-sees-target, failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Readiness prerequisites

A template's payload routinely assumes things the adopting environment may
not have: credentials for external services, connected integrations,
sibling entities, platform capabilities. Readiness is the discipline of
**declaring those assumptions in the template and checking them before the
adoption commits** — because the two possible failure sites are wildly
asymmetric in cost:

- **At adoption time**: a human is present, context is fresh, the remedy is
  one guided click away ("this template needs a messaging credential — add
  one here"). Cost: a minute, inside a flow built for it.
- **After adoption**: the instance is born broken and *looks finished*. The
  missing credential surfaces at first unattended run — a 3 a.m. failure
  under the adopter's name, diagnosed from a log, by someone who has
  forgotten the adoption ever happened. Cost: an incident.

A readiness gate is the mechanism that keeps every such defect at the first
site. Skipping it doesn't remove the check; it moves the check to
production and reassigns it to the on-call.

## Requirements are declared as roles, matched as facts

The template declares **requirements**, not bindings: "a credential able to
send messages", "a connection to an issue tracker", never "credential
#4711" or a named account (that distinction is
[template-portability](template-portability.md)'s; readiness consumes it).
Each requirement is a small, matchable record: the **role** it plays in the
payload, the **capability** it must have, and whether it is **required or
optional** for the instance to function.

The gate then matches declared requirements against the live environment —
typically the [credential vault](../../credential-vault/credential-vault.md)
and the connected-integration registry. Matching rules that earn their
keep:

- **Match on capability, not on name.** The adopter's credential is called
  whatever they called it; the matcher asks "can this act in the declared
  role", using the same metadata the vault maintains for its own purposes
  (service, scopes, health).
- **Prefer verified-healthy candidates, and say when you couldn't.** A
  credential the vault has marked broken satisfies nothing; one the vault
  could not verify is a *provisional* match, and the verdict says so —
  readiness inherits the vault's three-state honesty rather than flattening
  it into found/not-found.
- **The gate must check what adoption will actually use**
  ([gate-sees-target](../../_laws.md#gate-sees-target)). If the gate
  matches against one registry and the instantiation resolves bindings
  from another — or matches "some credential exists" while the payload
  needs a specific capability that candidate lacks — the gate passes
  exactly when it shouldn't. The matcher and the adoption-time resolver
  must be the same logic or provably the same query, not two teams'
  approximations of each other.

## The verdict is three-valued, and each value has a next action

Per requirement, and rolled up per template:

| Verdict | Meaning | Surface behavior |
| --- | --- | --- |
| **ready** | every required role has a satisfying, preferably verified candidate | adopt proceeds; matched bindings shown for confirmation |
| **blocked** | a required role has no candidate | adoption is prevented; the block **names the requirement and links the remedy** — the add-credential / connect-service flow, pre-filled from the declared role |
| **degraded** | required roles satisfied; optional ones not, or matches are unverified | adoption proceeds with an explicit notice of what won't work and what to add later |

Two spelling rules keep the verdict honest
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

- **"Blocked" is never generic.** A refusal without the requirement's name
  and a remedy path is indistinguishable from a bug in the gate, and
  adopters treat it as one. The whole value of declaring requirements as
  data is that the block message writes itself.
- **"The gate could not run" is not "ready".** A matcher that errors — the
  registry unreachable, the vault locked — must not fall through to a
  green verdict. Readiness computed over an unreadable environment is the
  gate lying in the direction that costs the most.

The verdict vocabulary is defined once and every surface derives from it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
the gallery badge ("needs setup"), the pre-adoption panel, the adoption
button's enablement, and any bulk-adoption tooling must all read the same
three states from the same evaluator — a gallery that computes its own
simplified readiness will disagree with the gate on exactly the entries
that matter.

## Placement: before the commit, visible before the attempt

The gate runs **inside the adoption flow, before the transaction** — that
is its enforcement point. But readiness is also *browse-time information*:
surfacing "needs a messaging credential" on the catalog card lets the
adopter pick a template they can actually run, or fix the environment
before investing in the interview. Same evaluator, two render points. The
browse-time render is advisory (the environment can change between browse
and adopt); the pre-commit run is the one that gates. Evaluating only at
browse time and trusting it at commit time is a time-of-check race wearing
a UX improvement's clothes.

## Degraded adoption is legitimate; silent degradation is not

Some templates are genuinely useful at partial readiness — the instance
does local work now, and grows into its integrations later. Supporting
that is good product judgment, under two conditions: the degradation is
**declared** (the notice enumerates the unsatisfied optional roles), and it
is **durable** — the instance itself records which roles went unbound, so
the "finish setting this up" surface can exist after the adoption flow is
gone. An instance that silently dropped three optional capabilities at
adoption, with no record, presents later as "this template is worse than
advertised" — a curation reputation cost paid for a readiness shortcut.
