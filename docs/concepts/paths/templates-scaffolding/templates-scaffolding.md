---
layer: golden-path
subject: templates-scaffolding
status: forged
techniques:
  - template-anatomy
  - adoption-lifecycle
  - readiness-prerequisites
  - integrity-and-provenance
  - template-portability
  - catalog-curation
evidence:
  - src/features/templates/sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx   # the interview: dimension model, gating, blocked/remaining counts
  - src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts                          # readiness matching: block / auto-select / filter, alias-aware
  - src/lib/personas/templates/templateCatalog.ts                                                # the integrity gate that works: skip-with-reason at the catalog door
  - scripts/generate-template-checksums.mjs                                                      # one generator, two manifests (frontend + backend) — derivation named
counter_evidence:
  - src-tauri/src/commands/design/template_adopt.rs      # :34-72 — the autopsy comment of the deleted inert gate (manifest keyed path+whole-file, callers passed label+payload)
  - scripts/templates/development/dev-lifecycle-manager.json   # one of 8 templates / 10 select questions whose default is outside its own option list (de-branding drift)
deviations:
  - w11-templates-scaffolding   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Template & scaffolding systems

A template system ships **starting points**: cataloged, parameterized
descriptions of something the product can instantiate — an agent, a team, a
workflow, a project, a document — which a user browses, previews, and adopts
into a live instance. The defining condition of the subject is **authorship at
a distance**: the template's author is absent at the moment of use. They
cannot ask the adopter a clarifying question, cannot see the adopter's
credentials, services, or naming conventions, and cannot repair the instance
after it is born. Everything a live expert would do in conversation — ask
which variant you want, check that you have the accounts it needs, warn you
what won't work here — the template must carry **as data**: its interview,
its prerequisite list, its integrity story, its portability guarantees. A
template system is judged by how completely it survives its author's absence.

What is *not* this subject: mechanical derivation from a source of truth with
no human choice at the point of use (that is [codegen](../codegen/codegen.md)
— when nothing is asked, nothing is a template); importing an artifact that a
foreign tool authored under a foreign contract (import & normalization —
concurrent sibling — where the hard problem is understanding someone else's
shape, not parameterizing your own); snapshotting a live instance so it can be
restored ([versioning-snapshots](../versioning-snapshots/versioning-snapshots.md)
— a snapshot is a copy of a past, a template is a proposal for a future); and
a single built-in default configuration, which is not a catalog at all —
templates begin where there are *alternatives to choose among*.

## The template is a contract with its own options

A template is not a copy source; it is a **contract** in three layers:

- **Identity and browse metadata** — name, purpose, category, provenance.
  What the gallery renders; the layer that competes for the adopter's
  attention against every other entry.
- **The parameter surface** — the dimensions along which instances may
  differ: each dimension's question, its option list, and its default. This
  layer *is* the author's half of the interview they cannot attend.
- **The payload** — the material that becomes the instance once the answers
  are applied.

The contract's first obligation is to itself: **every default must name a
member of its own option list.** This sounds too obvious to state, and that
is exactly why it must be machine-checked — nobody reviews for it. A template
whose default lies outside its declared options is internally inconsistent in
a way no consumer can render faithfully: the picker offers A, B, and C while
the artifact silently means D; the preview shows one thing and the adopted
instance is another; and "accept the defaults", the single most common
adoption path, produces a configuration the interview never displayed. This
is not hypothetical: a measurement in the reference system found **ten
choice questions across eight live cataloged templates carrying exactly this
defect** — and the *cause* is the subject's best cautionary tale, because it
was another of this subject's own disciplines that introduced it: a
portability pass rewrote branded strings to generic roles in the **default**
fields but not in the **option lists**, and since answers were bound to
option label strings, every rewritten default silently left its own option
set. Two hand-maintained copies of one vocabulary, edited once. The invariant
therefore belongs in an admission gate rather than in an authoring guideline
— authors, generators, *and well-intentioned batch edits* all write templates,
and none of them re-checks membership by hand. The full anatomy
— dimension schemas, cross-dimension constraints, where the invariant is
enforced — is the [template-anatomy](techniques/template-anatomy.md)
technique.

## Adoption is a lifecycle, not a copy

The distance from "entry in a gallery" to "live instance doing work" is a
pipeline, and every stage exists to absorb a specific failure:

> **author/generate → admit to catalog → browse → preview → interview →
> review → adopt → live instance**

The load-bearing middle is the **interview**: a dimension model that maps the
adopter's answers deterministically onto concrete configuration. Answers are
facts about intent ("compact", "two reviewers", "cautious autonomy"); the
mapping turns them into the config deltas the payload needs. Keeping that
mapping explicit and deterministic — rather than scattering `if` logic through
the instantiation code — is what makes **preview honest**: the preview renders
the *mapped result*, the exact instance the current answers would produce, not
a stock screenshot of the template's happy path. A preview that shows anything
other than what "confirm" creates is an advertisement, not a preview.

