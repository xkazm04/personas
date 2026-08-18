---
layer: golden-path
subject: error-handling
status: forged
techniques:
  - taxonomy-design
  - error-doors
  - user-facing-mapping
  - structured-propagation
  - swallowed-error-prevention
  - crash-capture
evidence:
  - src-tauri/core/src/error_taxonomy.rs        # canonical closed taxonomy — one enum consumed by healing, failover, severity, and (via ts-rs + parity fixtures) the frontend
  - src/lib/errorTaxonomy.ts                    # the language-boundary mirror, held in sync by byte-identical PARITY_FIXTURES on both sides
  - src/lib/silentCatch.ts                      # the two named doors: toastCatch (user + telemetry) vs silentCatch (telemetry + log), one call each
  - src/lib/silentFailureTelemetry.ts           # recordSwallow — the swallow rate made measurable (per-tag rollup + sampled capture)
  - src/lib/errors/errorPipeline.ts             # classifyErrorFull — one memoized classification pass instead of three independent matchers per consumer
  - src/lib/errors/errorRegistry.ts             # raw-error → friendly message + suggestion + fault-line category, ordered most-specific-first
  - src/lib/utils/apiError.ts                   # transient/permanent classification with retryAfterMs; structured `kind` fast path before any prose matching
  - src/lib/utils/crashPersistence.ts           # sanitize-at-capture, persist-first-ship-later, bounded spool with its reaper
  - src-tauri/engine/src/failure_signature.rs   # normalized failure signatures — identity-keyed dedup for the repeat-failure breaker
counter_evidence:
  - docs/concepts/golden-paths/swallowed-error-telemetry.md   # measured: 760 of 2,752 catch bodies reach no door while the empty-catch lint sits at "error" with 0 findings
deviations:
  - w2-error-handling   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Error taxonomy & handling

Every product has more failure paths than success paths — a request has one way
to succeed and a dozen ways to die — yet most codebases design the success path
and improvise the rest. Failure is not an interruption of the domain; it **is a
domain**: it has a vocabulary (the taxonomy), a routing problem (who must learn
of this failure), a rendering problem (what the user is told), and a
measurement problem (whether any of the above actually happened). Products that
treat it as a domain converge on a small set of structures. Products that do
not converge on a single defect, repeated hundreds of times: the failure that
happened and told no one.

## One taxonomy, many consumers

At least three independent systems need to know *what kind* of failure
occurred:

- **Retry policy** needs to know whether trying again can possibly help — a
  timeout is worth a second attempt; a malformed request never is; a rate
  limit is worth exactly one attempt *after the stated interval*.
- **Automated recovery** needs to know which remediation applies — re-issue,
  re-authenticate, reconfigure, or give up and page a human.
- **User copy** needs to know which explanation and which next action to
  offer — "check your connection" and "your session expired" and "that name
  is taken" are answers to three different situations.

The senior structure is that all three consume **one classification, produced
once**. The alternative — each consumer re-deriving "what kind of failure is
this" from the raw error at its own site — manufactures three classifiers that
drift independently, and the drift shows up as the worst kind of bug: retry
hammering a permanent failure, or a user told to "try again" for an error that
will never succeed. One vocabulary, one authority, every consumer derives
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)).

The vocabulary itself is a **closed set of categories**, chosen so that the
consumers' branching questions — retryable? whose fault? what remediation? —
are answerable per category. Designing that set, keeping it closed, and
mirroring it across language and process boundaries is
[taxonomy-design](techniques/taxonomy-design.md).

## Classify on structure, never on prose

Classification must key on **structured fields** — a status code, an error
code, a typed variant, a machine-readable field in a response body — never on
matching substrings of a human-readable message. Messages are *copy*: they get
reworded by upstream libraries, localized by providers, enriched with dynamic
values, and truncated by transports. A classifier built on message text is a
correct program today and a silent misclassifier after any dependency upgrade —
and it fails in the worst direction, sliding everything into the
catch-all category where retry policy and user copy are at their vaguest.

Prose matching is permissible in exactly one place: as a **last-resort
fallback tier** behind structured classification, for raw strings that arrive
from sources that offer no structure at all — and even then the match belongs
in one registry, not scattered at call sites, so there is one place to fix
when the prose changes.

## The error door: every failure reaches somewhere

The central invariant of the whole domain:

> **Every failure reaches at least one door — telemetry, a log, or the user.
> Never none.**

A door is an exit from the code's private world into somewhere a human can
eventually look. Which door depends on one routing question — *is this the
user's problem right now?*

- **User-facing failures** (their action failed, their data did not save)
  reach the user *and* telemetry. Telling the user without recording it means
  the operator learns about outages from support tickets; recording it
  without telling the user means the user resubmits into the same failure.
- **Background failures** (a poll failed, a cache refresh died, a
  best-effort enrichment fell over) reach telemetry and a log, silently. The
  user is not interrupted for problems that are not theirs — but *silent to
  the user* must never decay into *silent to everyone*.

