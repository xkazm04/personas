---
layer: technique
subject: device-pairing
technique: admission-scoping
status: forged
laws: [gate-sees-target, one-validation-door]
shared_with: []
---

# Admission scoping

Before any credential is checked, before any ceremony runs, an attacker
interacts with the pairing system's **pre-trust surface**: the listener
that accepts pairing requests and the endpoints where unverified holders
present tokens. This technique minimizes that surface *structurally* —
by address class, by lifecycle, and by allowlist — so that most of the
internet cannot reach the authentication code at all, and what does reach
it is already inside a deliberately drawn perimeter.

## Classify the peer before you compute

The first gate on every request is the **peer's address class**, evaluated
before any secret-bearing work:

- a management surface intended for the machine's own processes binds to
  the loopback interface only — remote peers cannot connect, by the
  network stack's own arithmetic, not by a check that could be forgotten;
- a surface intended for the operator's other devices accepts loopback,
  private-range, and link-local peers, and refuses everything else with a
  cheap, constant-cost rejection — no token parsing, no store read, no
  hash — so an internet-exposed misconfiguration burns zero
  secret-adjacent computation per probe;
- the classification must handle address-family disguises (a private
  address arriving mapped inside the other family's format) or the gate
  has a well-known hole.

Two honest limits, stated rather than papered over. First, an address
class is a *perimeter*, not an identity: a hostile device on the same
private network passes the class gate, which is exactly why the class gate
is layer one of three (class → credential → verb), never the whole
argument. Second, the class gate deliberately admits operator-constructed
overlays that present private-range addresses — that is a feature (the
operator built that network) and a documented trust statement, not an
accident.

**Bind-address and peer-class must agree.** A recurring defect is a
listener bound to all interfaces "temporarily" whose handlers assume
loopback-only callers. The binding is the enforcement; handler assumptions
are hope. State the intended audience of every listener next to its bind
call, and test the refusal — a unit test that presents a public address to
the classifier is one line and outlives every refactor.

## Listeners exist only while trust exists

A pairing-capable server that runs unconditionally is attack surface on
every installation that never pairs anything — the majority, for most
products. The lifecycle rule:

- the wide-audience listener **starts on the first approval** (the pairing
  command itself brings it up) and, across restarts, is **re-started only
  if live pairings exist** — the startup path consults the persisted trust
  registry and stays dark otherwise;
- when the last pairing is revoked, the listener has no reason to exist;
  at minimum it must refuse everything (an empty registry authenticates
  nobody), and shutting it down entirely is better because a closed port
  is invisible to scanners in a way a 401-emitting port is not;
- the *narrow* pre-trust entry point (where ceremonies start) may live on
  an always-on loopback surface, because its audience is the machine's own
  browser and processes — the scoping insight is that the ceremony
  entrance and the paired-device service do not need the same audience,
  so they should not share a perimeter.

## Allowlists are warmed from persisted state

Every allowlist the admission layer consults — approved origins for
cross-origin browser access, known device fingerprints — has one
authoritative home: the **persisted trust registry** the ceremony writes.
The in-memory copy the hot path reads is a cache of that registry, and its
lifecycle is fixed:

- **warmed at startup** by loading from persistence — approvals survive
  restarts without re-ceremony;
- **mutated in the same transaction of intent** as the registry — approval
  adds to both, revocation removes from both, and revocation *re-derives*
  the in-memory set from the registry rather than surgically deleting one
  entry, so the cache converges on truth instead of accumulating drift
  ([gate-sees-target](../../_laws.md#gate-sees-target): the gate's
  effective input must be the durable record of who was approved; a
  hand-maintained shadow passes review until the first divergence, which
  is the moment the gate existed for);
- **fail-closed on load failure** — an unreadable registry warms an empty
  allowlist and logs loudly; it never warms "whatever was there last time".

The same one-door discipline applies to writers
([one-validation-door](../../_laws.md#one-validation-door)): the ceremony's
approval path is the *only* code that adds to the trust registry. Every
convenience writer added beside it — a manual "register device" command
for testing, an import path, a migration backfill — is a second door with
weaker validation, and the admission layer cannot tell its rows from
ceremony rows. If a second writer must exist, its rows carry a visibly
different type (no proof recorded, marked unverified) and the admission
predicate must consult that distinction — otherwise the registry
authenticates at the strength of its weakest writer.

## The pairing entrance is permissive on purpose — and says so

One counter-intuitive corner: the ceremony's own entry endpoint often must
be *maximally* permissive at the transport-policy layer (accepting
cross-origin requests from anywhere), precisely because the requesting
origin is not paired yet — an origin allowlist cannot admit an origin
whose admission is the question. That permissiveness is sound only
because the endpoint mints nothing: its security is the nonce discipline,
the human gate, and the identity-checked single-use claim. Write that
reasoning down at the endpoint, in code — a permissive policy with a
comment naming the compensating controls is a design; a permissive policy
alone is the first thing a security review flags and the next engineer
"fixes" into a broken ceremony.
