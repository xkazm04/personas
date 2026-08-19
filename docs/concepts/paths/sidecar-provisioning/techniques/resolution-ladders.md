---
layer: technique
subject: sidecar-provisioning
technique: resolution-ladders
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Resolution ladders

Before an external dependency can be downloaded, spawned, or loaded, one
question must be answered deterministically: **which concrete file will be
used?** The resolution ladder is that answer — a declared, ordered sequence
of places to look, applied identically to every external dependency the
application has. The technique's core claim is about uniformity: the ladder
itself is boring; what is valuable is that there is exactly *one* of it.

## The canonical rungs, in order

1. **Explicit override.** An environment variable or persisted setting names
   an exact path for this specific dependency. This rung exists for the
   operator debugging a broken machine, the power user with a custom build,
   and the test harness injecting a fake. Two rules make it trustworthy:
   the override is *never silently skipped* — if it is set and points at
   something missing or unusable, resolution **fails loudly at that rung**
   rather than falling through, because an operator who set an override and
   got the managed copy anyway is debugging a ghost; and each dependency's
   override variable is derived from one naming convention, not invented
   per dependency.
2. **Managed directory.** The application-owned location where provisioned
   artifacts reside (model-storage-lifecycle owns its layout). This is the
   only rung whose contents the application itself vouches for — artifacts
   arrive here exclusively through the verified download door.
3. **System discovery.** The ambient executable search path, well-known
   platform install locations, package-manager conventions. This rung is
   pure convenience and zero control: what it finds was installed by someone
   else, at some version, for some other reason. Anything found here is
   verified before use (capability-detection owns the probe) and is treated
   as read-only — never updated, never evicted.

The order encodes a principle: **specificity beats management beats
ambience.** The human who says "use this exact file" outranks the
application's own store, which outranks whatever the machine happens to
have. Reversing any pair produces a real pathology — system-before-managed
means a stale global install shadows the copy the application carefully
provisioned; managed-before-override means no operator can ever escape a
corrupted store.

## One ladder, many dependencies

The failure mode this technique kills is *bespoke resolution*: dependency A
checks the environment then the search path; dependency B checks a config
key then a hardcoded location; dependency C shells out to a version command
and hopes. Each of these is locally defensible and collectively
undiagnosable — support conversations degenerate because "is it installed?"
means something different per dependency. The remedy is structural, not
disciplinary ([one-validation-door](../../_laws.md#one-validation-door) in
spirit): one resolver function, parameterized by dependency descriptor
(name, override key, expected artifact names per platform and architecture,
verification recipe), through which **every** lookup passes. A dependency
added next quarter inherits the ladder by construction. The descriptor set
is itself a closed catalog
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
the resolver, the diagnostics, and the settings surface all derive from one
list of external dependencies, or they drift.

## Resolution is a reportable event, not a boolean

The resolver's output is not "a path or null". It is a structured verdict:
which rung answered, the concrete path, the version detected, and — just as
important — what each earlier rung rejected and why (override unset;
override set but target missing; managed copy absent; managed copy failed
verification). This is the difference between a support thread that opens
with "it says the engine is missing" and one that opens with "the override
points at a path that no longer exists".

Two honesty rules:

- **Not-found is a verdict, not an exception.** An exhausted ladder is a
  normal, expected outcome — the initial state of every fresh install — and
  it produces a distinct result that capability-detection turns into a
  designed absence, never a crash
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **Resolve what will actually run.** The resolver must apply the same
  platform, architecture, and naming rules the eventual spawn or load will
  apply. A resolver that checks for a file the loader would not accept —
  wrong architecture, wrong variant name — passes exactly when it should
  fail ([gate-sees-target](../../_laws.md#gate-sees-target)).

## Caching the verdict

Resolution touches the filesystem and sometimes executes a version probe,
so callers will want to cache it. Cache the *verdict object*, keyed by
dependency, and invalidate on the events that can change it: a completed
download, an eviction, a settings change to the override, an explicit
user "re-detect" action. A resolution cached at startup and never
revisited turns every mid-session install into "restart the application to
be believed" — acceptable only if that restart requirement is a stated,
deliberate choice rather than an accident of caching.