The routing decision, the door primitives, and the discipline that makes an
empty catch block a reviewable event are
[error-doors](techniques/error-doors.md). What the user-facing door actually
*says* — the registry mapping raw failures to honest human copy with a next
action — is [user-facing-mapping](techniques/user-facing-mapping.md). How a
failure *renders* on a surface (distinct from empty, retry that retries,
staleness admitted) is the surface side of this subject and lives with the
async-surface doctrine in
[failure-states](../async-ui-states/techniques/failure-states.md) — this
subject decides what the failure *is* and who learns of it; that one decides
what the pixels do.

## The dominant defect is silence, not noise

Ask engineers to name an error-handling failure mode and they describe the
loud ones — the unhandled crash, the cryptic message. The measured reality in
long-lived codebases is the opposite: **the dominant defect is the swallowed
catch** — a handler that catches, does nothing that reaches any door, and
continues. It outnumbers every other class combined, because it is the
path of least resistance at every site where a failure is "not important
right now", and because nothing pushes back: a swallowed failure produces no
symptom at the site that swallowed it, only downstream, later, disguised as
something else — a count that is short, a surface that is stale, an
automation that "just didn't run".

Two structural facts make this defect durable:

- **Handled is not routed.** A catch block that logs to a debugging console,
  or sets a local flag, or returns a default, *feels* handled at review time.
  The test is not "does the code respond" but "does a human ever learn" —
  and most responses fail that test.
- **The gates that exist do not see it.** Automated enforcement tends to
  detect the *syntactic* shell (an empty catch block) and is blind to the
  semantic condition (a catch body that reaches no door). The gap between
  what the gate sees and what the standard demands is exactly where the
  defect accumulates
  ([gate-sees-target](../_laws.md#gate-sees-target)).

Making the sanctioned path cheaper than the swallow, and measuring actual
door coverage instead of trusting a green lint run, is
[swallowed-error-prevention](techniques/swallowed-error-prevention.md).

## Propagation: context grows, class survives

Failures are born deep — in a driver, a socket, a parser — and are decided
high — at a request boundary, a command handler, a surface. Between birth and
decision, a failure crosses layers, and each crossing must obey two rules:

- **Enrich without loss.** Each layer adds what only it knows — which
  operation, which entity, which attempt — while preserving the original
  cause and its classification. Wrapping that discards the cause converts a
  diagnosable failure into "something failed somewhere below".
- **Class survives every boundary.** When a failure crosses a
  representation boundary — thrown exception to returned value, native error
  to serialized payload, one language to another — the *category* must cross
  intact. The cheapest and most common propagation bug is stringification at
  a boundary: the structured error flattened into its message, so the far
  side is left classifying prose it was explicitly forbidden to classify.

The typed-error shapes, the boundary conversions, and the enrichment
discipline are [structured-propagation](techniques/structured-propagation.md).

## The outermost door: crash capture

Everything above assumes the failure was caught by code that expected it.
The final tier handles the failures nothing expected — the unhandled
exception, the unhandled rejection, the panic. These need **last-resort
handlers at the true edge of each execution context**, and their job differs
from ordinary doors: capture maximum context (what happened, and the trail of
recent events that led there), **sanitize before persisting** (a crash report
is the single most likely artifact to accidentally embed secrets, because it
serializes state indiscriminately), persist locally first (the crash may
take the reporter down with it), and ship on next start. Crash capture is
[crash-capture](techniques/crash-capture.md).

## Measuring the domain

Because the dominant defect is invisible by construction, the health of this
domain cannot be assessed by symptom — it must be *counted*, with the
predicate stated ([count-carries-predicate](../_laws.md#count-carries-predicate)):
how many catch sites exist, how many reach a door, what fraction of failures
produce a telemetry event. A codebase that has never run this count should
assume the worst; every codebase that has run it for the first time found the
swallowed-catch population larger than anyone predicted.

## The techniques

- [taxonomy-design](techniques/taxonomy-design.md) — the closed category
  set, the retryability and fault axes, retry-interval extraction, and
  mirroring one authority across language boundaries.
- [error-doors](techniques/error-doors.md) — the routing decision
  (user-facing vs background), the door primitives, deduplication across
  layers, and why an empty catch is a reviewable event.
- [user-facing-mapping](techniques/user-facing-mapping.md) — the registry
  from raw failure to honest message plus suggested action, the fallback
  chain, and translation.
- [structured-propagation](techniques/structured-propagation.md) — typed
  errors across layers, cause preservation, enrichment, and surviving
  representation boundaries.
- [swallowed-error-prevention](techniques/swallowed-error-prevention.md) —
  why enforcement misses catch bodies, measuring door coverage, and making
  the routed path the cheap path.
- [crash-capture](techniques/crash-capture.md) — last-resort handlers,
  breadcrumbs, sanitization before persistence, and crash-loop protection.
