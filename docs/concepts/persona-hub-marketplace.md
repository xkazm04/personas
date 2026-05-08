# Persona Hub — Public Marketplace (Shelved)

**Status:** Shelved — kept for future consideration. Originally backlog idea
`728d3714-persona-hub-a-signed-template` (generated 2026-05-07). On
2026-05-08 the engineering core (signing + lineage infrastructure) was
split into an active unclear-wins ticket, and the **public marketplace**
half — discovery, ratings, author profiles, moderation, hosting — was
shelved here. Revisit once the conditions in the decision gate (below)
are met.

---

## Vision

Open the curated catalog into a third-party marketplace where authors
publish Recipes / templates with cryptographic provenance, semver
pinning, fork lineage, and a public rating + usage feed. Persona Hub
becomes to AI agents what GitHub became to code — a defensible
network-effect moat.

## Why this is shelved (not active)

A marketplace is a **separate product**, not a feature. It requires:

- Hosting / CDN / listing service / search infrastructure.
- Author identity system (verified vs. unverified, abuse mitigation).
- Moderation policy + content takedown process.
- Rating manipulation defenses.
- Legal: TOS, content policy, regional regulation (EU AI Act, DMCA, etc.).
- Forever maintenance commitment — closing a marketplace later harms the
  brand more than never opening one.

None of that is in the original idea, and committing to all of it
without an adoption signal is a textbook build-it-and-they-will-come bet.

## What's already done (engineering foundation)

The signing + lineage infrastructure is in active backlog as
`unclear-wins/idea-728d3714-persona-hub-a-signed-template`. That work
delivers:

- Author Ed25519 keypair management (OS keychain).
- Author-signed manifests with `parent_hash` for fork lineage.
- Semver pinning + min-schema-version checks.
- Private (per-team / self-hosted) "trusted source" listing endpoint.

By the time the marketplace question is revived, the signing layer is
already in production. The marketplace becomes a UX-and-discovery
problem, not an engine-redesign problem.

## Cross-link: Recipe redesign

`project_recipe_redesign` memory (Recipe = shareable Persona Use Case)
is the **prerequisite** for any marketplace work. The marketplace
distributes a unit; the Recipe redesign defines what that unit is.
Triaging the marketplace before Recipe redesign settles risks building
distribution for the wrong primitive.

When this concept is revived, the first step is **not** marketplace
design — it's confirming that the Recipe redesign produced a stable,
shareable, signable unit. If yes, proceed. If the redesign settled on
something else (or left sharing ambiguous), iterate the Recipe layer
first.

## Decision gates before re-opening this

Pick this back up only if **all** are true:

- [ ] Recipe redesign has shipped and Recipes are the agreed shareable
  unit.
- [ ] Phase 1–4 of `unclear-wins/idea-728d3714` have been in production
  for at least one full release.
- [ ] There's a measured adoption signal — at least N teams (suggest:
  ≥ 5 distinct organizations) using the private listing endpoint, with
  recurring requests for "can other people / the public see this?"
- [ ] A real moderation/trust&safety design exists (not a feature
  spec — a policy doc with an owner).
- [ ] A go-to-market plan exists for the cold-start problem (seed
  authors, seed content, distribution channel).

If the first three are true but the moderation + GTM work isn't done,
that's the work to do before any marketplace UI gets built. Without
those two pieces, the "magic moment" of opening the marketplace
becomes a fire-fighting moment instead.

## Risks worth re-reading when revived

1. **Trust & safety asymmetry.** A signed template is *attested*, not
   *safe*. A bad-actor template can social-engineer credentials,
   exfiltrate Memory contents, or chain into harmful actions even with
   valid signatures. Provenance proves who, not what.
2. **Cold-start.** Marketplaces with low traffic stay low-traffic.
   Without seed authors + content before launch, the marketplace
   undermines the brand.
3. **Forever cost.** Once opened, you own moderation. Closing later is
   more expensive than never opening.
4. **Existing template guardrails amplify.**
   `feedback_template_messaging_generic` (generic messaging roles only),
   `feedback_template_manual_trigger` (no manual triggers in templates),
   `feedback_template_review_memory_pattern` (review must persist to
   Memory) — these all become enforcement surfaces in a marketplace
   context, not just authoring conventions.

## Alternative shapes worth considering when revived

- **Federated, not centralized.** Each team runs their own listing
  endpoint; clients aggregate from a list of trusted endpoints. No
  central marketplace, no single moderation surface, no
  cold-start problem. Less network-effect moat but much lower forever
  cost.
- **Discovery-only marketplace.** No hosting — manifests live in user
  GitHub repos / IPFS / personal sites. Persona Hub indexes, rates,
  and links. Drastically reduces moderation surface.
- **Curated tier.** Public marketplace stays curated (today's model),
  signing infrastructure enables third-party "verified author"
  badges on user-submitted templates. Halfway between curated catalog
  and full marketplace.