Adoption itself is **transactional** — the instance, its sub-entities, and
its wiring appear together or not at all; a half-adopted template is the worst
outcome the pipeline can produce, because it looks like an instance and works
like a bug. And after adoption, the instance **divorces** the template: it
carries a provenance stamp (which template, which version, which answers) but
no live coupling — editing the instance must never write back to the
template, and updating the template must never mutate instances born from it.
The stamp is for forensics and offers, not for synchronization. The full
lifecycle — including generated drafts that precede cataloging, review trays
for comparing candidates, and re-adoption semantics — is the
[adoption-lifecycle](techniques/adoption-lifecycle.md) technique.

## Readiness is gated before adoption, not discovered after

Templates routinely require things the adopting environment may not have:
credentials, connected services, capabilities, sibling entities. The
principal-engineer rule is that **every such requirement is declared in the
template and checked before the adoption commits**, with a failed check
producing a *named prerequisite and a remedy path* — "this needs a messaging
credential; add one here" — never a generic refusal, and never the
alternative that actually ships when nobody designs this: the adoption
succeeds, the instance is born broken, and the missing credential surfaces
days later as an unattended 3 a.m. failure wearing the adopter's name. A
readiness gate converts a cheap guided fix at adoption time (human present,
context fresh, remedy one click away) into the *only* fix; skipping it
converts the same defect into an incident. The matching machinery — how
declared requirements are matched against a live
[credential vault](../credential-vault/credential-vault.md), the three-state
readiness verdict, and when degraded adoption is legitimate — is the
[readiness-prerequisites](techniques/readiness-prerequisites.md) technique.

## Integrity must actually gate

Cataloged payloads travel: they are generated, seeded, shipped in releases,
sometimes fetched. An integrity manifest — hashes of what the catalog should
contain — is the standard defense, and it has a signature failure mode this
subject must name because the reference system measured it end to end: **a
verifier keyed differently from its manifest is decoration.** If the manifest
records hashes of whole files by path, and the verifier is handed labels and
payload fragments, the comparison can never bind — and depending on which way
the miss falls, it passes everything or fails nothing, forever, silently. The
measured case passed **100% of adoptions** while verifying nothing, was
proven inert by tracing what each caller actually passed, and was then
deleted — callers verified first, so the deletion removed decoration rather
than protection. The law here is
[gate-sees-target](../_laws.md#gate-sees-target): the verifier must read the
same representation the manifest hashed, and a verification *mismatch* must
be spelled differently from a manifest that is merely *absent*. Manifest
design, verify-at-seed versus verify-at-adopt, and what a red verdict is
allowed to do are the
[integrity-and-provenance](techniques/integrity-and-provenance.md) technique.

## Portability: the author's environment must not leak

A template is written in one environment and adopted in many. Anything of the
author's world baked into the payload is a defect that only detonates
elsewhere: a **named service** where a generic role belongs ("notify the
messaging channel", never "notify on ServiceX" — the adopter may run a
different service, and naming one brands the template a mismatch for everyone
else); a **manual trigger** left from the author's testing, which after
adoption fires with the adopter's authority under nobody's intention;
**environment bindings** — identifiers, paths, account names — that must
resolve at adoption time from the adopter's world or not exist at all. The
discipline is a strip-and-resolve pass with a test to match: adopt the
template into a bare environment and enumerate everything that leaked. This
is the [template-portability](techniques/template-portability.md) technique.

## The catalog is a product, not a directory

Whatever accumulates, wins by default — and a template catalog accumulates:
every generation run, every experiment, every author's near-duplicate.
Curation is the standing decision of what the catalog *is for*: an admission
bar (self-consistency, portability, integrity — the gates above, applied at
the door), a taxonomy the browse surface can actually render, deliberate
deduplication of near-identical entries, and **retirement** — every entry
admitted with a way out, because a catalog that only grows converges on a
junk drawer with a search box. Counting the catalog honestly ("ready to
adopt" is a different number from "entries on disk") is part of the same
discipline. This is the
[catalog-curation](techniques/catalog-curation.md) technique.

## The techniques

- [template-anatomy](techniques/template-anatomy.md) — the three-layer
  contract: dimension schemas, option lists, the defaults-within-options
  invariant and where it is enforced, cross-dimension constraints, template
  versioning.
- [adoption-lifecycle](techniques/adoption-lifecycle.md) — the pipeline from
  generated draft to divorced instance: the dimension model, honest preview,
  review and comparison, the adoption transaction, provenance stamping,
  re-adoption.
- [readiness-prerequisites](techniques/readiness-prerequisites.md) —
  declared requirements matched against the live environment; the
  ready / blocked-with-remedy / degraded verdict; gate placement before the
  commit.
- [integrity-and-provenance](techniques/integrity-and-provenance.md) —
  manifests that bind to what verifiers actually read, seeding-time versus
  adoption-time verification, mismatch versus absence, the inert-gate
  autopsy.
- [template-portability](techniques/template-portability.md) — generic roles
  over named services, no baked triggers, environment bindings resolved at
  adoption, the bare-environment leak test.
- [catalog-curation](techniques/catalog-curation.md) — the admission bar,
  taxonomy and dedupe, retirement paths, counting the catalog with its
  predicate.
