---
layer: technique
subject: test-harness
technique: platform-quirk-absorption
status: forged
laws: [failure-not-empty-success, one-validation-door]
shared_with: []
---

# Platform quirk absorption

Every platform eventually presents a failure that happens **before the first
test executes**: the loader rejects the binary, a required runtime manifest is
absent, a cached dependency artifact is mislabeled for the wrong architecture,
a sandbox rule differs between the developer's machine and the pipeline
runner, a path or encoding convention breaks the discovery step. These
failures share three properties that make them uniquely corrosive: they
produce **no test output** (the process dies before the framework awakens),
they are **environmental** (green on one machine, dead on the next, with
identical code), and they are **rediscovered independently** by every
engineer who hits them, each paying the full diagnosis cost from zero.

The technique is absorption: the quirk is solved **once, in the runner**, and
never again in a test, a wiki page, or an engineer's memory.

## Silence is the enemy; convert it to diagnosis

A process that dies pre-main looks like nothing: an exit code, zero output,
zero tests reported. Naive tooling shrugs this into the report stream, where
"ran nothing, exited" is indistinguishable from — or worse, summarized as —
a fast green run. This is the canonical empty-success lie
([_laws: failure-not-empty-success_](../../_laws.md#failure-not-empty-success)),
and the runner's first duty is to kill it: a run that reports **zero tests
executed** is a fatal harness error with its own distinct message, never a
pass. The second duty is naming: when the exit pattern matches a known quirk
(a characteristic loader status code, a missing-dependency signature), the
runner says so — "this is the known loader failure; the fix is applied by
this wrapper; if you are seeing this, you bypassed it" — converting a
half-day of archaeology into a sentence.

## Absorb in the wrapper, and make the wrapper the only door

Absorption only works if every invocation flows through it
([_laws: one-validation-door_](../../_laws.md#one-validation-door)). The
shape: a thin launcher script wraps the raw test tool; the launcher detects
the quirk's precondition, applies the repair — embeds the manifest after
linking, replaces the mislabeled cached artifact with the correct one, sets
the environment the sandbox requires — and then delegates. Three rules:

1. **The repair is idempotent and self-healing.** It checks the actual
   condition (sniff the artifact's real architecture, test for the manifest's
   presence) rather than a marker file, so a cleaned cache or a fresh clone
   heals itself on the next run instead of failing until a human remembers
   the ritual.
2. **The raw tool remains callable but diagnosable.** You cannot always
   prevent someone invoking the underlying tool directly; you can make the
   resulting failure carry a pointer to the wrapper. A diagnostic subcommand
   that inspects a binary and reports which repairs it has or lacks turns
   "it crashes for me" into a one-command triage.
3. **Every entry point routes through the wrapper** — the local convenience
   command, the pipeline step, the pre-push hook, the documentation snippet.
   An absorbed quirk with one unwrapped entry point has merely become
   intermittent, which is a downgrade from reliably broken.

## Keep the incident attached

A quirk fix without its story is doomed. Six months later it reads as cruft —
an odd extra step in the launcher, a strange artifact-swapping script — and a
well-meaning cleanup deletes it, resurrecting the original failure for a new
generation who lack even the folklore. The standard: the fix carries, in a
comment or adjacent document, **what failed, on which platform, what the
symptom looked like, and why the fix cannot live anywhere better**. The last
clause matters most — many of these quirks have an obvious-looking "proper"
fix that was tried and is structurally impossible (the build system offers no
hook for that target; the upstream artifact is mislabeled at the source), and
recording the dead ends is what stops the next engineer from re-walking them.

## The absorption boundary

Not everything belongs in the runner. Absorb what is **environmental and
universal** — every test in the lane hits it, no test caused it. Do not
absorb product bugs (a repair that patches around the product's own defect
converts a red lane into a lying green one), and do not absorb per-test
special cases (a wrapper accumulating test-specific conditionals is a test
suite hiding inside a launcher). The test for the boundary: if the quirk
would bite an empty suite of zero tests, it belongs to the runner; if it
bites only certain tests, it belongs to those tests or the product.
