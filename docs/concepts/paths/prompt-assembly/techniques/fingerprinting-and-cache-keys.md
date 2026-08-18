---
layer: technique
subject: prompt-assembly
technique: fingerprinting-and-cache-keys
status: forged
laws: [derivation-names-recomputation, gate-sees-target]
shared_with: []
---

# Fingerprinting and cache keys

A long-lived or cached session was opened with one prompt and lives on
while the source that generated that prompt keeps changing. The fingerprint
is the mechanism that keeps those two facts from quietly diverging: a
digest of everything that shapes the standing prompt, computed at assembly,
stamped on the session, and compared before reuse. Without it, every
configuration change forks reality — new sessions obey the new rules,
resumed sessions obey rules that no longer exist anywhere in the source,
and nothing anywhere records that two rule-sets are live.

## Determinism first — a fingerprint over noise is noise

The fingerprint's meaning rests entirely on assembly being a pure
function: same inputs, same bytes. If rendering reads a clock, iterates an
unordered collection, or picks up ambient state, equal configurations
produce unequal digests and the staleness signal drowns in false
positives — after which someone "fixes" it by comparing less, and the gate
goes blind. The discipline is upstream, in assembly and interpolation:
volatile values enter as declared inputs, collections are ordered
canonically before rendering, and the fingerprint hashes either the
finished standing text or a canonical serialization of the inputs that
produce it.

## What goes in the digest — and what stays out

In: everything that shapes the **standing layers** — the template version,
the active capability set, every configuration value that alters identity,
policy, or capability text, and the identity of the model family the
prompt was shaped for (prompts are tuned to their reader; the reader is an
input).

Out: the **per-call payload** — the task, the recalled context, the
retrieved documents. Those change on every call by design; a fingerprint
that includes them never matches anything and therefore gates nothing.

The boundary test is the question the fingerprint exists to answer: *would
a session opened yesterday be built differently today?* Anything whose
change should force a rebuild goes in; anything that varies per call while
the session's ground truth stays constant stays out.

The digest is a stored derived value, and per
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
it names its recomputation: the input list and the digest procedure are
stated where the fingerprint is defined, so "recompute and compare" is an
invokable operation, not archaeology. A fingerprint whose own inputs are
undocumented reproduces the drift problem one level up — nobody can say
whether a mismatch means real staleness or a change to the fingerprint
itself. Version the procedure; a procedure change invalidates everything,
once, explicitly.

## Compare before reuse — the session gate

Every reuse path — resuming a persistent session, restoring after
restart, continuing a pooled conversation — compares the session's stamped
fingerprint against the current one *before* continuing, and treats
mismatch as **stale: rebuild, do not continue**. Continuing on mismatch is
obeying a ghost; silently rebuilding without surfacing the event is also
wrong when the session carried state, because the operator sees an agent
that inexplicably lost its thread — staleness is a fact worth a log line
and, for interactive sessions, a visible note.

Per [gate-sees-target](../../_laws.md#gate-sees-target), the comparison
must read the real things: the stamp stored *with the session it gates*,
and a current fingerprint computed from the *live* configuration by the
same procedure. A gate that compares two values computed side by side at
resume time, or a stamp cached anywhere other than the session it
describes, passes exactly when it should fail.

## Granularity: one stamp per boundary that invalidates

The whole-prompt fingerprint is the floor. Layered prompts support layered
stamps — a digest per standing layer — which buy two things: **partial
invalidation** (a capability-set change need not discard identity-layer
work, where the system caches per layer) and **diagnosis** (a mismatch
names the layer that moved, turning "session stale" into "the capability
roster changed"). The stability-ordered prompt makes this natural: each
stable-prefix boundary is a candidate stamp point, and the same boundaries
are where provider-side prefix caching breaks, so the local stamps predict
the remote cache behavior.

## The fingerprint is the version stamp

Beyond cache hygiene, the fingerprint is how prompt changes become
observable engineering events. Stamped into call logs and traces, it ties
a behavior shift to the exact prompt version that introduced it —
"regressions began where fingerprint A became B" is bisectable, while
"the prompt changed sometime last sprint" is not. The digest is the
version identifier the prompt-as-interface discipline needs, minted for
free at assembly.

The stamp implies a ledger: **record what was sent, at the send site.**
The prompt is typically the largest and most behavior-determining
artifact the system produces, and often the only one it never persists —
after which every question about past behavior ("did that run see the new
instruction?") is unanswerable in principle. The floor is cheap: persist
the fingerprint, the size, and a content digest of every prompt sent,
keyed to the call record; persist the full text where volume and
sensitivity allow. A schema column reserved for this and never written is
the failure in its most common costume — the ledger that exists and
records nothing.

One caution the digest inherits from every identity scheme: digest
*identities*, not summaries that collide. A component count, a length, or
a first-N-characters sample can agree while the underlying set differs —
two different tool rosters of equal size hash equal, and the gate opens
for a session whose documented abilities no longer match its dispatcher.
Fingerprint inputs are canonical serializations of the things themselves.
