---
layer: technique
subject: rate-limiting
technique: key-design
status: forged
laws:
  - creation-names-reaper
shared_with: []
---

# Key design

The key is the limiter's unit of fairness: whatever you key on is what competes,
and everything sharing a key shares a fate. Most rate-limiting incidents that
look like algorithm bugs are key bugs — the wrong actors pooled into one
allowance, one actor split across several, or a key space the outside world can
grow without bound. The algorithm decides *how precisely* you enforce; the key
decides *what you are actually protecting, and from whom*.

## Choosing the axes

The candidate axes are few and compose into tuples:

- **Per tenant / account** — the fairness boundary customers expect: one
  tenant's misbehaving script must not starve another tenant. The default
  ingress axis.
- **Per credential / token** — finer than tenant; isolates one leaked or
  runaway credential without freezing the whole account, and matches the axis
  on which egress providers usually meter *you*.
- **Per endpoint / operation class** — because operations differ in cost by
  orders of magnitude. One global number across cheap reads and expensive
  mutations is either uselessly loose for reads or cruelly tight for writes;
  keying (or costing) by operation class fixes the mismatch.
- **Per source address** — the axis of last resort for unauthenticated
  traffic: world-controlled, spoofable at the edges, and shared by everyone
  behind one gateway. Use it as a coarse pre-filter, never as the fairness
  unit for identified actors.

Two tests pick the axes. The *blast-radius test*: when this limit trips, who
else stops working? If the answer includes actors who did nothing, the key is
too coarse. The *evasion test*: what does an abuser change to get a fresh
allowance? If the answer is "a free-to-mint identifier" (a new session, a new
address, a new anonymous id), the key is too fine — or needs a coarser layer
above it (see limiter-topology for how layers compose).

## One derivation, one authority

The key is derived from request attributes, and the derivation function is part
of the limit's identity. Two doors deriving the key differently — one
normalizing case, one not; one keying on tenant, one on credential — split one
actor into two allowances, and the limit silently doubles for exactly the
actors who use both doors. The derivation lives in one place, next to the
limiter, and every door calls it; a limiter API that accepts a caller-built
string as the key is inviting each call site to invent its own fairness
boundary.

The derivation is also where the adversarial review happens: **any key
component the caller can influence is a bucket-minting lever.** Build keys
from identifiers the system assigned — the credential's row id, the resource's
own id — never from names, prefixes, or routing strings the caller supplies,
and ask of each component: *can the caller change this?* If yes, they can
manufacture fresh allowances at will, and the limit is advisory for exactly
the callers it exists to stop. The reasoning behind each key's composition is
worth a comment at the derivation site — it is the part of a limiter most
likely to be weakened by a well-meaning refactor that "simplifies" the key.

## Cardinality is a security property

Any key containing world-controlled input — addresses, tokens, user-supplied
identifiers — names an unbounded set, and the limiter allocates state per key.
**An unbounded per-key map is a memory leak whose growth rate the adversary
controls**: the limiter built to stop abuse becomes the cheapest thing to abuse.
Every per-key map therefore ships with its bound and its reaper on the day it is
created (law: creation-names-reaper):

- **A size cap** with eviction of the least-recently-touched key, sized from
  the honest question "how many keys can be *legitimately* active in one
  window?" — not from available memory.
- **A staleness rule**: entries idle longer than the state's own horizon carry
  no information — a token bucket idle past its time-to-full is
  indistinguishable from a fresh one — and are pure waste. The reaper prunes
  them on a schedule (the reaper's own discipline — named, scheduled, observable
  — is storm-hygiene's territory).
- **Eviction must be an allowance no larger than time would have granted.**
  Evicting a key resets it to a fresh allowance, so eviction of an *active*
  key is a limit bypass. The safe form: evict only entries idle past the
  refill/aging horizon, where "fresh state" and "aged state" are identical by
  arithmetic. If memory pressure ever forces eviction of active keys, that is
  a shed event worth counting, not a silent reset.

## The unknown-key policy

Some requests arrive with no resolvable key — unauthenticated, malformed, or
ahead of the identification step. "No key" must map to a *deliberate* policy,
because the accidental mapping is "no key, no limit," which makes
unidentifiability the cheapest evasion in the system. The options, in
decreasing strictness: refuse outright (where identification is mandatory
anyway); pool all unknowns into one shared, deliberately tight allowance —
unknown actors collectively get scraps, and the pool's exhaustion is a signal
worth watching; or fall back to a coarser axis (per source) with its own tight
limit. Which one is right depends on the door; that there *is* one, chosen in
advance, is the technique.

## Decision rules

- **Key for the blast radius you intend.** State, for each limit, who is
  punished together on purpose. If you cannot say it, the key was chosen by
  convenience of available fields, not by fairness.
- **Run the evasion test before shipping.** Whatever the abuser can mint for
  free must not be the sole key. Layer a bounded-cardinality axis above any
  free-to-mint one.
- **Bound every map at birth.** Cap, staleness horizon, and reaper are part of
  the map's construction, not a hardening ticket. A limiter reviewed without
  its cardinality bound is unreviewed.
- **Keep the derivation singular.** One function, adjacent to the limiter,
  used by every door. Treat a second derivation site as the same defect class
  as a second limiter (see limiter-topology).
- **Count evictions and unknown-pool refusals separately.** Both are signals —
  the first of under-sizing or attack, the second of an identification gap —
  and both vanish if blended into ordinary refusal counts (see
  limit-observability).
