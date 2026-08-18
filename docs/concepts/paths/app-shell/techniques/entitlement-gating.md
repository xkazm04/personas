---
layer: technique
subject: app-shell
technique: entitlement-gating
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Entitlement gating

Tiers, feature flags, roles, and platform capabilities decide what the
navigation offers each user. This technique owns the three-way rendering
decision (hidden / locked / enabled), the upsell affordance, and the
structural rule that makes the whole thing sound: the nav renders policy, it
never *is* the policy.

## One policy authority, many rendering surfaces

The question "may this user reach this section?" has exactly one
authoritative answerer — a policy function over (user entitlements, feature
flags, platform) — and the nav is only one of its consumers. The others are
the router (deep links), the command surface (palette entries, shortcuts),
programmatic navigation (a notification tapping through to a section), and
any "go to X" affordance a page grows.

This is where nav gating classically fails: the nav entry is hidden by its
own inline check, while the destination remains reachable through a door
that never heard of the check. Hiding the entry gates the *advertisement*,
not the *destination* — a gate that observes a proxy passes exactly when the
proxy diverges from the target
([law: a gate must see its target](../../_laws.md#gate-sees-target)). The
structural fix: the same policy authority is consulted at every entrance,
and arriving at a forbidden destination lands on a defined explanation
surface (what this is, why you cannot enter, what would change that) — never
a blank page, never a crash, and never silent access.

Entitlement requirements live in the navigation registry alongside each
section's other metadata — one vocabulary, one place where a section's
requirement is declared
([law: one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).
An entry whose requirement is declared in the registry while its route
checks a hand-copied constant is two policies waiting to disagree.

## Hidden, locked, enabled — the decision is about knowledge

The three-way choice is decided by whether *knowing about the feature*
serves the user:

- **Hidden.** The feature does not exist for this audience and no action of
  theirs changes that: internal tooling, sections inapplicable to the
  platform or deployment, flags for unreleased work. Showing these is noise
  at best and a support burden at worst. Hidden entries leave no residue —
  no gap, no grayed ghost.
- **Visible but locked.** The feature exists, the user's current plan or
  role does not include it, and there is a path from here to there
  (upgrade, request access). The entry stays on the map *because the map is
  how they learn the product has this territory*. Locked entries are
  honestly marked — a lock affordance, not a normal entry that rebuffs on
  click — and activating one opens the explanation/upsell surface rather
  than pretending to navigate.
- **Visible and enabled.** The ordinary case.

The choice between hidden and locked is a product decision per feature, but
it must be *made*, not defaulted: an all-hidden posture makes tiers
invisible (users cannot want what they cannot see), and an all-locked
posture turns the nav into a brochure of things the user cannot do.

## The locked affordance is honest and proportionate

- **Locked is stated where it is seen.** The marker rides on the entry
  itself; discovering the lock only after a click is a small betrayal
  repeated forever.
- **The explanation names the terms.** The surface behind a locked entry
  says what the feature is, which plan or permission unlocks it, and offers
  the one action that starts that path. It does not guilt, nag on a timer,
  or interrupt unrelated work — the user opened it; that is the whole
  consent model.
- **Lock state is not disabled state.** Disabled communicates "temporarily
  not applicable"; locked communicates "not in your plan". Rendering locks
  as disabled entries teaches users the product is broken.

## Policy changes while running

Entitlements change mid-session: an upgrade completes, a trial expires, an
admin revokes a role, a flag flips. The consequences flow from the single
authority:

- The nav re-derives — entries appear, lock, or vanish — because it renders
  policy rather than caching it.
- **The user's current location may become forbidden.** This is the case
  everyone forgets: policy revocation while the user is *inside* the
  section. The shell handles it as a navigation event with an explanation,
  not a stranding (dead nav, live forbidden page) and not a silent eviction
  (content swapped with no account of why).
- In-flight work is not destroyed by the transition; the explanation
  surface offers whatever export or wrap-up the product can honor.

## Trust boundary

Everything above is presentation-layer honesty; none of it is enforcement.
Any client-held gate can be bypassed by a motivated user, so every
privileged *operation* re-checks policy at the boundary that actually owns
the resource. The nav's job is to make the honest path pleasant — the
authoritative "no" lives server-side or at the equivalent trust boundary,
and the two answers come from the same declared policy so they cannot
drift.

## The prohibitions, collected

1. No inline entitlement checks in nav rendering — the registry declares,
   the one policy authority answers.
2. No hidden entry with a reachable destination; every entrance consults
   the same gate.
3. No locked entry that looks enabled until clicked.
4. No lock rendered as disabled.
5. No silent eviction or stranding when policy changes under the user's
   feet.
6. No client-side gate treated as enforcement.
