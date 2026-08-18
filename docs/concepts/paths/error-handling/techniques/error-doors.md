---
layer: technique
subject: error-handling
technique: error-doors
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Error doors

A door is an exit from the program's private world into somewhere a human can
eventually look: the user's attention, a persistent log, or a telemetry
event. The technique is a single invariant plus the routing discipline that
implements it:

> **Every failure reaches at least one door. Never none.**

A failure that reaches no door did not "get handled" — it got erased. The
program continues as if the failure were an empty success, which is precisely
the confusion the law
[failure-not-empty-success](../../_laws.md#failure-not-empty-success) exists
to forbid: downstream, the erased failure is indistinguishable from "there
was nothing to do", and it resurfaces later as a stale surface, a short
count, or an automation that silently stopped.

## The routing question

One question routes every caught failure: **is this the user's problem right
now?**

| | The user's action failed | A background concern failed |
|---|---|---|
| Examples | save rejected, send failed, connection test failed | poll cycle died, cache refresh failed, best-effort enrichment fell over |
| Doors | **user notification + telemetry** | **telemetry + log** — user not interrupted |
| Rationale | the user must not resubmit into a wall blindly; the operator must not learn of outages from support tickets | the user cannot act on it and interrupting them converts one problem into two; but silent-to-the-user must never decay into silent-to-everyone |

Both routes reach telemetry. The route chooses whether the *user* is told,
never whether the *operator* is. The moment "background" is read as "no one
needs to know", the invariant is dead.

Make the routing decision **cheap and named**. The sanctioned form is a pair
of one-call helpers — one per route — that take the caught error and a short
operation label, and internally fan out to the right doors. When the correct
behavior is one call, reviewers can demand it in every catch block without
negotiating; when it is three calls assembled by hand, half the sites will
assemble a subset.

## Door discipline

- **An empty catch block is a reviewable event.** The rare legitimate cases —
  a probe where failure is the expected answer, a cleanup path where nothing
  can be done and nothing is lost — are real but must be *visibly declared*:
  a naming convention or annotation stating "this failure is intentionally
  dropped, and here is why". Undeclared emptiness is presumed to be a defect.
- **Returning a fallback is not a door.** Substituting a default value is
  often the right *behavior*, but it answers "what does the program do next",
  not "does a human learn". Fallback plus telemetry is graceful degradation;
  fallback alone is an outage with good manners.
- **Rethrowing is a deferral, not a door.** Passing the failure upward is
  legitimate exactly when some layer above owns the routing decision. The
  audit question for any rethrow chain is: name the layer where it ends in a
  door. A chain that ends in a top-level handler is fine; a chain that ends
  in another swallow has just moved the erasure.
- **The log door is the weakest door.** A console line in a client no one
  watches is barely a door at all; treat "log only" as acceptable solely for
  noise-class events, and pair it with telemetry for anything an operator
  would ever act on.
- **A trail record is a conditional door.** Telemetry systems often
  distinguish a full *event* (shipped on its own) from a *trail entry*
  (breadcrumb-style context that ships only attached to some future
  event). A failure recorded solely as a trail entry reaches the operator
  only if something else later fails — count it as a door for context
  enrichment, never as the sole door for a failure that matters by itself.

## Report once, at the owner

The invariant is "at least one door", not "every layer opens its own". When
a failure crosses three layers and each one reports, the operator sees three
events for one incident, dashboards triple-count, and — the real cost —
responders learn to see duplicates as normal and start ignoring volume.

The discipline: **the layer that makes the routing decision reports; layers
below enrich and propagate** (see
[structured-propagation](structured-propagation.md)). Where a failure may
legitimately be reported by more than one path — a shared helper used both
directly and inside a wrapper — deduplicate structurally: mark the error as
reported when the first door takes it, and have doors respect the mark.

## Frequency: doors need throttles

A failure in a loop, a poll, or a retry cycle reaches its door on every
iteration. Without suppression, one broken dependency produces thousands of
identical events per hour — which buries the *other* failures and trains
humans to mute the channel. Doors that can be hit repeatedly carry
**dedup or cooldown windows** keyed by failure identity (same category, same
operation): first occurrence reports at full fidelity, repeats increment a
counter, and the door periodically emits "still failing, N occurrences
suppressed". Suppression state is part of the door, not the call site —
call sites must stay one-call simple.

Identity keying has a prerequisite: **normalize the message before
signing it.** Real failure messages embed volatile fragments — record
identifiers, counts, addresses, timestamps — so two instances of one
failure rarely match byte-for-byte. Collapse the volatile parts
(identifiers and numbers to placeholders, whitespace folded, case fixed,
length capped) and key on the normalized form; otherwise the dedup never
fires and every repeat arrives as a "new" failure.

## Failure inside the door

Doors themselves fail — telemetry endpoints go down, notification systems
misrender, storage fills. Two rules keep this from recursing:

- **A door must never throw into the code that used it.** Reporting a
  failure must not create a second failure in the caller; doors trap their
  own internals and fall back to the next-weaker door (telemetry falls back
  to log; log falls back to nothing, silently — the one sanctioned silence,
  because the alternative is an infinite regress).
- **A door must not re-enter itself.** Failure-of-the-door reported through
  the door is the classic feedback loop; door internals report through a
  simpler, terminal channel.
