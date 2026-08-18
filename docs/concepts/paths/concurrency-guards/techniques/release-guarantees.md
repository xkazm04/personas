---
layer: technique
subject: concurrency-guards
technique: release-guarantees
status: forged
laws:
  - creation-names-reaper
  - failure-not-empty-success
shared_with: []
---

# Release guarantees

A guard entry is a created resource, and like every created resource it must
name its reaper at creation time (law: creation-names-reaper). The stakes are
higher than for most resources: a leaked file handle wastes a handle; a leaked
guard entry **denies that key forever**. The operation it guards can never run
again in this process — and if the guard is durable, never again at all until
a human intervenes. A guard with an unreliable release path converts the
recoverable failure it prevents (occasional duplication) into an unrecoverable
one it causes (a permanently wedged operation). This trade is so bad that an
unguaranteed release is worse than no guard.

## The enemy list: every path out of the guarded section

Release fails on the paths nobody walks in review:

- **Early return** — a validation branch returns before the release line at
  the bottom of the function.
- **Exception / panic** — the operation throws; the release line is never
  reached.
- **Cancellation** — the caller abandons the operation; whether the guarded
  body keeps running or is torn down mid-flight, the release must still fire
  exactly once.
- **Timeout** — the operation hangs. No code path exits at all; release-by-
  code-path can never fire.
- **Process death** — for durable or cross-process guards, the holder
  vanishes; nothing in the holder can release (see cross-process-exclusion
  for the takeover machinery this requires).

The first three are solved structurally; the last two need time-based
machinery. A release design is complete only when it names its answer for all
five.

## Structural release: tie the release to scope, not to a line of code

The reliable pattern in every environment is the same idea wearing local
dress: **bind the release to the destruction of a scope**, so the language
runtime — not programmer discipline — guarantees it runs on early return,
exception, and (where the runtime supports it) cancellation.

- A guard object whose destructor/disposal releases the entry, acquired at
  the top of the section, released when the object goes out of scope by *any*
  exit.
- A finally/defer block installed in the same statement as the acquisition —
  never separated from it by fallible code, because the gap between acquire
  and protect is itself an exit path.
- A run-with-guard wrapper: the primitive itself takes the operation as a
  closure, acquires around it, and releases in its own finally. This is the
  strongest form — call sites *cannot* forget, because they never see the
  release — and it pairs naturally with the shared registry (see
  single-flight-primitives).

The anti-pattern is release-as-a-statement: `remove(key)` at the end of the
happy path, with the author mentally asserting no other exit exists. Every
future edit to that function re-litigates the assertion, silently.

Two refinements earn their keep in practice. First, **release should verify
the releaser**: a release parameterized as "clear this key *if it still holds
my token*" cannot cross-release — without the check, a refused second caller's
cleanup path can delete the first caller's live entry, making the running
operation uncancelable and unfindable. Second, **the guard's own internal
state is a resource too**: if the registry's internal lock can be poisoned or
wedged by a holder that died badly, every future acquisition fails and the
guard has sealed itself. The primitive must recover its internals from a
holder's crash, not inherit it.

## Timeout reclamation: the release of last resort, with evidence

Structure cannot release a guard whose holder is alive but stuck. The last
line of defense is age-based reclamation: entries carry their acquisition
time, and an entry older than a stated bound is presumed leaked and evicted.

Three rules keep reclamation from becoming its own bug:

- **The bound is evidence-based.** It must comfortably exceed the operation's
  real worst case — reclaiming a *live* guard readmits the duplicate at the
  exact moment the operation is slowest, which is when duplication hurts
  most. Derive the bound from observed durations, not from optimism.
- **Reclamation is loud** (law: failure-not-empty-success). An evicted entry
  is a defect report — some path leaked it — not routine hygiene. Silent
  reclamation converts every release bug into permanent low-grade
  duplication that no one ever sees.
- **Reclamation is the backstop, never the design.** If entries are routinely
  reclaimed by age, the structural release is broken and the guard is running
  on its safety net.

## The leaked-entry audit

Because a leak is silent by nature — the symptom is an operation that
"sometimes doesn't run," reported far from the guard — the in-flight set needs
periodic adversarial inspection: list the current entries (the primitive's
list() exists for this) and compare ages against plausible operation
durations. An entry older than any plausible run is a leak in progress; the
audit finds it before the user report does. Wiring this into existing
health-check surfaces makes the guard observable in the same place other
liveness is.

## Decision rules

- Every acquisition names its release path in the same breath — same
  statement, same scope construct — and the answer covers early return,
  exception, cancellation, timeout, and (where applicable) process death.
- Prefer the run-with-guard closure form; it makes forgetting impossible
  rather than unlikely.
- Never separate acquire from its protection by fallible code.
- Add age-based reclamation with an evidence-based bound; log every
  reclamation as a defect signal, not as debug noise.
- Audit the live set: any entry older than the operation's plausible worst
  case is a leak to chase, today, while the evidence is still resident.
