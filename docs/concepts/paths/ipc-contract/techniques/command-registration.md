---
layer: technique
subject: ipc-contract
technique: command-registration
status: forged
laws: [gate-sees-target, failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Command registration

In most two-world transports, an operation exists twice: once as a **handler**
(a function somebody wrote) and once as an **entry in the dispatch table**
(the registration that routes an incoming name to that function). Writing the
handler and registering it are separate acts, usually in separate files, and
the toolchain verifies each in isolation while verifying their *agreement*
not at all. This technique is the parity discipline that makes the dispatch
table a checked artifact, plus the runtime posture for the day a call misses
it anyway.

## The three sets

At any commit the boundary has three name sets, and every pairwise
difference is a distinct finding:

- **D — declared**: the names the contract publishes to the interface world
  (the generated constants, per
  [casing-and-naming](casing-and-naming.md)).
- **R — registered**: the names actually present in the dispatch table at
  runtime.
- **I — invoked**: the names call sites actually use.

The findings:

- **I − R: invoked but not registered** — the fatal class. Compiles clean,
  fails at runtime with the transport's generic "unknown operation". This is
  the set the gate exists for, and it must be empty.
- **I − D: invoked but not declared** — a raw string bypassed the vocabulary;
  fix the call site, then re-derive.
- **D − R: declared but not registered** — the generation source and the
  dispatch table disagree; usually a handler written and exported but never
  added to the registration list, caught here *before* any call site adopts
  it.
- **R − I: registered but never invoked** — dead surface. Not automatically
  wrong (external automation, planned adoption), but it is *inventory*: list
  it, age it, and let unexplained entries face the question every unused
  export faces. An operation nobody calls is attack surface and maintenance
  load with no witness.

The derivation matters as much as the comparison. Each set must come from the
thing itself — D from the generated vocabulary artifact, R from the actual
registration source (parsed, or better, emitted by the registering machinery
itself), I from a scan of call sites that goes through the wrapper
chokepoint. A set derived from a hand-maintained list is a proxy, and the
gate goes blind exactly when the proxy drifts
([gate-sees-target](../../_laws.md#gate-sees-target)). Two sharper corollaries:
when *two different tools* each parse the registration source with their own
pattern, R now has two derivations that can disagree — one authority per
derivation too, so extract once and share, or the day the registration
block's spelling changes, one tool adapts and the other silently parses a
different block. And the scan asserts its instrument: zero invocations found
means the scanner is broken, not that the product makes no calls
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## The name is the smaller half of the signature

Most transports resolve **arguments by name too**: the payload is a bag of
named fields matched against the handler's declared parameters, and a call
that names a real operation but omits a required parameter — or spells it in
the wrong casing — is rejected at the boundary *with the name check fully
green*. Parity therefore extends below the operation name: for each invoked
operation, compare the payload keys the call site sends against the
parameters the handler declares (minus the ones the transport injects, and
account for the wire's casing translation). A whole call family can be
unexecutable — correct names, wrong keys — while every name-level gate
passes; only signature-level parity sees it. Payloads built dynamically are
honestly reported as unanalyzable rather than guessed at.

## The forward-reference list is a loan, not a home

Real repositories need an escape hatch: call sites written against an
operation the far side does not implement yet. Make that an explicit,
declared list — a known-unregistered vocabulary the parity gate excludes from
its fatal set — but treat every entry as a loan with covenants, because the
list converts a hard build error into certified runtime silence:

- **Auto-prune**: when an entry's name appears in R, the entry is deleted by
  the generation machinery itself, not by memory.
- **Refuse the worst state**: an entry whose handler *exists* but is merely
  unregistered fails the gate — that is registration drift hiding inside the
  escape hatch, one line away from fixed.
- **Every entry carries a reason and an owner**, or the list cannot
  distinguish "planned, arriving next release" from "dead for a year", and a
  list that cannot distinguish them only grows.

## Prefer structural registration; the gate is the ratchet

A separate dispatch list exists because some transports need a compile-time
enumeration — it is an artifact of the transport, not physics. Where the
platform allows the definition to *be* the registration (file-as-route
systems, decorator-mounted handlers, self-registering distributed
registries), the entire defect class becomes unrepresentable, which beats any
gate. When the transport imposes the two-step, the parity gate above is the
standing ratchet — and one incident class deserves its own guard: registration
entries deleted *by attribute*, where a conditional-compilation marker
stacked wrongly silently removes a block of entries. A deletion from a list
is not an error to any compiler; only set parity notices.

## Conditional registration

Dispatch tables are frequently assembled under build configuration: optional
feature sets compile whole handler families in or out. Then R is not one set
but one **per configuration**, and a parity gate that checks only the
maximal build will pass while a lighter shipped configuration is missing
registrations that its own interface build still invokes. The gate must
either run per shipped configuration or check against the *intersection* of
configurations for the calls the common interface makes — and the
configuration matrix belongs in the gate's own definition, stated, not
assumed ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
applied to "which builds exist").

## Runtime posture: anchor the "unknown operation" detection

Gates reduce the frequency of a missed registration; they do not reduce its
*confusion* when one slips through, and the transport's own report is a
generic failure string. Two rules for the near side:

1. **Detect the miss by anchor, not by substring soup.** The transport's
   "unknown operation" rejection has a specific shape; the wrapper matches
   that shape precisely (anchored, against the transport's own format) and
   classifies it as a **registration gap** — a distinct category in the
   wrapper's failure taxonomy, separated from refusal, timeout, and
   no-far-side. Loose substring matching eventually swallows a legitimate
   domain error that happens to contain the same words.
2. **A registration gap is a defect report, not a user error.** The user can
   do nothing about it; the surface shows the product-fault message while
   the diagnostic channel records the missing name — which is the exact
   datum the fix needs. In development builds, fail loudly enough that the
   gap cannot be shrugged past.

The same anchored detection, inverted, powers **environment sensing**: code
that must know whether a far side exists at all (test harnesses, browser-only
development modes) can distinguish "no host present" from "host present,
operation missing" only if the wrapper keeps those categories separate. A
product that collapses them will one day interpret a missing registration as
"running in a browser" and silently disable a feature that is merely
mis-wired.
