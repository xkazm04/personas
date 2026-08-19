---
layer: technique
subject: retry-backoff
technique: error-classification-for-retry
status: forged
laws:
  - one-authority-per-vocabulary
shared_with: []
---

# Error classification for retry

The retry decision is only as good as the classification feeding it, and
classification degrades in a specific, predictable way: the structured evidence a
failure carries (status codes, error kinds, protocol fields, exit codes) exists at
the boundary where the failure happened, and every layer the error crosses strips
some of it. By the time a generic error string reaches a retry loop three layers
up, the loop is reduced to matching substrings against messages — and message
matching is classification by superstition. The dependency rewords an error in a
minor version and the retry policy silently changes.

## Procedure

1. **Classify at the boundary, against structure.** The adapter that made the call
   — the layer still holding the typed response — maps the failure into a closed
   set of classes: *transient*, *permanent*, *rate-limited*, *unknown* (plus
   domain-specific refinements like *auth-expired* where a repair step exists).
   Everything above the adapter consumes the class. If a layer above finds itself
   inspecting message text to decide retryability, the classification happened too
   late.
2. **One taxonomy, one authority** (law: one-authority-per-vocabulary). The class
   vocabulary is defined once — one type, one module — and every boundary adapter
   maps *into* it. The failure mode this kills: three adapters each growing a
   private notion of "retryable", drifting independently, until the same upstream
   outage is retried by one code path, dropped by another, and dead-lettered by a
   third.
3. **Extract the dependency's own schedule when it offers one.** Rate-limit
   responses commonly carry a retry-after hint — a delay or an absolute reset
   time. Capture it during classification, while the structured response is still
   in hand, and attach it to the classified error. A locally computed ladder is a
   guess; the dependency's stated window is knowledge, and knowledge outranks
   guessing (backoff-design covers the precedence).
4. **Give message matching a quarantine, not a ban.** Some dependencies genuinely
   encode meaning only in text. When matching is unavoidable, it lives inside the
   boundary adapter as an implementation detail of producing the class — pinned
   with a comment naming the dependency version whose wording it matches — and
   never escapes into call sites. The difference between "regex in the adapter"
   and "regex in the retry loop" is the difference between a contained hack and a
   policy nobody can find.
5. **Default unknown, and count the unknowns.** The mapping's fallback branch
   yields *unknown*, never *transient* or *permanent* by accident of branch
   ordering. Unknowns get a conservative retry contract (few attempts, backoff,
   separately counted) and their count is a quality metric of the taxonomy itself:
   a rising unknown rate means the dependency's failure surface moved and the
   adapter has not.

## Decision rules

- **Retryability is a property of the failure, not of the caller.** If two call
  sites want different retry policies for the same class, the knob they vary is
  attempts/budget, never the class itself.
- **Ambiguous timeout means unknown side effects.** A timed-out write may have
  landed. Classify it transient only if the operation is idempotent or dedup-keyed
  downstream; otherwise the honest class is unknown, and the retry needs an
  idempotency story before it needs a ladder.
- **Auth-expired is repair-then-retry-once, not a ladder.** Refresh the credential,
  retry a single time; a second auth failure after repair is permanent. Running
  auth failures through exponential backoff just schedules four more rejections.
  One useful asymmetry: an authentication rejection *proves the effect never
  landed*, so the repair-then-retry is safe even on non-idempotent operations —
  unlike a timeout, which proves nothing.
- **Only health-bearing classes feed the breaker.** Transient and unknown count as
  breaker evidence; permanent does not (one malformed request says nothing about
  the dependency being alive); rate-limited is its own lane — the dependency is
  alive and telling you exactly when to come back (see circuit-breakers).
- **Reclassification mid-ladder wins.** If attempt three returns evidence of
  permanence, stop immediately. The ladder is a schedule, not a commitment.
